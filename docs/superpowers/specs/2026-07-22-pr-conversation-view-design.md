# PR Conversation View (Phase 1 of GitHub-style PR detail)

Date: 2026-07-22

## Purpose

Today, clicking a PR row (`PullRequestsScreen.tsx`) fetches the PR's head ref and jumps to viewing its head commit's diff in the repo view — there is no PR-detail screen. This is jarring compared to GitHub, where clicking a PR shows its title, description, and discussion. This spec adds that: a PR detail screen with a tab bar (Conversation / Files changed), where **Conversation** — title, state, body, comment thread, and posting new comments — is fully built now. **Files changed** (full base→head diff with GitHub-style inline review comments anchored to lines) is a separate, larger follow-on spec — its tab exists here only as a disabled placeholder, so the tab bar doesn't need to be re-added later.

This phasing was chosen deliberately: Files changed needs Conversation's screen shell (tab bar, header, back navigation) to already exist, needs diff-position math for anchoring comments to lines, and needs new diff-computation backend work (diffing against the merge-base, not a single commit's parent) — enough independent complexity that bundling it into this spec would blow past a single reviewable unit.

## Backend

All GitHub data access in this app already goes through the `gh` CLI via the `GhRunner` trait (`src-tauri/src/github.rs:6-9`) — no octokit/reqwest/GraphQL client exists or is needed. This spec follows that exact pattern: `gh pr view --json` for the PR body (extending the existing call), and `gh api repos/{owner}/{repo}/issues/{number}/comments` (GitHub's REST API — PR conversations are backed by the Issues API) for reading and posting comments.

### PR body

`gh pr view`'s JSON output already supports a `body` field; today's call just doesn't request it. Add `body` to `PR_VIEW_JSON_FIELDS` (`github.rs:178-179`) and to `GhPullRequestDetailJson`/`PullRequestDetail` (`github.rs:155-176`) as a **sibling field**, not part of the flattened `GhPullRequestJson`/`PullRequest` — `PullRequest` also backs `list_pull_requests` (`PR_LIST_JSON_FIELDS`, which doesn't request `body`), so adding a required `body` field to the shared struct would break list parsing. Only `PullRequestDetail` gains `body: String`:

```rust
const PR_VIEW_JSON_FIELDS: &str =
    "number,title,author,headRefName,baseRefName,state,isDraft,labels,updatedAt,url,commits,body";

#[derive(Debug, Clone, PartialEq, Deserialize)]
struct GhPullRequestDetailJson {
    #[serde(flatten)]
    pr: GhPullRequestJson,
    commits: Vec<GhCommitJson>,
    body: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestDetail {
    pub pull_request: PullRequest,
    pub commits: Vec<PullRequestCommit>,
    pub body: String,
}
```

And in `pr_detail()` (`github.rs:182-212`), the returned struct literal gains `body: parsed.body,` alongside the existing `pull_request`/`commits` fields.

### Comments

New types and functions in `github.rs`, following the existing `GhXxxJson` (private, `Deserialize`) → public `serde::Serialize` struct → `From` conversion pattern already used for `PullRequest`/`PullRequestCommit`. Unlike the `gh pr view --json`/`gh pr list --json` calls (which go through `gh`'s own GraphQL-backed field aliasing and use camelCase), `gh api <endpoint>` is a raw REST passthrough — GitHub's REST API uses snake_case (`created_at`, `html_url`, nested `user.login`), so the new `Gh*Json` structs use snake_case field names directly (no `#[serde(rename)]` needed), same as GitHub's actual response shape.

```rust
#[derive(Debug, Clone, PartialEq, Deserialize)]
struct GhCommentUserJson {
    login: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
struct GhCommentJson {
    id: u64,
    user: GhCommentUserJson,
    body: String,
    created_at: String,
    html_url: String,
}

/// A single comment on a pull request's Conversation tab.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrComment {
    pub id: u64,
    pub author: String,
    pub body: String,
    pub created_at: String,
    pub url: String,
}

impl From<GhCommentJson> for PrComment {
    fn from(json: GhCommentJson) -> Self {
        PrComment {
            id: json.id,
            author: json.user.login,
            body: json.body,
            created_at: json.created_at,
            url: json.html_url,
        }
    }
}

/// Lists a pull request's top-level (Conversation-tab) comments.
pub fn list_pr_comments(
    runner: &dyn GhRunner,
    owner: &str,
    repo: &str,
    number: u64,
) -> Result<Vec<PrComment>, AppError> {
    let endpoint = format!("repos/{owner}/{repo}/issues/{number}/comments");
    let output = runner.run(&["api", &endpoint, "--paginate"])?;
    let parsed: Vec<GhCommentJson> = serde_json::from_str(&output)
        .map_err(|e| AppError::Operation(format!("failed to parse gh pr comments output: {e}")))?;
    Ok(parsed.into_iter().map(PrComment::from).collect())
}

/// Posts a new top-level comment on a pull request, returning the created comment.
pub fn add_pr_comment(
    runner: &dyn GhRunner,
    owner: &str,
    repo: &str,
    number: u64,
    body: &str,
) -> Result<PrComment, AppError> {
    let endpoint = format!("repos/{owner}/{repo}/issues/{number}/comments");
    let body_arg = format!("body={body}");
    let output = runner.run(&["api", &endpoint, "-X", "POST", "-f", &body_arg])?;
    let parsed: GhCommentJson = serde_json::from_str(&output)
        .map_err(|e| AppError::Operation(format!("failed to parse gh add pr comment output: {e}")))?;
    Ok(PrComment::from(parsed))
}
```

`-f body=<text>` is a single argv element passed straight to `std::process::Command` (no shell involved — same as every other call in this file), so embedded newlines/quotes/`=` in the comment body are safe; `gh` splits `key=value` on the first `=` only.

### Tauri commands (`commands.rs`)

Following the exact shape of `get_pull_request`/`list_pull_requests` (`commands.rs:109-125`):

```rust
#[tauri::command]
pub async fn list_pr_comments(repo_path: String, number: u64) -> Result<Vec<PrComment>, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        github::list_pr_comments(&SystemGhRunner, &owner, &repo, number)
    })
    .await
}

#[tauri::command]
pub async fn add_pr_comment(repo_path: String, number: u64, body: String) -> Result<PrComment, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        github::add_pr_comment(&SystemGhRunner, &owner, &repo, number, &body)
    })
    .await
}
```

`commands.rs:5`'s `use crate::github::{self, GithubStatus, PullRequest, PullRequestDetail, SystemGhRunner};` gains `PrComment`. Both new commands are added to the `generate_handler!` list in `lib.rs:38-64`.

## Frontend

### Types and invoke wrappers (`src/lib/tauri.ts`)

- `PullRequestDetail` gains `body: string;`.
- New:
  ```typescript
  export interface PrComment {
    id: number;
    author: string;
    body: string;
    createdAt: string;
    url: string;
  }

  export const invokeListPrComments = (repoPath: string, number: number) =>
    invoke<PrComment[]>("list_pr_comments", { repoPath, number });

  export const invokeAddPrComment = (repoPath: string, number: number, body: string) =>
    invoke<PrComment>("add_pr_comment", { repoPath, number, body });
  ```

### Store (`src/store/githubStore.ts`)

New state: `selectedPrNumber: number | null`, `prDetail: PullRequestDetail | null`, `prComments: PrComment[]`.

`openPullRequest` is rewritten to open the new detail view instead of jumping to the commit/diff view — no more `useUiStore.selectCommit`/`useViewStore.setActiveView("repo")`. No loading flag is added: today's app has no loading affordance for opening a PR at all (the click just awaits), and nothing in this spec's UI would consume one — adding it now would be dead state.

```typescript
openPullRequest: async (repoPath: string, number: number) => {
  await invokeFetchPrRef(repoPath, number);
  const [detail, comments] = await Promise.all([
    invokeGetPullRequest(repoPath, number),
    invokeListPrComments(repoPath, number),
  ]);
  set({ selectedPrNumber: number, prDetail: detail, prComments: comments });
},

closePullRequestDetail: () => set({ selectedPrNumber: null, prDetail: null, prComments: [] }),

addComment: async (repoPath: string, body: string) => {
  const number = get().selectedPrNumber;
  if (number == null) return;
  const comment = await invokeAddPrComment(repoPath, number, body);
  set({ prComments: [...get().prComments, comment] });
},
```

**Error behavior is intentionally unchanged from today**: if `invokeFetchPrRef` or either `Promise.all` call rejects, it throws *before* `selectedPrNumber` is set — `PullRequestsScreen.tsx`'s existing `handleRowClick` try/catch (`setOpenError`) still catches it and the screen stays on the list, exactly as it does today. This is why `selectedPrNumber` is set only on the success path, not optimistically up front. `addComment` deliberately has no internal try/catch — the caller (the compose box in the new component) owns its own draft-text/error/posting-spinner state, matching how `Toolbar.tsx` and `PullRequestsScreen.tsx` already keep transient UI error state local to the component rather than in the global store.

### Shared display helpers (`src/lib/prDisplay.ts`, new)

`PullRequestsScreen.tsx` already has `initials(name)` and `statusLabel(pr)` (added for row avatars/badges in the Nest redesign). The new PR detail header needs the same avatar-initials and state-badge treatment, so both functions move out of `PullRequestsScreen.tsx` into this new shared module (pure functions, no JSX — same shape, just relocated) and both components import from there. This is a two-consumer-triggered extraction, not speculative — it only happens now that a second real caller exists.

```typescript
export function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

export function statusLabel(pr: { state: string; isDraft: boolean }): { label: string; className: string } {
  if (pr.isDraft) return { label: "Draft", className: "bg-elevated border border-border-subtle text-text-muted" };
  switch (pr.state.toUpperCase()) {
    case "MERGED":
      return { label: "Merged", className: "bg-merged-soft text-merged" };
    case "CLOSED":
      return { label: "Closed", className: "bg-danger-soft text-danger" };
    default:
      return { label: "Open", className: "bg-success-soft text-success" };
  }
}
```

### New component: `src/components/PullRequestDetail.tsx`

Self-contained (reads `useWorkspaceStore` for the active repo and `useGithubStore` for `prDetail`/`prComments`/`selectedPrNumber`/`addComment`/`closePullRequestDetail` itself — no props), rendered by `PullRequestsScreen.tsx` in place of the list whenever `selectedPrNumber != null`:

- Header: "← Back to Pull Requests" button (`closePullRequestDetail`), then avatar (`initials`/`hashHue`, same treatment as list rows) + `#{number} {title}` + status badge (`statusLabel`) + `{baseRefName} ← {headRefName}`.
- Tab bar: `Conversation` (active) / `Files changed` (rendered `disabled`, `title="Coming soon"` — no click handler; this is the only trace of Phase 2 in this spec).
- Conversation tab body:
  - PR body rendered via `react-markdown`'s default export (`<ReactMarkdown>{prDetail.body}</ReactMarkdown>`) — skipped entirely (no empty box) when `body` is empty/whitespace-only.
  - Comment list: each comment renders the same avatar treatment + `author` + raw `createdAt` string (no new date-formatting dependency — consistent with the rest of the app not formatting relative times anywhere yet) + body via `<ReactMarkdown>`. "No comments yet" (muted text) when the list is empty.
  - Compose box: a `<textarea>` (local `useState` draft) + "Comment" button. On submit: local `posting`/`error` state, calls `addComent(activeRepo.path, draft)`; on success clears the draft; on failure keeps the draft and shows the error inline (so nothing typed is lost) — same shape as `Toolbar.tsx`'s local error-state pattern.
- While a click is in flight, the list is still what's showing (per the store design above, `selectedPrNumber`/`prDetail` aren't set until success) — so no in-detail loading state is needed for the *initial* open, matching today's app having no loading affordance there either.

### New dependency

`react-markdown` — add to `package.json` `dependencies`. No plugins (no `remark-gfm` etc.) for this pass; GitHub-flavored extras (tables, task lists, strikethrough) are a cheap follow-on if wanted later, not required for "renders like GitHub" at a first pass (headings/lists/code blocks/links/emphasis — CommonMark — already covers the overwhelming majority of PR bodies/comments).

### `PullRequestsScreen.tsx` changes

- Reads `selectedPrNumber` from `useGithubStore`; if non-null, renders `<PullRequestDetail />` instead of the existing filter-bar+list JSX (early return after the existing `status.available` check, so the "GitHub unavailable" message still takes priority).
- `handleRowClick`/`openPullRequest` call site itself is unchanged (still `openPullRequest(activeRepo.path, pr.number)` inside the same try/catch setting `openError`).
- `initials`/`statusLabel` imports switch from local module-level functions to `import { initials, statusLabel } from "../lib/prDisplay"`.

## Testing

- **Rust**: new `github.rs` unit tests (same `FakeGhRunner` pattern already in this file) for `list_pr_comments` (parses a `gh api` JSON array, including verifying the endpoint path and `--paginate` flag) and `add_pr_comment` (verifies `-X POST`/`-f body=...` args and parses the single created-comment JSON object). `pr_detail`'s existing tests (`SAMPLE_PR_VIEW_JSON`) gain a `"body"` field in the fixture and an assertion that it round-trips onto `PullRequestDetail.body`.
- **Frontend, `src/lib/prDisplay.ts`**: new `prDisplay.test.ts` — the two functions' existing test coverage (currently inline in `PullRequestsScreen.test.tsx`'s row-visual tests, added in the Nest redesign) doesn't need duplicating since those tests exercise the functions indirectly through rendered rows; a light direct unit test for `statusLabel`'s four branches (open/closed/merged/draft) is added since it's now a shared, more load-bearing utility.
- **`PullRequestsScreen.test.tsx`**: `vi.mock("../lib/tauri", ...)` gains `invokeListPrComments: vi.fn()` and `invokeAddPrComment: vi.fn()`. The existing `"clicking a PR row opens it"` test is rewritten: it currently only asserts `invokeFetchPrRef` was called; it's extended to also mock `invokeListPrComments` resolving `[]` and assert the PR detail screen appears (e.g. `screen.getByRole("button", { name: "← Back to Pull Requests" })` or the rendered title) in place of the list. The existing `"shows an inline error and stays on the PR list when opening a PR fails"` test (`invokeFetchPrRef` rejecting) needs no changes — per the store design above, that failure path is unaffected.
- **New `PullRequestDetail.test.tsx`**: renders with a populated `prDetail`/`prComments`, asserts body renders as markdown (e.g. a `**bold**` fixture renders a `<strong>`), comments list renders each author+body, "No comments yet" shows for an empty list, posting a comment calls `invokeAddPrComment` with the right args and appends it to the list, a failed post keeps the draft text visible and shows an inline error, and the back button calls `closePullRequestDetail`.
- Full regression (`cargo test` + `npm test` + `npm run e2e`) at the end, per established policy. The existing three e2e failures (documented in the Nest redesign plan as pre-existing/unrelated — `WorkingCopyPanel` commented out, and a stale `get_branches` mock shape in `e2e/mockTauri.ts`) are untouched by this spec; `e2e/mockTauri.ts` does need its `get_pull_request`/PR-related mock fixtures (if any e2e spec exercises them) extended with a `body` field and new `list_pr_comments`/`add_pr_comment` cases if a PR-flow e2e test is added — no such e2e test exists today, so this is a no-op unless one is added later.

## Out of Scope

- **Files changed tab** (full PR diff, inline review comments anchored to lines, posting them) — the follow-on spec described in Purpose.
- Editing or deleting existing comments, reactions, or comment threading/replies (Conversation-tab comments are flat, top-level, GitHub "issue comments" — this matches how GitHub's own Conversation tab renders them too; reply-style threading only exists for *review* comments, which are Phase 2).
- Markdown editing affordances (preview-while-typing, toolbar buttons) — the compose box is a plain textarea; only the *rendering* of body/comments is rich.
- Any change to `PullRequest`/`PR_LIST_JSON_FIELDS`/the PR list row rendering — this spec only touches the detail view.
- Relative/formatted timestamps — comments show the raw `created_at` string from GitHub, consistent with the rest of the app today.

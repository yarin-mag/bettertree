# PR Conversation View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "click a PR row → jump to its head commit's diff" with a real PR detail screen (tab bar: Conversation / Files changed) showing title, body, comment thread, and the ability to post new comments — per `docs/superpowers/specs/2026-07-22-pr-conversation-view-design.md`. "Files changed" is a disabled placeholder tab; its implementation is a separate future plan.

**Architecture:** Backend stays on the existing `gh` CLI + `GhRunner` trait pattern (`src-tauri/src/github.rs`) — extend `gh pr view` to fetch `body`, add two new `gh api` calls for reading/posting Conversation-tab comments. Frontend: new store state (`selectedPrNumber`/`prDetail`/`prComments`) replaces the old "select commit + switch view" side effect in `openPullRequest`; a new self-contained `PullRequestDetail` component renders whenever a PR is selected, in place of the list.

**Tech Stack:** Rust + `git2`/`gh` CLI backend (Tauri commands), React + TypeScript frontend, Zustand, `react-markdown` (new dependency), Vitest + Testing Library, Rust's built-in test framework.

## Global Constraints

- **No git in this project** — every task ends with running the relevant test command, not a commit.
- No changes to `PullRequest`/`PR_LIST_JSON_FIELDS`/PR list row rendering — only the detail view.
- No comment editing/deleting/reactions/threading — Conversation-tab comments are flat, GitHub "issue comments".
- No relative/formatted timestamps — show `createdAt` exactly as GitHub returns it.
- "Files changed" tab is a disabled, non-interactive placeholder only (`disabled`, `title="Coming soon"`, no click handler) — its real implementation is out of scope for this plan.
- Preserve every existing test selector/behavior not explicitly called out below as changing (all currently-passing `PullRequestsScreen.test.tsx`/`githubStore.test.ts` tests except the two explicitly rewritten in Tasks 6 and 8).
- Run `npx vitest run <file>` for frontend test steps; `cargo test --manifest-path src-tauri/Cargo.toml <filter>` for backend test steps (both non-interactively, not the watch mode).

---

### Task 1: PR body field (backend)

**Files:**
- Modify: `src-tauri/src/github.rs` (`PR_VIEW_JSON_FIELDS`, `GhPullRequestDetailJson`, `PullRequestDetail`, `pr_detail`, and the `gh_client_tests` module's `SAMPLE_PR_VIEW_JSON`/`pr_detail_parses_gh_json_output_including_commits` test)

**Interfaces:**
- Produces: `PullRequestDetail.body: String` (new field), serialized to the frontend as `body` (camelCase, same as today).

- [ ] **Step 1: Extend the test fixture and add a body assertion**

In `github.rs`'s `gh_client_tests` module, replace `SAMPLE_PR_VIEW_JSON`:

```rust
    const SAMPLE_PR_VIEW_JSON: &str = r#"{
        "number": 42,
        "title": "Fix the thing",
        "author": {"login": "yarinmag"},
        "headRefName": "fix-thing",
        "baseRefName": "main",
        "state": "OPEN",
        "isDraft": false,
        "labels": [{"name": "bug"}],
        "updatedAt": "2026-07-10T12:00:00Z",
        "url": "https://github.com/acme/widgets/pull/42",
        "body": "Fixes the race condition in the queue.",
        "commits": [
            {"oid": "abc123", "messageHeadline": "fix the thing"},
            {"oid": "def456", "messageHeadline": "add a test"}
        ]
    }"#;
```

Add an assertion to `pr_detail_parses_gh_json_output_including_commits`:

```rust
    #[test]
    fn pr_detail_parses_gh_json_output_including_commits() {
        let runner = FakeGhRunner::ok(SAMPLE_PR_VIEW_JSON);

        let pr = pr_detail(&runner, "acme", "widgets", 42).unwrap();

        assert_eq!(pr.pull_request.number, 42);
        assert_eq!(pr.pull_request.head_ref_name, "fix-thing");
        assert_eq!(pr.commits.len(), 2);
        assert_eq!(pr.commits[0].oid, "abc123");
        assert_eq!(pr.commits[0].message_headline, "fix the thing");
        assert_eq!(pr.commits[1].oid, "def456");
        assert_eq!(pr.body, "Fixes the race condition in the queue.");
    }
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml pr_detail_parses_gh_json_output_including_commits`
Expected: FAIL — `no field \`body\` on type \`PullRequestDetail\`` (compile error) or a JSON parse error, since `body` isn't in the struct/fixture-consuming code yet.

- [ ] **Step 3: Add `body` to the JSON fields constant, structs, and `pr_detail`**

Replace:

```rust
const PR_VIEW_JSON_FIELDS: &str =
    "number,title,author,headRefName,baseRefName,state,isDraft,labels,updatedAt,url,commits";
```

with:

```rust
const PR_VIEW_JSON_FIELDS: &str =
    "number,title,author,headRefName,baseRefName,state,isDraft,labels,updatedAt,url,commits,body";
```

Replace:

```rust
#[derive(Debug, Clone, PartialEq, Deserialize)]
struct GhPullRequestDetailJson {
    #[serde(flatten)]
    pr: GhPullRequestJson,
    commits: Vec<GhCommitJson>,
}
```

with:

```rust
#[derive(Debug, Clone, PartialEq, Deserialize)]
struct GhPullRequestDetailJson {
    #[serde(flatten)]
    pr: GhPullRequestJson,
    commits: Vec<GhCommitJson>,
    body: String,
}
```

Replace:

```rust
/// A pull request plus its commit list, as returned by `gh pr view`.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestDetail {
    pub pull_request: PullRequest,
    pub commits: Vec<PullRequestCommit>,
}
```

with:

```rust
/// A pull request plus its commit list, as returned by `gh pr view`.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestDetail {
    pub pull_request: PullRequest,
    pub commits: Vec<PullRequestCommit>,
    pub body: String,
}
```

Replace the return value in `pr_detail`:

```rust
    Ok(PullRequestDetail {
        pull_request: PullRequest::from(parsed.pr),
        commits: parsed
            .commits
            .into_iter()
            .map(|c| PullRequestCommit {
                oid: c.oid,
                message_headline: c.message_headline,
            })
            .collect(),
    })
```

with:

```rust
    Ok(PullRequestDetail {
        pull_request: PullRequest::from(parsed.pr),
        commits: parsed
            .commits
            .into_iter()
            .map(|c| PullRequestCommit {
                oid: c.oid,
                message_headline: c.message_headline,
            })
            .collect(),
        body: parsed.body,
    })
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml pr_detail`
Expected: PASS (both `pr_detail_parses_gh_json_output_including_commits` and `pr_detail_passes_repo_and_number_to_gh`)

- [ ] **Step 5: No commit.** Move to Task 2.

---

### Task 2: List PR comments (backend)

**Files:**
- Modify: `src-tauri/src/github.rs` (new `GhCommentUserJson`/`GhCommentJson`/`PrComment`/`list_pr_comments`, plus new tests in `gh_client_tests`)
- Modify: `src-tauri/src/commands.rs` (new `list_pr_comments` command; `use` line gains `PrComment`)
- Modify: `src-tauri/src/lib.rs` (register `commands::list_pr_comments`)

**Interfaces:**
- Consumes: `GhRunner` trait (`github.rs:6-9`), `resolve_owner_repo` (`github.rs:216-222`) — both unchanged.
- Produces: `pub struct PrComment { id: u64, author: String, body: String, created_at: String, url: String }` (camelCase-serialized), `pub fn list_pr_comments(runner: &dyn GhRunner, owner: &str, repo: &str, number: u64) -> Result<Vec<PrComment>, AppError>`, and the Tauri command `list_pr_comments(repo_path: String, number: u64) -> Result<Vec<PrComment>, AppError>`.

- [ ] **Step 1: Write the failing tests in `github.rs`'s `gh_client_tests` module**

Add near `SAMPLE_PR_VIEW_JSON`:

```rust
    const SAMPLE_PR_COMMENTS_JSON: &str = r#"[
        {
            "id": 111,
            "user": {"login": "avery"},
            "body": "Looks good to me",
            "created_at": "2026-07-20T10:00:00Z",
            "html_url": "https://github.com/acme/widgets/pull/42#issuecomment-111"
        }
    ]"#;

    #[test]
    fn list_pr_comments_parses_gh_api_json_output() {
        let runner = FakeGhRunner::ok(SAMPLE_PR_COMMENTS_JSON);

        let comments = list_pr_comments(&runner, "acme", "widgets", 42).unwrap();

        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].id, 111);
        assert_eq!(comments[0].author, "avery");
        assert_eq!(comments[0].body, "Looks good to me");
        assert_eq!(comments[0].created_at, "2026-07-20T10:00:00Z");
        assert_eq!(
            comments[0].url,
            "https://github.com/acme/widgets/pull/42#issuecomment-111"
        );
    }

    #[test]
    fn list_pr_comments_calls_gh_api_with_paginate_and_repo() {
        let runner = FakeGhRunner::ok(SAMPLE_PR_COMMENTS_JSON);

        list_pr_comments(&runner, "acme", "widgets", 42).unwrap();

        let calls = runner.calls.borrow();
        let args = &calls[0];
        assert_eq!(args[0], "api");
        assert!(args.contains(&"repos/acme/widgets/issues/42/comments".to_string()));
        assert!(args.contains(&"--paginate".to_string()));
    }
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml list_pr_comments`
Expected: FAIL — compile error, `list_pr_comments` doesn't exist yet.

- [ ] **Step 3: Implement the types and function in `github.rs`**

Add after `pr_detail` (before `resolve_owner_repo`):

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
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml list_pr_comments`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire the Tauri command**

In `commands.rs`, replace the `use` line:

```rust
use crate::github::{self, GithubStatus, PullRequest, PullRequestDetail, SystemGhRunner};
```

with:

```rust
use crate::github::{self, GithubStatus, PrComment, PullRequest, PullRequestDetail, SystemGhRunner};
```

Add after `get_pull_request` (before `fetch_pr_ref`):

```rust
#[tauri::command]
pub async fn list_pr_comments(repo_path: String, number: u64) -> Result<Vec<PrComment>, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        github::list_pr_comments(&SystemGhRunner, &owner, &repo, number)
    })
    .await
}
```

In `lib.rs`, add `commands::list_pr_comments,` to the `generate_handler!` list, right after `commands::get_pull_request,`.

- [ ] **Step 6: Run the full backend suite to confirm it still compiles and passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS, all tests (baseline 82 + 2 new = 84)

- [ ] **Step 7: No commit.** Move to Task 3.

---

### Task 3: Post a PR comment (backend)

**Files:**
- Modify: `src-tauri/src/github.rs` (new `add_pr_comment`, plus new tests in `gh_client_tests`)
- Modify: `src-tauri/src/commands.rs` (new `add_pr_comment` command)
- Modify: `src-tauri/src/lib.rs` (register `commands::add_pr_comment`)

**Interfaces:**
- Consumes: `GhCommentJson`/`PrComment`/`From<GhCommentJson> for PrComment` (Task 2).
- Produces: `pub fn add_pr_comment(runner: &dyn GhRunner, owner: &str, repo: &str, number: u64, body: &str) -> Result<PrComment, AppError>` and the Tauri command `add_pr_comment(repo_path: String, number: u64, body: String) -> Result<PrComment, AppError>`.

- [ ] **Step 1: Write the failing tests in `github.rs`'s `gh_client_tests` module**

Add:

```rust
    const SAMPLE_ADD_COMMENT_JSON: &str = r#"{
        "id": 222,
        "user": {"login": "yarinmag"},
        "body": "Thanks!",
        "created_at": "2026-07-21T09:00:00Z",
        "html_url": "https://github.com/acme/widgets/pull/42#issuecomment-222"
    }"#;

    #[test]
    fn add_pr_comment_parses_created_comment_json() {
        let runner = FakeGhRunner::ok(SAMPLE_ADD_COMMENT_JSON);

        let comment = add_pr_comment(&runner, "acme", "widgets", 42, "Thanks!").unwrap();

        assert_eq!(comment.id, 222);
        assert_eq!(comment.author, "yarinmag");
        assert_eq!(comment.body, "Thanks!");
        assert_eq!(comment.created_at, "2026-07-21T09:00:00Z");
    }

    #[test]
    fn add_pr_comment_posts_to_the_issues_comments_endpoint_with_the_body() {
        let runner = FakeGhRunner::ok(SAMPLE_ADD_COMMENT_JSON);

        add_pr_comment(&runner, "acme", "widgets", 42, "Thanks!").unwrap();

        let calls = runner.calls.borrow();
        let args = &calls[0];
        assert_eq!(args[0], "api");
        assert!(args.contains(&"repos/acme/widgets/issues/42/comments".to_string()));
        assert!(args.contains(&"-X".to_string()));
        assert!(args.contains(&"POST".to_string()));
        assert!(args.contains(&"body=Thanks!".to_string()));
    }
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml add_pr_comment`
Expected: FAIL — compile error, `add_pr_comment` doesn't exist yet.

- [ ] **Step 3: Implement `add_pr_comment` in `github.rs`**

Add directly after `list_pr_comments`:

```rust
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

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml add_pr_comment`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire the Tauri command**

In `commands.rs`, add directly after the new `list_pr_comments` command:

```rust
#[tauri::command]
pub async fn add_pr_comment(repo_path: String, number: u64, body: String) -> Result<PrComment, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        github::add_pr_comment(&SystemGhRunner, &owner, &repo, number, &body)
    })
    .await
}
```

In `lib.rs`, add `commands::add_pr_comment,` right after `commands::list_pr_comments,`.

- [ ] **Step 6: Run the full backend suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS, all tests (baseline 82 + 4 new from Tasks 2–3 = 86)

- [ ] **Step 7: No commit.** Move to Task 4.

---

### Task 4: Frontend types and invoke wrappers

**Files:**
- Modify: `src/lib/tauri.ts`

**Interfaces:**
- Produces: `PullRequestDetail.body: string` (new field on the existing interface); new `PrComment` interface; new `invokeListPrComments(repoPath: string, number: number): Promise<PrComment[]>` and `invokeAddPrComment(repoPath: string, number: number, body: string): Promise<PrComment>`.

No dedicated test file — `tauri.ts` is a thin typed-`invoke` wrapper layer with no existing direct unit tests (verified: no `tauri.test.ts` exists); it's exercised indirectly through the store tests in Task 6.

- [ ] **Step 1: Add `body` to `PullRequestDetail`**

Replace:

```typescript
export interface PullRequestDetail {
  pullRequest: PullRequest;
  commits: PullRequestCommit[];
}
```

with:

```typescript
export interface PullRequestDetail {
  pullRequest: PullRequest;
  commits: PullRequestCommit[];
  body: string;
}
```

- [ ] **Step 2: Add the `PrComment` type and invoke wrappers**

Add directly after `invokeGetPullRequest`'s definition:

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

- [ ] **Step 3: Run the full frontend suite to confirm nothing broke**

Run: `npx vitest run`
Expected: same as the pre-existing baseline (no behavior changed yet — these are new, unused-so-far exports plus one additive interface field).

- [ ] **Step 4: No commit.** Move to Task 5.

---

### Task 5: Extract `initials`/`statusLabel` into a shared module

**Files:**
- Create: `src/lib/prDisplay.ts`
- Test: `src/__tests__/prDisplay.test.ts`
- Modify: `src/components/PullRequestsScreen.tsx` (remove the two local functions, import from the new module)

**Interfaces:**
- Produces: `initials(name: string): string`, `statusLabel(pr: { state: string; isDraft: boolean }): { label: string; className: string }` — identical signatures/behavior to today's local functions in `PullRequestsScreen.tsx`, just relocated so `PullRequestDetail.tsx` (Task 7) can use them too.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/prDisplay.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { initials, statusLabel } from "../lib/prDisplay";

describe("initials", () => {
  it("returns the first two characters, uppercased", () => {
    expect(initials("yarinmag")).toBe("YA");
  });
});

describe("statusLabel", () => {
  it("returns Draft for a draft PR regardless of state", () => {
    expect(statusLabel({ state: "OPEN", isDraft: true })).toEqual({
      label: "Draft",
      className: "bg-elevated border border-border-subtle text-text-muted",
    });
  });

  it("returns Merged for a merged, non-draft PR", () => {
    expect(statusLabel({ state: "MERGED", isDraft: false })).toEqual({
      label: "Merged",
      className: "bg-merged-soft text-merged",
    });
  });

  it("returns Closed for a closed, non-draft PR", () => {
    expect(statusLabel({ state: "CLOSED", isDraft: false })).toEqual({
      label: "Closed",
      className: "bg-danger-soft text-danger",
    });
  });

  it("returns Open for an open, non-draft PR", () => {
    expect(statusLabel({ state: "OPEN", isDraft: false })).toEqual({
      label: "Open",
      className: "bg-success-soft text-success",
    });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/__tests__/prDisplay.test.ts`
Expected: FAIL — `Cannot find module '../lib/prDisplay'`

- [ ] **Step 3: Create `src/lib/prDisplay.ts`**

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

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/__tests__/prDisplay.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Remove the two functions from `PullRequestsScreen.tsx` and import from the new module**

Add this import near the top (alongside the other `../lib/...` imports):

```tsx
import { initials, statusLabel } from "../lib/prDisplay";
```

Remove these two functions (they now live in `src/lib/prDisplay.ts`):

```tsx
function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

function statusLabel(pr: { state: string; isDraft: boolean }): { label: string; className: string } {
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

- [ ] **Step 6: Run `PullRequestsScreen.test.tsx` to confirm nothing broke**

Run: `npx vitest run src/__tests__/PullRequestsScreen.test.tsx`
Expected: PASS, same count as before this task (the row-visual tests exercise these functions indirectly through rendered output, unaffected by where the functions live).

- [ ] **Step 7: No commit.** Move to Task 6.

---

### Task 6: Store changes — `selectedPrNumber`, `prDetail`, `prComments`

**Files:**
- Modify: `src/store/githubStore.ts`
- Modify: `src/__tests__/githubStore.test.ts`

**Interfaces:**
- Consumes: `invokeListPrComments`, `invokeAddPrComment` (Task 4), `PrComment`/`PullRequestDetail` types (Task 4).
- Produces: `selectedPrNumber: number | null`, `prDetail: PullRequestDetail | null`, `prComments: PrComment[]`, `openPullRequest(repoPath, number): Promise<void>` (rewritten — no longer touches `useUiStore`/`useViewStore`), `closePullRequestDetail(): void`, `addComment(repoPath: string, body: string): Promise<void>`.

- [ ] **Step 1: Write the failing/updated tests**

Replace the full file `src/__tests__/githubStore.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/tauri", () => ({
  invokeGetGithubStatus: vi.fn(),
  invokeListPullRequests: vi.fn(),
  invokeFetchPrRef: vi.fn(),
  invokeGetPullRequest: vi.fn(),
  invokeListGithubBranches: vi.fn(),
  invokeListAssignableUsers: vi.fn(),
  invokeListPrComments: vi.fn(),
  invokeAddPrComment: vi.fn(),
}));

import { useGithubStore } from "../store/githubStore";
import * as tauriLib from "../lib/tauri";

describe("githubStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGithubStore.setState({
      query: "",
      status: null,
      pullRequests: [],
      isLoadingPrs: false,
      branches: [],
      selectedPrNumber: null,
      prDetail: null,
      prComments: [],
    });
  });

  it("loadBranches populates branches from the backend", async () => {
    (tauriLib.invokeListGithubBranches as any).mockResolvedValue(["main", "develop", "feature/foo"]);

    await useGithubStore.getState().loadBranches("/tmp/a");

    expect(tauriLib.invokeListGithubBranches).toHaveBeenCalledWith("/tmp/a");
    expect(useGithubStore.getState().branches).toEqual(["main", "develop", "feature/foo"]);
  });

  it("defaults to an empty query", () => {
    expect(useGithubStore.getState().query).toBe("");
  });

  it("setQualifier upserts a token into the query", () => {
    useGithubStore.getState().setQualifier("author", "yarinmag");
    expect(useGithubStore.getState().query).toBe("author:yarinmag");
  });

  it("loadStatus populates status from the backend", async () => {
    (tauriLib.invokeGetGithubStatus as any).mockResolvedValue({
      available: true,
      owner: "acme",
      repo: "widgets",
      reason: null,
    });

    await useGithubStore.getState().loadStatus("/tmp/a");

    expect(useGithubStore.getState().status).toEqual({
      available: true,
      owner: "acme",
      repo: "widgets",
      reason: null,
    });
  });

  it("searchPullRequests populates pullRequests using the current query", async () => {
    useGithubStore.setState({ query: "is:open" });
    (tauriLib.invokeListPullRequests as any).mockResolvedValue([
      { number: 1, title: "Fix", author: "a", headRefName: "h", baseRefName: "main", state: "OPEN", isDraft: false, labels: [], updatedAt: "now", url: "u" },
    ]);

    await useGithubStore.getState().searchPullRequests("/tmp/a");

    expect(tauriLib.invokeListPullRequests).toHaveBeenCalledWith("/tmp/a", "is:open");
    expect(useGithubStore.getState().pullRequests).toHaveLength(1);
  });

  it("openPullRequest fetches the PR ref, detail, and comments, then shows the PR detail", async () => {
    (tauriLib.invokeFetchPrRef as any).mockResolvedValue(undefined);
    (tauriLib.invokeGetPullRequest as any).mockResolvedValue({
      pullRequest: { number: 42, title: "t", author: "a", headRefName: "h", baseRefName: "main", state: "OPEN", isDraft: false, labels: [], updatedAt: "now", url: "u" },
      commits: [{ oid: "c1", messageHeadline: "first" }],
      body: "hello",
    });
    (tauriLib.invokeListPrComments as any).mockResolvedValue([
      { id: 1, author: "avery", body: "hi", createdAt: "now", url: "u" },
    ]);

    await useGithubStore.getState().openPullRequest("/tmp/a", 42);

    expect(tauriLib.invokeFetchPrRef).toHaveBeenCalledWith("/tmp/a", 42);
    expect(tauriLib.invokeGetPullRequest).toHaveBeenCalledWith("/tmp/a", 42);
    expect(tauriLib.invokeListPrComments).toHaveBeenCalledWith("/tmp/a", 42);
    expect(useGithubStore.getState().selectedPrNumber).toBe(42);
    expect(useGithubStore.getState().prDetail?.body).toBe("hello");
    expect(useGithubStore.getState().prComments).toHaveLength(1);
  });

  it("closePullRequestDetail clears the selected PR and its data", () => {
    useGithubStore.setState({
      selectedPrNumber: 42,
      prDetail: { pullRequest: {} as any, commits: [], body: "hi" },
      prComments: [{ id: 1, author: "a", body: "b", createdAt: "now", url: "u" }],
    });

    useGithubStore.getState().closePullRequestDetail();

    expect(useGithubStore.getState().selectedPrNumber).toBeNull();
    expect(useGithubStore.getState().prDetail).toBeNull();
    expect(useGithubStore.getState().prComments).toEqual([]);
  });

  it("addComment posts a comment for the selected PR and appends it", async () => {
    useGithubStore.setState({ selectedPrNumber: 42, prComments: [] });
    (tauriLib.invokeAddPrComment as any).mockResolvedValue({
      id: 2,
      author: "yarinmag",
      body: "thanks",
      createdAt: "now",
      url: "u",
    });

    await useGithubStore.getState().addComment("/tmp/a", "thanks");

    expect(tauriLib.invokeAddPrComment).toHaveBeenCalledWith("/tmp/a", 42, "thanks");
    expect(useGithubStore.getState().prComments).toHaveLength(1);
    expect(useGithubStore.getState().prComments[0].body).toBe("thanks");
  });

  it("searchPullRequests sets isLoadingPrs while in flight", async () => {
    let resolveFn: (value: any) => void;
    (tauriLib.invokeListPullRequests as any).mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      })
    );

    const promise = useGithubStore.getState().searchPullRequests("/tmp/a");
    expect(useGithubStore.getState().isLoadingPrs).toBe(true);
    resolveFn!([]);
    await promise;
    expect(useGithubStore.getState().isLoadingPrs).toBe(false);
  });

  it("loadAssignableUsers populates assignableUsers from the backend", async () => {
    (tauriLib.invokeListAssignableUsers as any).mockResolvedValue(["alice", "bob"]);

    await useGithubStore.getState().loadAssignableUsers("/tmp/a");

    expect(tauriLib.invokeListAssignableUsers).toHaveBeenCalledWith("/tmp/a");
    expect(useGithubStore.getState().assignableUsers).toEqual(["alice", "bob"]);
  });
});
```

- [ ] **Step 2: Run the test file and confirm the new/changed tests fail**

Run: `npx vitest run src/__tests__/githubStore.test.ts`
Expected: FAIL — `openPullRequest` still does the old thing (no `selectedPrNumber`/`prDetail`/`prComments` state), `closePullRequestDetail`/`addComment` don't exist yet.

- [ ] **Step 3: Rewrite `src/store/githubStore.ts`**

Replace the full file:

```typescript
import { create } from "zustand";
import {
  invokeGetGithubStatus,
  invokeListPullRequests,
  invokeFetchPrRef,
  invokeGetPullRequest,
  invokeListGithubBranches,
  invokeListAssignableUsers,
  invokeListPrComments,
  invokeAddPrComment,
  type GithubStatus,
  type PullRequest,
  type PullRequestDetail,
  type PrComment,
} from "../lib/tauri";
import { setQualifier as upsertQualifier } from "../lib/qualifierQuery";

interface GithubState {
  query: string;
  setQuery: (query: string) => void;
  setQualifier: (key: string, value: string | null) => void;

  status: GithubStatus | null;
  loadStatus: (repoPath: string) => Promise<void>;

  pullRequests: PullRequest[];
  isLoadingPrs: boolean;
  searchPullRequests: (repoPath: string) => Promise<void>;

  selectedPrNumber: number | null;
  prDetail: PullRequestDetail | null;
  prComments: PrComment[];
  openPullRequest: (repoPath: string, number: number) => Promise<void>;
  closePullRequestDetail: () => void;
  addComment: (repoPath: string, body: string) => Promise<void>;

  branches: string[];
  isLoadingBranches: boolean;
  loadBranches: (repoPath: string) => Promise<void>;

  assignableUsers: string[];
  isLoadingAssignableUsers: boolean;
  loadAssignableUsers: (repoPath: string) => Promise<void>;
}

export const useGithubStore = create<GithubState>((set, get) => ({
  query: "",
  setQuery: (query: string) => set({ query }),
  setQualifier: (key: string, value: string | null) => {
    set({ query: upsertQualifier(get().query, key, value) });
  },

  status: null,
  loadStatus: async (repoPath: string) => {
    const status = await invokeGetGithubStatus(repoPath);
    set({ status });
  },

  pullRequests: [],
  isLoadingPrs: false,
  searchPullRequests: async (repoPath: string) => {
    set({ isLoadingPrs: true });
    try {
      const pullRequests = await invokeListPullRequests(repoPath, get().query);
      set({ pullRequests });
    } finally {
      set({ isLoadingPrs: false });
    }
  },

  selectedPrNumber: null,
  prDetail: null,
  prComments: [],
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

  branches: [],
  isLoadingBranches: false,
  loadBranches: async (repoPath: string) => {
    set({ isLoadingBranches: true });
    try {
      const branches = await invokeListGithubBranches(repoPath);
      set({ branches });
    } finally {
      set({ isLoadingBranches: false });
    }
  },

  assignableUsers: [],
  isLoadingAssignableUsers: false,
  loadAssignableUsers: async (repoPath: string) => {
    set({ isLoadingAssignableUsers: true });
    try {
      const assignableUsers = await invokeListAssignableUsers(repoPath);
      set({ assignableUsers });
    } finally {
      set({ isLoadingAssignableUsers: false });
    }
  },
}));
```

(This drops the `useUiStore`/`useViewStore` imports and the old `selectCommit`/`setActiveView("repo")` side effect entirely — opening a PR no longer touches the commit graph or view store at all.)

- [ ] **Step 4: Run the test file and confirm all tests pass**

Run: `npx vitest run src/__tests__/githubStore.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: No commit.** Move to Task 7.

---

### Task 7: `PullRequestDetail` component

**Files:**
- Modify: `package.json` (add `react-markdown` dependency)
- Create: `src/components/PullRequestDetail.tsx`
- Test: `src/__tests__/PullRequestDetail.test.tsx`

**Interfaces:**
- Consumes: `useWorkspaceStore` (`activeRepoId`, `repos`), `useGithubStore` (`selectedPrNumber`, `prDetail`, `prComments`, `addComment`, `closePullRequestDetail`), `hashHue` (`src/lib/hashColor.ts`), `initials`/`statusLabel` (`src/lib/prDisplay.ts`, Task 5).
- Produces: `export default function PullRequestDetail(): JSX.Element | null` — no props, fully self-contained.

- [ ] **Step 1: Add the `react-markdown` dependency**

Run: `npm install react-markdown`
Expected: `package.json`'s `dependencies` gains a `react-markdown` entry; `package-lock.json` updates.

- [ ] **Step 2: Write the failing tests**

Create `src/__tests__/PullRequestDetail.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useGithubStore } from "../store/githubStore";

vi.mock("../lib/tauri", () => ({
  invokeGetGithubStatus: vi.fn(),
  invokeListPullRequests: vi.fn(),
  invokeFetchPrRef: vi.fn(),
  invokeGetPullRequest: vi.fn(),
  invokeListGithubBranches: vi.fn(),
  invokeListAssignableUsers: vi.fn(),
  invokeListPrComments: vi.fn(),
  invokeAddPrComment: vi.fn(),
}));

import * as tauriLib from "../lib/tauri";
import PullRequestDetail from "../components/PullRequestDetail";

const samplePr = {
  number: 42,
  title: "Fix the thing",
  author: "yarinmag",
  headRefName: "fix-thing",
  baseRefName: "main",
  state: "OPEN",
  isDraft: false,
  labels: ["bug"],
  updatedAt: "2026-07-10T12:00:00Z",
  url: "https://github.com/acme/widgets/pull/42",
};

describe("PullRequestDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
    });
    useGithubStore.setState({
      selectedPrNumber: 42,
      prDetail: { pullRequest: samplePr, commits: [], body: "**bold** body" },
      prComments: [],
    });
  });

  it("renders the PR body as markdown", () => {
    render(<PullRequestDetail />);
    const strong = screen.getByText("bold");
    expect(strong.tagName).toBe("STRONG");
  });

  it("shows 'No comments yet' when there are no comments", () => {
    render(<PullRequestDetail />);
    expect(screen.getByText("No comments yet")).toBeInTheDocument();
  });

  it("renders each comment's author and body", () => {
    useGithubStore.setState({
      prComments: [{ id: 1, author: "avery", body: "Looks good", createdAt: "2026-07-20T10:00:00Z", url: "u" }],
    });
    render(<PullRequestDetail />);
    expect(screen.getByText("avery")).toBeInTheDocument();
    expect(screen.getByText("Looks good")).toBeInTheDocument();
  });

  it("posts a comment and appends it to the list", async () => {
    (tauriLib.invokeAddPrComment as any).mockResolvedValue({
      id: 2,
      author: "yarinmag",
      body: "Thanks!",
      createdAt: "now",
      url: "u",
    });
    render(<PullRequestDetail />);

    fireEvent.change(screen.getByPlaceholderText("Leave a comment"), { target: { value: "Thanks!" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() => {
      expect(tauriLib.invokeAddPrComment).toHaveBeenCalledWith("/tmp/a", 42, "Thanks!");
    });
    await waitFor(() => {
      expect(screen.getByText("Thanks!")).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText("Leave a comment")).toHaveValue("");
  });

  it("keeps the draft text and shows an error when posting fails", async () => {
    (tauriLib.invokeAddPrComment as any).mockRejectedValue("network error");
    render(<PullRequestDetail />);

    fireEvent.change(screen.getByPlaceholderText("Leave a comment"), { target: { value: "Thanks!" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() => {
      expect(screen.getByText("network error")).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText("Leave a comment")).toHaveValue("Thanks!");
  });

  it("calls closePullRequestDetail when the back button is clicked", () => {
    render(<PullRequestDetail />);
    fireEvent.click(screen.getByRole("button", { name: /Back to Pull Requests/ }));
    expect(useGithubStore.getState().selectedPrNumber).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npx vitest run src/__tests__/PullRequestDetail.test.tsx`
Expected: FAIL — `Cannot find module '../components/PullRequestDetail'`

- [ ] **Step 4: Create `src/components/PullRequestDetail.tsx`**

```tsx
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { ArrowLeft } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useGithubStore } from "../store/githubStore";
import { hashHue } from "../lib/hashColor";
import { initials, statusLabel } from "../lib/prDisplay";

export default function PullRequestDetail() {
  const { activeRepoId, repos } = useWorkspaceStore();
  const { selectedPrNumber, prDetail, prComments, addComment, closePullRequestDetail } = useGithubStore();
  const activeRepo = repos.find((r) => r.id === activeRepoId);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!prDetail || selectedPrNumber == null) return null;
  const pr = prDetail.pullRequest;
  const status = statusLabel(pr);

  const handleSubmit = async () => {
    if (!activeRepo || !draft.trim()) return;
    setPosting(true);
    setError(null);
    try {
      await addComment(activeRepo.path, draft);
      setDraft("");
    } catch (e) {
      setError(String(e));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary"
          onClick={closePullRequestDetail}
        >
          <ArrowLeft size={14} /> Back to Pull Requests
        </button>
      </div>
      <div className="px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-semibold shrink-0 text-white"
            style={{ backgroundColor: `hsl(${hashHue(pr.author)}, 55%, 45%)` }}
            title={pr.author}
          >
            {initials(pr.author)}
          </span>
          <span className="font-medium text-text-primary">
            #{pr.number} {pr.title}
          </span>
          <span data-testid="pr-status-badge" className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${status.className}`}>
            {status.label}
          </span>
        </div>
        <div className="text-xs text-text-muted mt-1">
          <code>{pr.baseRefName}</code> ← <code>{pr.headRefName}</code>
        </div>
      </div>
      <div className="flex border-b border-border-subtle">
        <button type="button" className="px-3 py-2 text-xs font-medium border-b-2 border-accent text-text-primary">
          Conversation
        </button>
        <button
          type="button"
          disabled
          title="Coming soon"
          className="px-3 py-2 text-xs font-medium text-text-muted opacity-50 cursor-not-allowed"
        >
          Files changed
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
        {prDetail.body.trim() && (
          <div className="text-text-primary text-sm leading-relaxed">
            <ReactMarkdown>{prDetail.body}</ReactMarkdown>
          </div>
        )}
        <div className="flex flex-col gap-3">
          {prComments.length === 0 ? (
            <div className="text-xs text-text-muted">No comments yet</div>
          ) : (
            prComments.map((comment) => (
              <div key={comment.id} className="flex gap-2">
                <span
                  className="flex items-center justify-center w-6 h-6 rounded-full text-[9px] font-semibold shrink-0 text-white"
                  style={{ backgroundColor: `hsl(${hashHue(comment.author)}, 55%, 45%)` }}
                  title={comment.author}
                >
                  {initials(comment.author)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-text-muted mb-1">
                    <span className="font-medium text-text-primary">{comment.author}</span> · {comment.createdAt}
                  </div>
                  <div className="text-text-primary text-sm leading-relaxed">
                    <ReactMarkdown>{comment.body}</ReactMarkdown>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="border-t border-border-subtle p-3 flex flex-col gap-2">
        <textarea
          className="w-full min-h-20 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary outline-none text-sm"
          placeholder="Leave a comment"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        {error && <span className="text-xs text-danger">{error}</span>}
        <div>
          <button
            type="button"
            className="px-3 py-1.5 bg-accent text-accent-contrast rounded text-xs font-medium disabled:opacity-50"
            onClick={handleSubmit}
            disabled={posting || !draft.trim()}
          >
            Comment
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run src/__tests__/PullRequestDetail.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 6: No commit.** Move to Task 8.

---

### Task 8: Wire `PullRequestDetail` into `PullRequestsScreen`

**Files:**
- Modify: `src/components/PullRequestsScreen.tsx`
- Modify: `src/__tests__/PullRequestsScreen.test.tsx`

**Interfaces:**
- Consumes: `PullRequestDetail` (Task 7), `selectedPrNumber` (from `useGithubStore`, Task 6).

- [ ] **Step 1: Write the failing/updated tests**

In `src/__tests__/PullRequestsScreen.test.tsx`, replace the `vi.mock("../lib/tauri", ...)` factory:

```tsx
vi.mock("../lib/tauri", () => ({
  invokeGetGithubStatus: vi.fn(),
  invokeListPullRequests: vi.fn(),
  invokeFetchPrRef: vi.fn(),
  invokeGetPullRequest: vi.fn(),
  invokeListGithubBranches: vi.fn(),
  invokeListAssignableUsers: vi.fn(),
  invokeListPrComments: vi.fn(),
  invokeAddPrComment: vi.fn(),
}));
```

Replace the `beforeEach`'s `useGithubStore.setState({...})` call:

```tsx
    useGithubStore.setState({
      query: "",
      status: { available: true, owner: "acme", repo: "widgets", reason: null },
      pullRequests: [],
      isLoadingPrs: false,
      branches: [],
      selectedPrNumber: null,
      prDetail: null,
      prComments: [],
    });
```

(This closes a real test-isolation gap: without resetting these three fields every test, a PR opened by one test would leak into the next test in this same file, since Zustand store state is a module-level singleton across tests.)

Replace the `"clicking a PR row opens it"` test:

```tsx
  it("clicking a PR row opens its detail view", async () => {
    (tauriLib.invokeFetchPrRef as any).mockResolvedValue(undefined);
    (tauriLib.invokeGetPullRequest as any).mockResolvedValue({
      pullRequest: samplePr,
      commits: [{ oid: "c1", messageHeadline: "fix" }],
      body: "",
    });
    (tauriLib.invokeListPrComments as any).mockResolvedValue([]);
    (tauriLib.invokeListPullRequests as any).mockResolvedValue([samplePr]);

    render(<PullRequestsScreen />);
    await waitFor(() => {
      expect(screen.getByText("Fix the thing")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Fix the thing"));

    await waitFor(() => {
      expect(tauriLib.invokeFetchPrRef).toHaveBeenCalledWith("/tmp/a", 42);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Back to Pull Requests/ })).toBeInTheDocument();
    });
  });
```

- [ ] **Step 2: Run the test file and confirm the changed test fails**

Run: `npx vitest run src/__tests__/PullRequestsScreen.test.tsx`
Expected: FAIL on `"clicking a PR row opens its detail view"` — no back button renders yet, since `PullRequestsScreen.tsx` doesn't render `PullRequestDetail` yet.

- [ ] **Step 3: Wire the detail view into `PullRequestsScreen.tsx`**

Add this import near the top (alongside the other `./...` component imports):

```tsx
import PullRequestDetail from "./PullRequestDetail";
```

Add `selectedPrNumber` to the existing destructure of `useGithubStore()`:

```tsx
  const {
    query,
    setQuery,
    setQualifier,
    status,
    pullRequests,
    isLoadingPrs,
    searchPullRequests,
    openPullRequest,
    branches,
    isLoadingBranches,
    loadBranches,
    assignableUsers,
    isLoadingAssignableUsers,
    loadAssignableUsers,
    selectedPrNumber,
  } = useGithubStore();
```

Add this branch directly after the existing `status.available` early return:

```tsx
  if (status && !status.available) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-text-muted p-4 text-center">
        {status.reason}
      </div>
    );
  }

  if (selectedPrNumber != null) {
    return <PullRequestDetail />;
  }
```

- [ ] **Step 4: Run the test file and confirm all tests pass**

Run: `npx vitest run src/__tests__/PullRequestsScreen.test.tsx`
Expected: PASS (same count as before this task — one test rewritten, none added or removed)

- [ ] **Step 5: No commit.** Move to Task 9.

---

### Task 9: Full regression

**Files:** none (verification only)

- [ ] **Step 1: Run the full frontend suite**

Run: `npx vitest run`
Expected: all green except the one documented pre-existing `Toolbar.test.tsx` Push-button failure (predates this plan and the Nest redesign plan before it).

- [ ] **Step 2: Run the full backend suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS, all tests (baseline 82 + 4 new = 86)

- [ ] **Step 3: Run the e2e suite**

Run: `npm run e2e`
Expected: the same 3 pre-existing failures documented in `docs/superpowers/plans/2026-07-22-nest-ui-redesign.md`'s Task 8 findings (`WorkingCopyPanel` commented out; stale `get_branches` mock shape in `e2e/mockTauri.ts`) — unrelated to this plan, since no e2e spec exercises the PR-open flow today. If a new failure appears that traces to this plan's changes (e.g. an e2e spec that clicks a PR row and expected the old jump-to-commit behavior), fix the spec to expect the new detail view rather than reverting the feature.

- [ ] **Step 4: No commit** — this plan's work is complete once all three suites are green (with only the documented pre-existing exceptions).

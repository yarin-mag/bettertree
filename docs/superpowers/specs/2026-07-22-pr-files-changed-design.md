# PR Files Changed (Phase 2 of GitHub-style PR detail)

Date: 2026-07-22

## Purpose

Builds the "Files changed" tab left disabled in the Conversation-view spec: the full base→head diff for a PR, rendered with GitHub-style inline review comments anchored to specific lines — click a line, leave a comment; existing comments render inline at their line; posting goes straight to GitHub via the same `gh` CLI pattern used everywhere else in this app. Decisions already locked from the earlier brainstorm (before Phase 1 was built): tabbed navigation (built), per-line GitHub-parity commenting (not per-file), full view + post (not read-only).

## Backend: computing the diff

`get_commit_diff` (`src-tauri/src/diff.rs:30-126`) already proves the core primitive is generic: `repo.diff_tree_to_tree(Option<&Tree>, Option<&Tree>, None)` (line 40) takes two arbitrary trees, and the `.foreach`/`.print` passes that follow operate purely on `Delta`/`DiffLine` — nothing there is actually coupled to "commit vs its parent" beyond which two trees get passed in.

**This spec does not touch `diff.rs`.** `FileDiff`'s output shape (a raw concatenated `patch: String`, later reparsed client-side by `parseDiffLines`) has no line numbers at all — confirmed by reading `src/lib/diffLines.ts` in full: `DiffLine` is just `{ type, content }`. Reusing it would mean bolting line-number tracking onto a string-reparsing pipeline that was never designed for it, and would risk the 84 passing `diff.rs`/`DiffViewer`/commit-diff tests for no benefit, since a PR diff and a commit diff have different needs (comment-anchoring requires exact line numbers; the existing raw-patch approach doesn't carry them). Instead: a new, self-contained module, `src-tauri/src/pr_diff.rs`, structurally similar to `diff.rs` but emitting **structured lines with line numbers already attached** (`git2::DiffLine::old_lineno()`/`new_lineno()` give these directly — no hand-parsing of `@@` hunk headers needed).

```rust
use crate::error::AppError;
use git2::{Delta, Repository};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLineInfo {
    pub kind: String, // "add" | "del" | "context"
    pub content: String,
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrFileDiff {
    pub path: String,
    pub status: String,
    pub lines: Vec<DiffLineInfo>,
    pub insertions: usize,
    pub deletions: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrDiff {
    pub base_oid: String,
    pub head_oid: String,
    pub files: Vec<PrFileDiff>,
}

/// Resolves a PR's locally-fetched head commit (`fetch_pr_ref` must have run
/// already — it always has, since opening a PR's detail view calls it before
/// anything else). Shared by `diff_pr` and the review-comment-posting command,
/// which needs the head SHA as GitHub's `commit_id` parameter.
pub fn resolve_pr_head_oid(repo_path: &str, number: u64) -> Result<String, AppError> {
    let repo = Repository::open(repo_path)?;
    let head_ref_name = format!("refs/remotes/origin/pr/{number}");
    let commit = repo
        .revparse_single(&head_ref_name)
        .map_err(|_| AppError::Operation(format!("PR #{number}'s head ref isn't fetched locally yet")))?
        .peel_to_commit()?;
    Ok(commit.id().to_string())
}

fn resolve_base_commit<'repo>(repo: &'repo Repository, base_ref_name: &str) -> Result<git2::Commit<'repo>, AppError> {
    let remote_ref = format!("refs/remotes/origin/{base_ref_name}");
    if let Ok(obj) = repo.revparse_single(&remote_ref) {
        return Ok(obj.peel_to_commit()?);
    }
    let obj = repo.revparse_single(base_ref_name).map_err(|_| {
        AppError::Operation(format!("could not resolve base branch '{base_ref_name}' locally"))
    })?;
    Ok(obj.peel_to_commit()?)
}

/// Diffs a PR's head against the merge-base of its base branch (a three-dot
/// diff, same semantics GitHub's own "Files changed" tab uses) — this is
/// what excludes unrelated commits the base branch has picked up since the
/// PR forked, showing only what the PR itself changed.
pub fn diff_pr(repo_path: &str, number: u64, base_ref_name: &str) -> Result<PrDiff, AppError> {
    let repo = Repository::open(repo_path)?;

    let head_ref_name = format!("refs/remotes/origin/pr/{number}");
    let head_commit = repo
        .revparse_single(&head_ref_name)
        .map_err(|_| AppError::Operation(format!("PR #{number}'s head ref isn't fetched locally yet")))?
        .peel_to_commit()?;

    let base_commit = resolve_base_commit(&repo, base_ref_name)?;
    let merge_base_oid = repo.merge_base(base_commit.id(), head_commit.id())?;
    let merge_base_commit = repo.find_commit(merge_base_oid)?;

    let old_tree = merge_base_commit.tree()?;
    let new_tree = head_commit.tree()?;
    let diff = repo.diff_tree_to_tree(Some(&old_tree), Some(&new_tree), None)?;

    let mut files: Vec<PrFileDiff> = Vec::new();
    let mut index_by_path: HashMap<String, usize> = HashMap::new();
    diff.foreach(
        &mut |delta, _progress| {
            let path = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let status = match delta.status() {
                Delta::Added => "added",
                Delta::Deleted => "deleted",
                Delta::Renamed => "renamed",
                _ => "modified",
            }
            .to_string();
            index_by_path.insert(path.clone(), files.len());
            files.push(PrFileDiff { path, status, lines: Vec::new(), insertions: 0, deletions: 0 });
            true
        },
        None,
        None,
        None,
    )?;

    diff.print(git2::DiffFormat::Patch, |delta, _hunk, line| {
        if !matches!(line.origin(), '+' | '-' | ' ') {
            return true;
        }
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        if let Some(&idx) = index_by_path.get(&path) {
            let kind = match line.origin() {
                '+' => "add",
                '-' => "del",
                _ => "context",
            };
            match kind {
                "add" => files[idx].insertions += 1,
                "del" => files[idx].deletions += 1,
                _ => {}
            }
            files[idx].lines.push(DiffLineInfo {
                kind: kind.to_string(),
                content: String::from_utf8_lossy(line.content()).trim_end_matches('\n').to_string(),
                old_line: line.old_lineno(),
                new_line: line.new_lineno(),
            });
        }
        true
    })?;

    Ok(PrDiff { base_oid: merge_base_oid.to_string(), head_oid: head_commit.id().to_string(), files })
}
```

## Backend: review comments (`gh` CLI, same pattern as Phase 1's issue comments)

GitHub's REST "review comments" endpoint (`/repos/{owner}/{repo}/pulls/{number}/comments`) is the diff-anchored sibling of Phase 1's issue-comments endpoint. Creating one is a single, immediate call — no "start a review, batch comments, submit" workflow needed (that's only required for a *pending review* with an approve/request-changes verdict, which is out of scope here).

New types/functions in `github.rs`, next to `PrComment`/`list_pr_comments`/`add_pr_comment`:

```rust
#[derive(Debug, Clone, Deserialize)]
struct GhReviewCommentJson {
    id: u64,
    user: GhCommentUserJson,
    body: String,
    created_at: String,
    path: String,
    line: Option<u32>,
    original_line: Option<u32>,
    side: String,
    html_url: String,
}

/// A single GitHub-style review comment, anchored to a specific line of a
/// specific file's diff.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrReviewComment {
    pub id: u64,
    pub author: String,
    pub body: String,
    pub created_at: String,
    pub path: String,
    pub line: u32,
    pub side: String,
    pub url: String,
}

/// Lists a pull request's inline review comments (Files-changed-tab).
/// Comments whose diff position has gone stale enough that GitHub reports
/// neither `line` nor `original_line` are dropped — they can't be anchored
/// to a line in the current diff anyway.
pub fn list_pr_review_comments(
    runner: &dyn GhRunner,
    owner: &str,
    repo: &str,
    number: u64,
) -> Result<Vec<PrReviewComment>, AppError> {
    let endpoint = format!("repos/{owner}/{repo}/pulls/{number}/comments");
    let output = runner.run(&["api", &endpoint, "--paginate"])?;
    let parsed: Vec<GhReviewCommentJson> = serde_json::from_str(&output)
        .map_err(|e| AppError::Operation(format!("failed to parse gh pr review comments output: {e}")))?;
    Ok(parsed
        .into_iter()
        .filter_map(|json| {
            let line = json.line.or(json.original_line)?;
            Some(PrReviewComment {
                id: json.id,
                author: json.user.login,
                body: json.body,
                created_at: json.created_at,
                path: json.path,
                line,
                side: json.side,
                url: json.html_url,
            })
        })
        .collect())
}

/// Posts a new review comment anchored to a single line. `commit_id` must be
/// the PR's current head SHA (resolved by the caller via
/// `pr_diff::resolve_pr_head_oid`, not passed in from the frontend).
pub fn add_pr_review_comment(
    runner: &dyn GhRunner,
    owner: &str,
    repo: &str,
    number: u64,
    commit_id: &str,
    path: &str,
    line: u32,
    side: &str,
    body: &str,
) -> Result<PrReviewComment, AppError> {
    let endpoint = format!("repos/{owner}/{repo}/pulls/{number}/comments");
    let body_arg = format!("body={body}");
    let commit_arg = format!("commit_id={commit_id}");
    let path_arg = format!("path={path}");
    let line_arg = format!("line={line}");
    let side_arg = format!("side={side}");
    let output = runner.run(&[
        "api", &endpoint, "-X", "POST",
        "-f", &body_arg,
        "-f", &commit_arg,
        "-f", &path_arg,
        "-F", &line_arg,
        "-f", &side_arg,
    ])?;
    let parsed: GhReviewCommentJson = serde_json::from_str(&output)
        .map_err(|e| AppError::Operation(format!("failed to parse gh add review comment output: {e}")))?;
    let line = parsed.line.or(parsed.original_line).unwrap_or(line);
    Ok(PrReviewComment {
        id: parsed.id,
        author: parsed.user.login,
        body: parsed.body,
        created_at: parsed.created_at,
        path: parsed.path,
        line,
        side: parsed.side,
        url: parsed.html_url,
    })
}
```

(`-F line=...` uses `gh api`'s typed-field flag so the value is sent as a JSON number, not a string — every other field here is `-f`/string, matching the existing convention in `add_pr_comment`.)

## Tauri commands

```rust
#[tauri::command]
pub async fn get_pr_diff(repo_path: String, number: u64, base_ref_name: String) -> Result<PrDiff, AppError> {
    run_blocking(move || pr_diff::diff_pr(&repo_path, number, &base_ref_name)).await
}

#[tauri::command]
pub async fn list_pr_review_comments(repo_path: String, number: u64) -> Result<Vec<PrReviewComment>, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        github::list_pr_review_comments(&SystemGhRunner, &owner, &repo, number)
    })
    .await
}

#[tauri::command]
pub async fn add_pr_review_comment(
    repo_path: String,
    number: u64,
    path: String,
    line: u32,
    side: String,
    body: String,
) -> Result<PrReviewComment, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        let commit_id = pr_diff::resolve_pr_head_oid(&repo_path, number)?;
        github::add_pr_review_comment(&SystemGhRunner, &owner, &repo, number, &commit_id, &path, line, &side, &body)
    })
    .await
}
```

`lib.rs` gains `mod pr_diff;` and the three commands in `generate_handler!`.

## Frontend

### Types/wrappers (`src/lib/tauri.ts`)

```typescript
export interface DiffLineInfo {
  kind: "add" | "del" | "context";
  content: string;
  oldLine: number | null;
  newLine: number | null;
}
export interface PrFileDiff {
  path: string;
  status: string;
  lines: DiffLineInfo[];
  insertions: number;
  deletions: number;
}
export interface PrDiff {
  baseOid: string;
  headOid: string;
  files: PrFileDiff[];
}
export interface PrReviewComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  url: string;
}

export const invokeGetPrDiff = (repoPath: string, number: number, baseRefName: string) =>
  invoke<PrDiff>("get_pr_diff", { repoPath, number, baseRefName });
export const invokeListPrReviewComments = (repoPath: string, number: number) =>
  invoke<PrReviewComment[]>("list_pr_review_comments", { repoPath, number });
export const invokeAddPrReviewComment = (
  repoPath: string,
  number: number,
  path: string,
  line: number,
  side: "LEFT" | "RIGHT",
  body: string
) => invoke<PrReviewComment>("add_pr_review_comment", { repoPath, number, path, line, side, body });
```

### New store: `src/store/prDiffStore.ts`

A dedicated store, not folded into `githubStore.ts` — matches this codebase's existing convention of one small Zustand store per concern (`viewStore`, `themeStore`, `searchStore`, `workspaceStore`, `uiStore`, `workingCopyStore` already exist as separate files), and keeps `githubStore.ts` (already grown across two prior specs) and its test suite untouched.

```typescript
import { create } from "zustand";
import {
  invokeGetPrDiff,
  invokeListPrReviewComments,
  invokeAddPrReviewComment,
  type PrDiff,
  type PrReviewComment,
} from "../lib/tauri";

interface PrDiffState {
  diff: PrDiff | null;
  reviewComments: PrReviewComment[];
  isLoadingDiff: boolean;
  loadDiff: (repoPath: string, number: number, baseRefName: string) => Promise<void>;
  addReviewComment: (
    repoPath: string,
    number: number,
    path: string,
    line: number,
    side: "LEFT" | "RIGHT",
    body: string
  ) => Promise<void>;
  clearDiff: () => void;
}

export const usePrDiffStore = create<PrDiffState>((set, get) => ({
  diff: null,
  reviewComments: [],
  isLoadingDiff: false,
  loadDiff: async (repoPath, number, baseRefName) => {
    set({ isLoadingDiff: true });
    try {
      const [diff, reviewComments] = await Promise.all([
        invokeGetPrDiff(repoPath, number, baseRefName),
        invokeListPrReviewComments(repoPath, number),
      ]);
      set({ diff, reviewComments });
    } finally {
      set({ isLoadingDiff: false });
    }
  },
  addReviewComment: async (repoPath, number, path, line, side, body) => {
    const comment = await invokeAddPrReviewComment(repoPath, number, path, line, side, body);
    set({ reviewComments: [...get().reviewComments, comment] });
  },
  clearDiff: () => set({ diff: null, reviewComments: [] }),
}));
```

### `PullRequestDetail.tsx` changes

- Local `activeTab: "conversation" | "files"` state (`useState`, purely ephemeral UI — resets to `"conversation"` each time a PR is (re)opened, which is the right default).
- "Files changed" button loses `disabled`/`title="Coming soon"`, gains `onClick={() => setActiveTab("files")}`; "Conversation" button gets the matching `onClick`. Active tab gets the `border-b-2 border-accent` treatment, inactive tab gets muted styling.
- A `useEffect` keyed on `[activeTab, selectedPrNumber]`: when `activeTab === "files"` and `usePrDiffStore.getState().diff` is null (or belongs to a different PR — cleared via `clearDiff()` whenever `selectedPrNumber` changes), calls `loadDiff(activeRepo.path, selectedPrNumber, pr.baseRefName)`. This means the diff is fetched lazily on first switch to the tab, not eagerly when the PR opens — most PR opens are to read/comment on the conversation, not the diff.
- Conversation-tab JSX (today's body) renders only when `activeTab === "conversation"`; a new `<FilesChangedTab />` renders when `activeTab === "files"`.

### New component: `src/components/FilesChangedTab.tsx`

Self-contained (reads `usePrDiffStore`, `useWorkspaceStore`, and `useGithubStore` for `selectedPrNumber` — no props). Per file: a bordered card (same visual language as the Conversation tab's comment cards) with a header strip (`path`, `+insertions`/`-deletions` in `success`/`danger`) and a monospace line list below.

Each line renders: an old-line-number gutter cell, a new-line-number gutter cell (whichever side doesn't apply for that line kind is blank), a `+`/`-`/` ` marker, the line content, and a small "comment" button in the gutter — **always visible, not hover-revealed** (jsdom/testing-library can't simulate real `:hover`, and an always-visible affordance is simpler and equally discoverable). Clicking it opens an inline composer directly under that line; only one composer is open at a time (opening a second closes the first — a deliberate v1 simplification, not full multi-composer support). Any existing `PrReviewComment`s matching that exact `(path, side, line)` render as cards directly under the line, using the same `Markdown` component from `PullRequestDetail.tsx` (imported, not duplicated) for the body.

Side/line derivation per rendered row: `del` lines anchor `side: "LEFT"`, `line: oldLine`; `add` and `context` lines anchor `side: "RIGHT"`, `line: newLine` (GitHub's own convention — a context line is always commentable on the right/new side).

## Explicit scope simplifications (called out, not silently dropped)

- **No syntax highlighting** in this diff view (unlike `DiffViewer`'s commit-diff view, which highlights via `shiki`) — plain monospace text. Adding it would mean either wiring `FilesChangedTab` into `DiffViewer`'s existing highlighting pipeline (which isn't shaped for per-line comment anchoring — see "Backend: computing the diff" above for why that pipeline isn't reused) or duplicating a second highlighting pass; both are real scope, deferred.
- **Unified view only** — no side-by-side toggle (GitHub's own PR diff view defaults to unified too; side-by-side is a nice-to-have, not requested).
- **Single-line comments only** — no multi-line range comments (GitHub's `start_line`/`start_side` parameters aren't sent).
- **One open composer at a time** across the whole diff.
- **All files always expanded** — no collapse/expand-per-file (GitHub has this; skipped for v1).
- Comments whose diff position is too stale for GitHub to report either `line` or `original_line` are dropped from the list entirely (can't be anchored to any line in the current diff) — same rare edge case GitHub itself surfaces awkwardly.

## Testing

- **Rust**: `pr_diff.rs` gets its own `#[cfg(test)] mod tests` using `test_support::init_repo_with_commits` as a base, then building a synthetic "PR head" commit that branches off the *first* commit (independent of the second commit's change) and registering it at `refs/remotes/origin/pr/<n>` directly via `repo.reference(...)` — this lets a test assert that the diff excludes the base branch's own unrelated change (proving the merge-base exclusion actually works, not just that *some* diff comes back) and that `base_oid` equals the merge-base (not the base branch's tip). Plus a test for `resolve_pr_head_oid`'s error message when the ref isn't fetched, and one for `resolve_base_commit`'s error when the base branch name doesn't resolve at all.
- **Rust, `github.rs`**: same `FakeGhRunner` pattern as Phase 1's comment tests — `list_pr_review_comments` (parses the array, drops an entry with neither `line` nor `original_line`) and `add_pr_review_comment` (asserts the exact `-X POST -f/-F` args, including `-F line=...`).
- **Frontend, `prDiffStore.test.ts`**: `loadDiff` populates both `diff` and `reviewComments` and toggles `isLoadingDiff`; `addReviewComment` appends the posted comment; `clearDiff` resets both.
- **Frontend, `FilesChangedTab.test.tsx`**: renders a file's lines with gutter numbers; renders an existing review comment anchored under its correct line; clicking a line's comment button opens a composer, posting calls `invokeAddPrReviewComment` with the right `path`/`line`/`side`, and the new comment appears under that line; opening a second composer closes the first.
- **`PullRequestDetail.tsx`**: a test asserting that switching to the "Files changed" tab triggers `loadDiff` (via `usePrDiffStore`) and renders `FilesChangedTab`, and that switching back to "Conversation" shows the body/comments again without re-fetching.
- Full regression (`cargo test` + `npm test` + `npm run e2e`) at the end.

## Out of Scope

- Approve / Request changes / pending-review-with-verdict workflow (GitHub's "start a review" batching) — every comment posts immediately, same as Phase 1's Conversation comments.
- Multi-line range comments, comment resolution/outdated-thread UI, suggested changes.
- Collapsing individual files, "Viewed" checkboxes, split/side-by-side diff view, syntax highlighting.
- Any change to `diff.rs`, `DiffViewer.tsx`, `diffLines.ts`, or the existing commit-diff feature — this is a fully separate code path.

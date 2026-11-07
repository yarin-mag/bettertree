# PR Files Changed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the "Files changed" tab (left as a disabled placeholder in `docs/superpowers/specs/2026-07-22-pr-conversation-view-design.md`) with a full base→head diff and GitHub-style inline review comments anchored to lines, per `docs/superpowers/specs/2026-07-22-pr-files-changed-design.md`.

**Architecture:** New, self-contained backend module `src-tauri/src/pr_diff.rs` (local git2 tree-diff, merge-base vs head — no GitHub API call needed for the diff itself), plus new `gh api` review-comment read/write functions in `github.rs`. Frontend: a new dedicated `prDiffStore.ts`, a new `FilesChangedTab.tsx` component, and a small tab-switch wire-up in `PullRequestDetail.tsx`. `Markdown` gets extracted out of `PullRequestDetail.tsx` into its own file so both components can use it.

**Tech Stack:** Rust + `git2` (local diff) + `gh` CLI (review comments), React + TypeScript, Zustand, Vitest + Testing Library, Rust's built-in test framework.

## Global Constraints

- **No git in this project** — every task ends with running tests, not a commit.
- **Zero changes to `diff.rs`, `DiffViewer.tsx`, `diffLines.ts`, `CommitDrawer.tsx`** — the commit-diff feature is a fully separate code path from this one (see spec's "Backend: computing the diff" for why).
- No approve/request-changes/pending-review workflow — every comment posts immediately.
- No multi-line range comments, no file collapse, no split diff view, no syntax highlighting (see spec's "Explicit scope simplifications").
- Run `npx vitest run <file>` for frontend steps; `cargo test --manifest-path src-tauri/Cargo.toml <filter>` for backend steps.

---

### Task 1: `pr_diff.rs` — diff computation

**Files:**
- Create: `src-tauri/src/pr_diff.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod pr_diff;`)

**Interfaces:**
- Produces: `pub struct DiffLineInfo { kind: String, content: String, old_line: Option<u32>, new_line: Option<u32> }`, `pub struct PrFileDiff { path, status, lines: Vec<DiffLineInfo>, insertions, deletions }`, `pub struct PrDiff { base_oid, head_oid, files: Vec<PrFileDiff> }`, `pub fn resolve_pr_head_oid(repo_path: &str, number: u64) -> Result<String, AppError>`, `pub fn diff_pr(repo_path: &str, number: u64, base_ref_name: &str) -> Result<PrDiff, AppError>`.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/pr_diff.rs` with just the test module first:

```rust
use crate::error::AppError;
use git2::{Delta, Repository};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLineInfo {
    pub kind: String,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::init_repo_with_commits;
    use git2::Signature;

    fn make_pr_head(repo: &Repository, dir: &std::path::Path, number: u64) -> (git2::Oid, git2::Oid) {
        let sig = Signature::now("Test User", "test@example.com").unwrap();
        let feature_branch = repo.find_branch("feature", git2::BranchType::Local).unwrap();
        let base_of_pr = feature_branch.get().peel_to_commit().unwrap();

        std::fs::write(dir.join("a.txt"), "one-pr-change").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("a.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let pr_head_oid = repo
            .commit(None, &sig, &sig, "pr change", &tree, &[&base_of_pr])
            .unwrap();
        repo.reference(
            &format!("refs/remotes/origin/pr/{number}"),
            pr_head_oid,
            true,
            "test pr head",
        )
        .unwrap();
        (base_of_pr.id(), pr_head_oid)
    }

    #[test]
    fn diff_pr_diffs_against_the_merge_base_not_the_base_branch_tip() {
        let (dir, repo) = init_repo_with_commits();
        let (merge_base_oid, pr_head_oid) = make_pr_head(&repo, dir.path(), 7);

        let result = diff_pr(dir.path().to_str().unwrap(), 7, "main").unwrap();

        assert_eq!(result.base_oid, merge_base_oid.to_string());
        assert_eq!(result.head_oid, pr_head_oid.to_string());
        assert_eq!(result.files.len(), 1);
        assert_eq!(result.files[0].path, "a.txt");

        let added: Vec<_> = result.files[0].lines.iter().filter(|l| l.kind == "add").collect();
        assert!(added.iter().any(|l| l.content == "one-pr-change"));
        assert!(!result.files[0].lines.iter().any(|l| l.content == "two"));
    }

    #[test]
    fn diff_pr_line_numbers_are_populated() {
        let (dir, repo) = init_repo_with_commits();
        make_pr_head(&repo, dir.path(), 7);

        let result = diff_pr(dir.path().to_str().unwrap(), 7, "main").unwrap();

        let added_line = result.files[0].lines.iter().find(|l| l.kind == "add").unwrap();
        assert_eq!(added_line.new_line, Some(1));
        assert_eq!(added_line.old_line, None);
    }

    #[test]
    fn diff_pr_errors_when_head_ref_not_fetched_locally() {
        let (dir, _repo) = init_repo_with_commits();

        let result = diff_pr(dir.path().to_str().unwrap(), 999, "main");

        assert!(result.is_err());
    }

    #[test]
    fn diff_pr_errors_when_base_branch_does_not_resolve() {
        let (dir, repo) = init_repo_with_commits();
        make_pr_head(&repo, dir.path(), 7);

        let result = diff_pr(dir.path().to_str().unwrap(), 7, "no-such-branch");

        assert!(result.is_err());
    }

    #[test]
    fn resolve_pr_head_oid_returns_the_fetched_heads_sha() {
        let (dir, repo) = init_repo_with_commits();
        let (_merge_base, pr_head_oid) = make_pr_head(&repo, dir.path(), 7);

        let oid = resolve_pr_head_oid(dir.path().to_str().unwrap(), 7).unwrap();

        assert_eq!(oid, pr_head_oid.to_string());
    }

    #[test]
    fn resolve_pr_head_oid_errors_when_not_fetched() {
        let (dir, _repo) = init_repo_with_commits();

        let result = resolve_pr_head_oid(dir.path().to_str().unwrap(), 999);

        assert!(result.is_err());
    }
}
```

- [ ] **Step 2: Register the module and run the tests to confirm they fail**

Add `mod pr_diff;` to `src-tauri/src/lib.rs`'s module list (alongside `mod github;`).

Run: `cargo test --manifest-path src-tauri/Cargo.toml pr_diff`
Expected: FAIL — compile errors, `diff_pr`/`resolve_pr_head_oid` don't exist yet.

- [ ] **Step 3: Implement `resolve_pr_head_oid` and `diff_pr`**

Add above the `#[cfg(test)]` block in `pr_diff.rs`:

```rust
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

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml pr_diff`
Expected: PASS (6 tests)

- [ ] **Step 5: No commit.** Move to Task 2.

---

### Task 2: Review comments — read (`github.rs`)

**Files:**
- Modify: `src-tauri/src/github.rs` (new `GhReviewCommentJson`/`PrReviewComment`/`list_pr_review_comments`, plus tests)
- Modify: `src-tauri/src/commands.rs` (new `list_pr_review_comments` command; `use` line gains `PrReviewComment`)
- Modify: `src-tauri/src/lib.rs` (register `commands::list_pr_review_comments`)

**Interfaces:**
- Consumes: `GhCommentUserJson` (already defined in `github.rs` from the Conversation-view spec).
- Produces: `pub struct PrReviewComment { id, author, body, created_at, path, line: u32, side: String, url }`, `pub fn list_pr_review_comments(runner, owner, repo, number) -> Result<Vec<PrReviewComment>, AppError>`, Tauri command `list_pr_review_comments(repo_path: String, number: u64) -> Result<Vec<PrReviewComment>, AppError>`.

- [ ] **Step 1: Write the failing tests in `github.rs`'s `gh_client_tests` module**

Add:

```rust
    const SAMPLE_PR_REVIEW_COMMENTS_JSON: &str = r#"[
        {
            "id": 501,
            "user": {"login": "avery"},
            "body": "why the extra retry?",
            "created_at": "2026-07-21T11:00:00Z",
            "path": "src/common/SimpleQueue.js",
            "line": 116,
            "original_line": 116,
            "side": "RIGHT",
            "html_url": "https://github.com/acme/widgets/pull/42#discussion_r501"
        },
        {
            "id": 502,
            "user": {"login": "priya"},
            "body": "stale comment, position gone",
            "created_at": "2026-07-19T09:00:00Z",
            "path": "src/common/SimpleQueue.js",
            "line": null,
            "original_line": null,
            "side": "RIGHT",
            "html_url": "https://github.com/acme/widgets/pull/42#discussion_r502"
        }
    ]"#;

    #[test]
    fn list_pr_review_comments_parses_and_drops_unanchorable_comments() {
        let runner = FakeGhRunner::ok(SAMPLE_PR_REVIEW_COMMENTS_JSON);

        let comments = list_pr_review_comments(&runner, "acme", "widgets", 42).unwrap();

        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].id, 501);
        assert_eq!(comments[0].author, "avery");
        assert_eq!(comments[0].path, "src/common/SimpleQueue.js");
        assert_eq!(comments[0].line, 116);
        assert_eq!(comments[0].side, "RIGHT");
    }

    #[test]
    fn list_pr_review_comments_calls_gh_api_with_paginate_and_repo() {
        let runner = FakeGhRunner::ok(SAMPLE_PR_REVIEW_COMMENTS_JSON);

        list_pr_review_comments(&runner, "acme", "widgets", 42).unwrap();

        let calls = runner.calls.borrow();
        let args = &calls[0];
        assert_eq!(args[0], "api");
        assert!(args.contains(&"repos/acme/widgets/pulls/42/comments".to_string()));
        assert!(args.contains(&"--paginate".to_string()));
    }
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml list_pr_review_comments`
Expected: FAIL — compile error, doesn't exist yet.

- [ ] **Step 3: Implement the types and function in `github.rs`**

Add after `add_pr_comment` (or anywhere below `PrComment`'s definitions):

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
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml list_pr_review_comments`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire the Tauri command**

In `commands.rs`, update the `use` line:

```rust
use crate::github::{self, GithubStatus, PrComment, PrReviewComment, PullRequest, PullRequestDetail, SystemGhRunner};
```

Add after `list_pr_comments`:

```rust
#[tauri::command]
pub async fn list_pr_review_comments(repo_path: String, number: u64) -> Result<Vec<PrReviewComment>, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        github::list_pr_review_comments(&SystemGhRunner, &owner, &repo, number)
    })
    .await
}
```

In `lib.rs`, add `commands::list_pr_review_comments,` right after `commands::list_pr_comments,`.

- [ ] **Step 6: Run the full backend suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS, all tests (baseline 86 + 6 from Task 1 + 2 from this task = 94)

- [ ] **Step 7: No commit.** Move to Task 3.

---

### Task 3: Review comments — post (`github.rs`)

**Files:**
- Modify: `src-tauri/src/github.rs` (new `add_pr_review_comment`, plus tests)
- Modify: `src-tauri/src/commands.rs` (new `add_pr_review_comment` command, using `pr_diff::resolve_pr_head_oid`)
- Modify: `src-tauri/src/lib.rs` (register `commands::add_pr_review_comment`)

**Interfaces:**
- Consumes: `pr_diff::resolve_pr_head_oid` (Task 1), `GhReviewCommentJson`/`PrReviewComment` (Task 2).
- Produces: `pub fn add_pr_review_comment(runner, owner, repo, number, commit_id, path, line, side, body) -> Result<PrReviewComment, AppError>`, Tauri command `add_pr_review_comment(repo_path, number, path, line: u32, side, body) -> Result<PrReviewComment, AppError>`.

- [ ] **Step 1: Write the failing tests in `github.rs`'s `gh_client_tests` module**

Add:

```rust
    const SAMPLE_ADD_REVIEW_COMMENT_JSON: &str = r#"{
        "id": 601,
        "user": {"login": "yarinmag"},
        "body": "good catch, fixing",
        "created_at": "2026-07-22T08:00:00Z",
        "path": "src/common/SimpleQueue.js",
        "line": 116,
        "original_line": 116,
        "side": "RIGHT",
        "html_url": "https://github.com/acme/widgets/pull/42#discussion_r601"
    }"#;

    #[test]
    fn add_pr_review_comment_parses_created_comment_json() {
        let runner = FakeGhRunner::ok(SAMPLE_ADD_REVIEW_COMMENT_JSON);

        let comment = add_pr_review_comment(
            &runner, "acme", "widgets", 42, "abc123", "src/common/SimpleQueue.js", 116, "RIGHT", "good catch, fixing",
        )
        .unwrap();

        assert_eq!(comment.id, 601);
        assert_eq!(comment.author, "yarinmag");
        assert_eq!(comment.path, "src/common/SimpleQueue.js");
        assert_eq!(comment.line, 116);
        assert_eq!(comment.side, "RIGHT");
    }

    #[test]
    fn add_pr_review_comment_posts_with_expected_args() {
        let runner = FakeGhRunner::ok(SAMPLE_ADD_REVIEW_COMMENT_JSON);

        add_pr_review_comment(
            &runner, "acme", "widgets", 42, "abc123", "src/common/SimpleQueue.js", 116, "RIGHT", "good catch, fixing",
        )
        .unwrap();

        let calls = runner.calls.borrow();
        let args = &calls[0];
        assert_eq!(args[0], "api");
        assert!(args.contains(&"repos/acme/widgets/pulls/42/comments".to_string()));
        assert!(args.contains(&"-X".to_string()));
        assert!(args.contains(&"POST".to_string()));
        assert!(args.contains(&"body=good catch, fixing".to_string()));
        assert!(args.contains(&"commit_id=abc123".to_string()));
        assert!(args.contains(&"path=src/common/SimpleQueue.js".to_string()));
        assert!(args.contains(&"-F".to_string()));
        assert!(args.contains(&"line=116".to_string()));
        assert!(args.contains(&"side=RIGHT".to_string()));
    }
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml add_pr_review_comment`
Expected: FAIL — compile error, `add_pr_review_comment` doesn't exist.

- [ ] **Step 3: Implement `add_pr_review_comment` in `github.rs`**

Add directly after `list_pr_review_comments`:

```rust
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

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml add_pr_review_comment`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire the Tauri command**

In `commands.rs`, add `use crate::pr_diff;` near the top (alongside other `use crate::...` lines), and add after the new `list_pr_review_comments` command:

```rust
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

In `lib.rs`, add `commands::add_pr_review_comment,` right after `commands::list_pr_review_comments,`. Also add `commands::get_pr_diff,` right after `commands::get_pull_request,` (this wires Task 1's `diff_pr` — add its command now too, since it belongs alongside the others):

```rust
#[tauri::command]
pub async fn get_pr_diff(repo_path: String, number: u64, base_ref_name: String) -> Result<PrDiff, AppError> {
    run_blocking(move || pr_diff::diff_pr(&repo_path, number, &base_ref_name)).await
}
```

(Add this to `commands.rs` near the other new commands, and update the `use crate::pr_diff::{...}` — actually `pr_diff` is imported as a module (`use crate::pr_diff;`), so reference its types as `pr_diff::PrDiff` in the return type, or add `PrDiff` to a `use crate::pr_diff::PrDiff;` import — either is fine; use `pr_diff::PrDiff` inline to keep the `use` list short.)

- [ ] **Step 6: Run the full backend suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS, all tests (94 + 2 = 96)

- [ ] **Step 7: No commit.** Move to Task 4.

---

### Task 4: Frontend types and invoke wrappers

**Files:**
- Modify: `src/lib/tauri.ts`

**Interfaces:**
- Produces: `DiffLineInfo`, `PrFileDiff`, `PrDiff`, `PrReviewComment` interfaces; `invokeGetPrDiff`, `invokeListPrReviewComments`, `invokeAddPrReviewComment`.

- [ ] **Step 1: Add the types and invoke wrappers**

Add near the end of the file (after the Phase 1 `PrComment`/invoke wrappers):

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

- [ ] **Step 2: Run the full frontend suite to confirm nothing broke**

Run: `npx vitest run`
Expected: unchanged from baseline (additive-only).

- [ ] **Step 3: No commit.** Move to Task 5.

---

### Task 5: Extract `Markdown` into its own file

**Files:**
- Create: `src/components/Markdown.tsx`
- Modify: `src/components/PullRequestDetail.tsx` (remove the local `Markdown` function, import from the new file)

**Interfaces:**
- Produces: `export default function Markdown({ children }: { children: string }): JSX.Element` — identical behavior to today's local component in `PullRequestDetail.tsx`, relocated so `FilesChangedTab.tsx` (Task 7) can use it too.

- [ ] **Step 1: Create `src/components/Markdown.tsx`**

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

export default function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]}>
      {children}
    </ReactMarkdown>
  );
}
```

- [ ] **Step 2: Update `PullRequestDetail.tsx` to import it instead of defining it locally**

Replace:

```tsx
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { ArrowLeft } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useGithubStore } from "../store/githubStore";
import { hashHue } from "../lib/hashColor";
import { initials, statusLabel } from "../lib/prDisplay";

function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]}>
      {children}
    </ReactMarkdown>
  );
}
```

with:

```tsx
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useGithubStore } from "../store/githubStore";
import { hashHue } from "../lib/hashColor";
import { initials, statusLabel } from "../lib/prDisplay";
import Markdown from "./Markdown";
```

- [ ] **Step 3: Run the existing PullRequestDetail tests to confirm nothing broke**

Run: `npx vitest run src/__tests__/PullRequestDetail.test.tsx`
Expected: PASS (7 tests, unchanged)

- [ ] **Step 4: No commit.** Move to Task 6.

---

### Task 6: `prDiffStore`

**Files:**
- Create: `src/store/prDiffStore.ts`
- Test: `src/__tests__/prDiffStore.test.ts`

**Interfaces:**
- Consumes: `invokeGetPrDiff`, `invokeListPrReviewComments`, `invokeAddPrReviewComment` (Task 4).
- Produces: `diff: PrDiff | null`, `reviewComments: PrReviewComment[]`, `isLoadingDiff: boolean`, `loadDiff(repoPath, number, baseRefName): Promise<void>`, `addReviewComment(repoPath, number, path, line, side, body): Promise<void>`, `clearDiff(): void`.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/prDiffStore.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/tauri", () => ({
  invokeGetPrDiff: vi.fn(),
  invokeListPrReviewComments: vi.fn(),
  invokeAddPrReviewComment: vi.fn(),
}));

import { usePrDiffStore } from "../store/prDiffStore";
import * as tauriLib from "../lib/tauri";

describe("prDiffStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePrDiffStore.setState({ diff: null, reviewComments: [], isLoadingDiff: false });
  });

  it("loadDiff populates diff and reviewComments", async () => {
    (tauriLib.invokeGetPrDiff as any).mockResolvedValue({
      baseOid: "b1",
      headOid: "h1",
      files: [{ path: "a.ts", status: "modified", lines: [], insertions: 1, deletions: 0 }],
    });
    (tauriLib.invokeListPrReviewComments as any).mockResolvedValue([
      { id: 1, author: "avery", body: "hi", createdAt: "now", path: "a.ts", line: 5, side: "RIGHT", url: "u" },
    ]);

    await usePrDiffStore.getState().loadDiff("/tmp/a", 42, "main");

    expect(tauriLib.invokeGetPrDiff).toHaveBeenCalledWith("/tmp/a", 42, "main");
    expect(tauriLib.invokeListPrReviewComments).toHaveBeenCalledWith("/tmp/a", 42);
    expect(usePrDiffStore.getState().diff?.baseOid).toBe("b1");
    expect(usePrDiffStore.getState().reviewComments).toHaveLength(1);
  });

  it("loadDiff sets isLoadingDiff while in flight", async () => {
    let resolveFn: (v: any) => void;
    (tauriLib.invokeGetPrDiff as any).mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      })
    );
    (tauriLib.invokeListPrReviewComments as any).mockResolvedValue([]);

    const promise = usePrDiffStore.getState().loadDiff("/tmp/a", 42, "main");
    expect(usePrDiffStore.getState().isLoadingDiff).toBe(true);
    resolveFn!({ baseOid: "b", headOid: "h", files: [] });
    await promise;
    expect(usePrDiffStore.getState().isLoadingDiff).toBe(false);
  });

  it("addReviewComment posts and appends", async () => {
    (tauriLib.invokeAddPrReviewComment as any).mockResolvedValue({
      id: 2,
      author: "yarinmag",
      body: "thanks",
      createdAt: "now",
      path: "a.ts",
      line: 5,
      side: "RIGHT",
      url: "u",
    });

    await usePrDiffStore.getState().addReviewComment("/tmp/a", 42, "a.ts", 5, "RIGHT", "thanks");

    expect(tauriLib.invokeAddPrReviewComment).toHaveBeenCalledWith("/tmp/a", 42, "a.ts", 5, "RIGHT", "thanks");
    expect(usePrDiffStore.getState().reviewComments).toHaveLength(1);
  });

  it("clearDiff resets diff and reviewComments", () => {
    usePrDiffStore.setState({
      diff: { baseOid: "b", headOid: "h", files: [] },
      reviewComments: [{ id: 1 } as any],
    });

    usePrDiffStore.getState().clearDiff();

    expect(usePrDiffStore.getState().diff).toBeNull();
    expect(usePrDiffStore.getState().reviewComments).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/__tests__/prDiffStore.test.ts`
Expected: FAIL — `Cannot find module '../store/prDiffStore'`

- [ ] **Step 3: Create `src/store/prDiffStore.ts`**

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

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/__tests__/prDiffStore.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: No commit.** Move to Task 7.

---

### Task 7: `FilesChangedTab` component

**Files:**
- Create: `src/components/FilesChangedTab.tsx`
- Test: `src/__tests__/FilesChangedTab.test.tsx`

**Interfaces:**
- Consumes: `useWorkspaceStore`, `useGithubStore` (`selectedPrNumber`), `usePrDiffStore` (Task 6), `Markdown` (Task 5), `hashHue`, `initials`.
- Produces: `export default function FilesChangedTab(): JSX.Element | null` — no props.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/FilesChangedTab.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useGithubStore } from "../store/githubStore";
import { usePrDiffStore } from "../store/prDiffStore";

vi.mock("../lib/tauri", () => ({
  invokeGetPrDiff: vi.fn(),
  invokeListPrReviewComments: vi.fn(),
  invokeAddPrReviewComment: vi.fn(),
}));

import * as tauriLib from "../lib/tauri";
import FilesChangedTab from "../components/FilesChangedTab";

const sampleDiff = {
  baseOid: "b1",
  headOid: "h1",
  files: [
    {
      path: "src/common/SimpleQueue.js",
      status: "modified",
      insertions: 1,
      deletions: 1,
      lines: [
        { kind: "context", content: "  finally(() => {", oldLine: 113, newLine: 113 },
        { kind: "del", content: "  console.log('bug')", oldLine: 114, newLine: null },
        { kind: "add", content: "  // removed log", oldLine: null, newLine: 114 },
      ],
    },
  ],
};

describe("FilesChangedTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
    });
    useGithubStore.setState({ selectedPrNumber: 42 });
    usePrDiffStore.setState({ diff: sampleDiff as any, reviewComments: [], isLoadingDiff: false });
  });

  it("renders each file's path and its lines", () => {
    render(<FilesChangedTab />);
    expect(screen.getByText("src/common/SimpleQueue.js")).toBeInTheDocument();
    expect(screen.getByText(/removed log/)).toBeInTheDocument();
  });

  it("renders an existing review comment anchored under its line", () => {
    usePrDiffStore.setState({
      reviewComments: [
        {
          id: 1,
          author: "avery",
          body: "why remove this?",
          createdAt: "2026-07-20T10:00:00Z",
          path: "src/common/SimpleQueue.js",
          line: 114,
          side: "RIGHT",
          url: "u",
        },
      ],
    });
    render(<FilesChangedTab />);
    expect(screen.getByText("why remove this?")).toBeInTheDocument();
  });

  it("opens a composer for a line, posts a comment, and shows it under that line", async () => {
    (tauriLib.invokeAddPrReviewComment as any).mockResolvedValue({
      id: 2,
      author: "yarinmag",
      body: "good catch",
      createdAt: "now",
      path: "src/common/SimpleQueue.js",
      line: 114,
      side: "RIGHT",
      url: "u",
    });
    render(<FilesChangedTab />);

    fireEvent.click(screen.getByRole("button", { name: "Comment on new line 114" }));
    fireEvent.change(screen.getByPlaceholderText("Leave a comment on this line"), {
      target: { value: "good catch" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() => {
      expect(tauriLib.invokeAddPrReviewComment).toHaveBeenCalledWith(
        "/tmp/a",
        42,
        "src/common/SimpleQueue.js",
        114,
        "RIGHT",
        "good catch"
      );
    });
    await waitFor(() => {
      expect(screen.getByText("good catch")).toBeInTheDocument();
    });
  });

  it("only keeps one composer open at a time", () => {
    render(<FilesChangedTab />);
    fireEvent.click(screen.getByRole("button", { name: "Comment on new line 113" }));
    expect(screen.getByPlaceholderText("Leave a comment on this line")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Comment on new line 114" }));
    expect(screen.getAllByPlaceholderText("Leave a comment on this line")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/__tests__/FilesChangedTab.test.tsx`
Expected: FAIL — `Cannot find module '../components/FilesChangedTab'`

- [ ] **Step 3: Create `src/components/FilesChangedTab.tsx`**

```tsx
import { useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useGithubStore } from "../store/githubStore";
import { usePrDiffStore } from "../store/prDiffStore";
import Markdown from "./Markdown";
import { hashHue } from "../lib/hashColor";
import { initials } from "../lib/prDisplay";
import type { DiffLineInfo, PrFileDiff, PrReviewComment } from "../lib/tauri";

interface LineTarget {
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
}

function lineTarget(path: string, line: DiffLineInfo): LineTarget | null {
  if (line.kind === "del") {
    return line.oldLine != null ? { path, line: line.oldLine, side: "LEFT" } : null;
  }
  return line.newLine != null ? { path, line: line.newLine, side: "RIGHT" } : null;
}

function targetKey(t: LineTarget): string {
  return `${t.path}:${t.side}:${t.line}`;
}

export default function FilesChangedTab() {
  const { activeRepoId, repos } = useWorkspaceStore();
  const { selectedPrNumber } = useGithubStore();
  const { diff, reviewComments, addReviewComment } = usePrDiffStore();
  const activeRepo = repos.find((r) => r.id === activeRepoId);
  const [openComposer, setOpenComposer] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!diff) return null;

  const commentsFor = (t: LineTarget): PrReviewComment[] =>
    reviewComments.filter((c) => c.path === t.path && c.side === t.side && c.line === t.line);

  const openComposerFor = (t: LineTarget) => {
    setOpenComposer(targetKey(t));
    setDraft("");
    setError(null);
  };

  const submitComment = async (t: LineTarget) => {
    if (!activeRepo || selectedPrNumber == null || !draft.trim()) return;
    setPosting(true);
    setError(null);
    try {
      await addReviewComment(activeRepo.path, selectedPrNumber, t.path, t.line, t.side, draft);
      setOpenComposer(null);
      setDraft("");
    } catch (e) {
      setError(String(e));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
      {diff.files.map((file: PrFileDiff) => (
        <div key={file.path} className="border border-border-subtle rounded-md overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-elevated border-b border-border-subtle text-xs">
            <span className="font-mono text-text-primary">{file.path}</span>
            <span className="text-success">+{file.insertions}</span>
            <span className="text-danger">-{file.deletions}</span>
          </div>
          <div className="font-mono text-[11px]">
            {file.lines.map((line, i) => {
              const target = lineTarget(file.path, line);
              const key = target ? targetKey(target) : `noline-${i}`;
              const comments = target ? commentsFor(target) : [];
              return (
                <div key={i}>
                  <div
                    className={`flex items-start gap-2 px-2 ${
                      line.kind === "add" ? "bg-success-soft" : line.kind === "del" ? "bg-danger-soft" : ""
                    }`}
                  >
                    <span className="w-8 text-right text-text-muted shrink-0 select-none">{line.oldLine ?? ""}</span>
                    <span className="w-8 text-right text-text-muted shrink-0 select-none">{line.newLine ?? ""}</span>
                    <span className="shrink-0 text-text-muted select-none">
                      {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
                    </span>
                    <span className="whitespace-pre-wrap flex-1 text-text-primary">{line.content}</span>
                    {target && (
                      <button
                        type="button"
                        aria-label={`Comment on ${target.side === "LEFT" ? "old" : "new"} line ${target.line}`}
                        className="shrink-0 text-text-muted hover:text-accent"
                        onClick={() => openComposerFor(target)}
                      >
                        +
                      </button>
                    )}
                  </div>
                  {comments.map((comment) => (
                    <div key={comment.id} className="ml-16 my-1 border border-border-subtle rounded-md overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-elevated border-b border-border-subtle text-xs text-text-muted">
                        <span
                          className="flex items-center justify-center w-5 h-5 rounded-full text-[8px] font-semibold shrink-0 text-white"
                          style={{ backgroundColor: `hsl(${hashHue(comment.author)}, 55%, 45%)` }}
                          title={comment.author}
                        >
                          {initials(comment.author)}
                        </span>
                        <span className="font-medium text-text-primary">{comment.author}</span> · {comment.createdAt}
                      </div>
                      <div className="px-3 py-2 markdown-body">
                        <Markdown>{comment.body}</Markdown>
                      </div>
                    </div>
                  ))}
                  {target && openComposer === key && (
                    <div className="ml-16 my-1 flex flex-col gap-2">
                      <textarea
                        className="w-full min-h-16 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary outline-none text-xs font-sans"
                        placeholder="Leave a comment on this line"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                      />
                      {error && <span className="text-xs text-danger">{error}</span>}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="px-3 py-1 bg-accent text-accent-contrast rounded text-xs font-medium disabled:opacity-50"
                          onClick={() => submitComment(target)}
                          disabled={posting || !draft.trim()}
                        >
                          Comment
                        </button>
                        <button
                          type="button"
                          className="px-3 py-1 text-xs text-text-muted"
                          onClick={() => setOpenComposer(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/__tests__/FilesChangedTab.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: No commit.** Move to Task 8.

---

### Task 8: Wire tabs into `PullRequestDetail.tsx`

**Files:**
- Modify: `src/components/PullRequestDetail.tsx`
- Modify: `src/__tests__/PullRequestDetail.test.tsx`

**Interfaces:**
- Consumes: `FilesChangedTab` (Task 7), `usePrDiffStore` (Task 6).

- [ ] **Step 1: Write the failing test**

In `src/__tests__/PullRequestDetail.test.tsx`, add `invokeGetPrDiff`/`invokeListPrReviewComments`/`invokeAddPrReviewComment` to the `vi.mock("../lib/tauri", ...)` factory:

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
  invokeGetPrDiff: vi.fn(),
  invokeListPrReviewComments: vi.fn(),
  invokeAddPrReviewComment: vi.fn(),
}));
```

Add this import:

```tsx
import { usePrDiffStore } from "../store/prDiffStore";
```

Add `usePrDiffStore.setState({ diff: null, reviewComments: [], isLoadingDiff: false });` to the `beforeEach`.

Add a new test:

```tsx
  it("loads and shows the diff when switching to Files changed, without refetching on switching back", async () => {
    (tauriLib.invokeGetPrDiff as any).mockResolvedValue({ baseOid: "b", headOid: "h", files: [] });
    (tauriLib.invokeListPrReviewComments as any).mockResolvedValue([]);
    render(<PullRequestDetail />);

    fireEvent.click(screen.getByRole("button", { name: "Files changed" }));

    await waitFor(() => {
      expect(tauriLib.invokeGetPrDiff).toHaveBeenCalledWith("/tmp/a", 42, "main");
    });
    expect(tauriLib.invokeGetPrDiff).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Conversation" }));
    fireEvent.click(screen.getByRole("button", { name: "Files changed" }));

    await waitFor(() => {
      expect(tauriLib.invokeGetPrDiff).toHaveBeenCalledTimes(1);
    });
  });
```

- [ ] **Step 2: Run the test file and confirm the new test fails**

Run: `npx vitest run src/__tests__/PullRequestDetail.test.tsx`
Expected: FAIL — the "Files changed" button is `disabled`, clicking it does nothing.

- [ ] **Step 3: Wire the tabs in `PullRequestDetail.tsx`**

Add these imports:

```tsx
import { useEffect, useState } from "react";
```

(replacing the existing `import { useState } from "react";`)

```tsx
import { usePrDiffStore } from "../store/prDiffStore";
import FilesChangedTab from "./FilesChangedTab";
```

Add local tab state and a load-on-switch effect (place near the other `useState` calls):

```tsx
  const [activeTab, setActiveTab] = useState<"conversation" | "files">("conversation");
  const { diff, loadDiff } = usePrDiffStore();

  useEffect(() => {
    if (activeTab === "files" && !diff && activeRepo && selectedPrNumber != null && prDetail) {
      loadDiff(activeRepo.path, selectedPrNumber, prDetail.pullRequest.baseRefName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedPrNumber]);
```

Replace the tab bar:

```tsx
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
```

with:

```tsx
      <div className="flex border-b border-border-subtle">
        <button
          type="button"
          className={`px-3 py-2 text-xs font-medium border-b-2 ${
            activeTab === "conversation" ? "border-accent text-text-primary" : "border-transparent text-text-muted"
          }`}
          onClick={() => setActiveTab("conversation")}
        >
          Conversation
        </button>
        <button
          type="button"
          className={`px-3 py-2 text-xs font-medium border-b-2 ${
            activeTab === "files" ? "border-accent text-text-primary" : "border-transparent text-text-muted"
          }`}
          onClick={() => setActiveTab("files")}
        >
          Files changed
        </button>
      </div>
```

Wrap the existing Conversation-tab content block (the `<div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">...</div>` containing the body/comments/composer) in a condition, and render `FilesChangedTab` for the other tab. Replace:

```tsx
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
```

with:

```tsx
      {activeTab === "conversation" && (
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
```

Find its closing `</div>` (the one that closes the comments/body scroll area) and, immediately after it, close the conditional and add the Files-changed branch:

```tsx
      </div>
      )}
      {activeTab === "files" && <FilesChangedTab />}
```

Then find the bottom compose-box block:

```tsx
      <div className="border-t border-border-subtle p-3 flex flex-col gap-2">
```

and wrap that entire block (through its matching closing `</div>`) in the same condition too — posting a top-level PR comment only makes sense alongside the Conversation tab's thread, not while looking at the diff:

```tsx
      {activeTab === "conversation" && (
      <div className="border-t border-border-subtle p-3 flex flex-col gap-2">
        {/* ...unchanged textarea/error/button contents... */}
      </div>
      )}
```

- [ ] **Step 4: Run the test file and confirm all tests pass**

Run: `npx vitest run src/__tests__/PullRequestDetail.test.tsx`
Expected: PASS (8 tests — 7 existing + 1 new)

- [ ] **Step 5: No commit.** Move to Task 9.

---

### Task 9: Full regression

**Files:** none (verification only)

- [ ] **Step 1: Run the full frontend suite**

Run: `npx vitest run`
Expected: all green except the one documented pre-existing `Toolbar.test.tsx` Push-button failure.

- [ ] **Step 2: Run the full backend suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS, all tests (96 total from Tasks 1–3)

- [ ] **Step 3: Run the e2e suite**

Run: `npm run e2e`
Expected: the same 3 pre-existing failures documented in the Nest redesign plan — unrelated to this plan.

- [ ] **Step 4: No commit** — this plan's work is complete once all three suites are green (with only the documented pre-existing exceptions).

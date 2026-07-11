# Bettertree Plan 3: Working-Copy Operations, Diff Viewer, Commit Drawer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user stage/unstage files, commit, fetch, pull, and push, and view a commit's metadata + diff (unified/side-by-side) in a bottom drawer when a commit is selected in the graph.

**Architecture:** Three new Rust modules — `workdir.rs` (status/stage/unstage/commit), `diff.rs` (structured per-file diff for a commit), `remote.rs` (credentials + fetch/pull/push) — each wrapping git2, following the read-only modules' pattern from Plan 1/2. Frontend adds a working-copy panel, a fetch/pull/push toolbar with error surfacing, and a bottom drawer that opens on commit selection.

**Tech Stack:** Same as Plan 1/2 — Tauri v2, Rust, git2, rusqlite, React 18, TypeScript, Zustand, Tailwind CSS.

**Relationship to spec:** This is Plan 3 of 3 covering `docs/superpowers/specs/2026-07-06-bettertree-design.md`. It completes the spec's v1 scope. **Two documented v1 simplifications, decided during brainstorming for this plan (not spec gaps):**
1. **Whole-file staging, not hunk-level.** The spec says "stage/unstage hunks"; v1 stages/unstages entire files via git2's index API. Hunk-level (partial-file) staging needs diff-hunk parsing, patch application to the index, and a hunk-selection UI — a substantial follow-up, not a bug fix.
2. **Fast-forward-only pull, single hardcoded remote ("origin").** Non-fast-forward pulls (needing a real merge) return a clear error rather than opening a merge UI — matches the spec's "Out of Scope: merge/conflict resolution UI beyond surfacing the error." Multi-remote support is a natural follow-up.

## Global Constraints

- **No git version control for this project.** Do not run `git init`, `git add`, or `git commit`. Every task's last step is "mark task complete," not a commit.
- **Every Rust struct returned to the frontend needs `#[serde(rename_all = "camelCase")]` if it has any multi-word field.** Plan 1/2 shipped three structs (`BranchInfo`, `TagInfo`, `GraphEdge`) that were missing this and silently serialized as snake_case JSON — undetected because unit tests mock `lib/tauri.ts` and e2e tests mock the IPC bridge directly, so neither path exercises real Rust serialization. That's been fixed retroactively; every new struct in this plan must have the attribute from the start, and add a `serde_json::to_string` key-shape test alongside its other unit tests (see Task 1 for the pattern).
- Cross-platform target: macOS, Windows, Linux — use `PathBuf`/`Path` for all filesystem paths.
- Auth: delegate to the system SSH agent and git credential helper — no in-app credential storage (per spec).
- Builds on Plan 1/2's files — read `src-tauri/src/{error,db,repo,graph,search,commands,lib,test_support}.rs` and `src/{lib/tauri.ts,store/*.ts,components/*}` before starting.
- Every task's last verification step re-runs the full test suite (`cargo test` + `npm test` + `npm run e2e`), per the spec's cross-phase testing policy.

---

## File Structure

```
bettertree/
  src-tauri/src/
    error.rs           # MODIFY: add Operation(String) variant
    workdir.rs           # NEW: get_status, stage_file, unstage_file, commit_changes
    diff.rs               # NEW: get_commit_diff (structured per-file diff for the drawer)
    remote.rs              # NEW: credential callback, fetch, pull (fast-forward only), push
    test_support.rs         # MODIFY: add init_repo_with_remote fixture for fetch/pull/push tests
    commands.rs               # MODIFY: wire all new commands
    lib.rs                     # MODIFY: register modules and commands
  src/
    lib/tauri.ts          # MODIFY: add StatusEntry, FileDiff, CommitDetail types + invoke wrappers
    store/
      workingCopyStore.ts  # NEW: status list, stage/unstage/commit, fetch/pull/push, error state
      uiStore.ts             # NEW: selectedCommitOid (drives the drawer)
    components/
      WorkingCopyPanel.tsx  # NEW: changed-file list with stage/unstage + commit box
      Toolbar.tsx             # NEW: Fetch/Pull/Push buttons + error banner
      DiffViewer.tsx           # NEW: shared unified/side-by-side diff renderer
      CommitDrawer.tsx          # NEW: bottom drawer — metadata + DiffViewer, opens on commit selection
      CommitGraphRow.tsx         # MODIFY: clicking a row sets uiStore.selectedCommitOid
      Sidebar.tsx                 # MODIFY: render WorkingCopyPanel
      App.tsx                      # MODIFY: render Toolbar and CommitDrawer
    __tests__/
      workingCopyStore.test.ts
      WorkingCopyPanel.test.tsx
      Toolbar.test.tsx
      CommitDrawer.test.tsx
  e2e/
    mockTauri.ts          # MODIFY: add status/stage/unstage/commit/diff/fetch/pull/push mocks
    workingcopy.spec.ts     # NEW: stage → commit → view diff in drawer flow
```

`workdir.rs` never touches remotes; `remote.rs` never touches the index/working tree directly (it only fetches/merges refs and pushes); `diff.rs` is read-only and shared conceptually with Plan 2's `search.rs` diff logic but kept separate since it returns structured per-file data for UI, not raw text for indexing. `DiffViewer.tsx` is a pure rendering component (patch/old/new content in, JSX out) reused by nothing else yet, but written standalone so Plan 4+ (e.g., a "diff this branch against that branch" feature) can reuse it.

---

### Task 1: Working-copy status

**Files:**
- Create: `src-tauri/src/workdir.rs`

**Interfaces:**
- Consumes: `AppError`, `test_support::init_repo_with_commits` (tests only).
- Produces: `FileState` enum (`Untracked`, `ModifiedUnstaged`, `ModifiedStaged`, `Deleted`, `Renamed`), `StatusEntry { path: String, state: FileState }`, `get_status(repo_path: &str) -> Result<Vec<StatusEntry>, AppError>`. Task 2 (stage/unstage) and Task 8 (frontend) consume `StatusEntry`'s exact shape.

- [ ] **Step 1: Write the failing tests**

`src-tauri/src/workdir.rs` (tests only for now):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::init_repo_with_commits;
    use std::path::Path;

    #[test]
    fn status_entry_serializes_with_camel_case_keys() {
        let entry = StatusEntry { path: "a.txt".into(), state: FileState::ModifiedUnstaged };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"path\":\"a.txt\""), "json was: {json}");
        assert!(json.contains("\"state\":\"ModifiedUnstaged\""), "json was: {json}");
    }

    #[test]
    fn clean_repo_has_empty_status() {
        let (dir, _repo) = init_repo_with_commits();
        let status = get_status(dir.path().to_str().unwrap()).unwrap();
        assert!(status.is_empty(), "expected clean status, got: {status:?}");
    }

    #[test]
    fn new_file_is_untracked() {
        let (dir, _repo) = init_repo_with_commits();
        std::fs::write(dir.path().join("new.txt"), "hello").unwrap();

        let status = get_status(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(status.len(), 1);
        assert_eq!(status[0].path, "new.txt");
        assert_eq!(status[0].state, FileState::Untracked);
    }

    #[test]
    fn modified_tracked_file_is_unstaged_until_added() {
        let (dir, repo) = init_repo_with_commits();
        std::fs::write(dir.path().join("a.txt"), "three").unwrap();

        let status = get_status(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(status.len(), 1);
        assert_eq!(status[0].state, FileState::ModifiedUnstaged);

        let mut index = repo.index().unwrap();
        index.add_path(Path::new("a.txt")).unwrap();
        index.write().unwrap();

        let status = get_status(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(status.len(), 1);
        assert_eq!(status[0].state, FileState::ModifiedStaged);
    }
}
```

Add `#[derive(Debug, Clone, Serialize, PartialEq)]` types need `PartialEq` for the test's `assert_eq!` on `FileState` — this is declared in Step 3's implementation, not here.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml workdir::tests`
Expected: FAIL to compile — `StatusEntry`, `FileState`, `get_status` not defined.

- [ ] **Step 3: Write the implementation**

Prepend this to `src-tauri/src/workdir.rs` (above the `#[cfg(test)]` block):

```rust
use crate::error::AppError;
use git2::{Repository, Status, StatusOptions};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub enum FileState {
    Untracked,
    ModifiedUnstaged,
    ModifiedStaged,
    Deleted,
    Renamed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntry {
    pub path: String,
    pub state: FileState,
}

/// A file that is both staged and further modified shows as ModifiedStaged
/// only — a documented v1 simplification (see Plan 3's header).
pub fn get_status(repo_path: &str) -> Result<Vec<StatusEntry>, AppError> {
    let repo = Repository::open(repo_path)?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true);
    let statuses = repo.statuses(Some(&mut opts))?;

    let mut out = Vec::new();
    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let status = entry.status();
        let state = if status.contains(Status::WT_NEW) {
            FileState::Untracked
        } else if status.contains(Status::INDEX_NEW) || status.contains(Status::INDEX_MODIFIED) {
            FileState::ModifiedStaged
        } else if status.contains(Status::WT_MODIFIED) {
            FileState::ModifiedUnstaged
        } else if status.contains(Status::WT_DELETED) || status.contains(Status::INDEX_DELETED) {
            FileState::Deleted
        } else if status.contains(Status::INDEX_RENAMED) || status.contains(Status::WT_RENAMED) {
            FileState::Renamed
        } else {
            continue;
        };
        out.push(StatusEntry { path, state });
    }
    Ok(out)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml workdir::tests`
Expected: `test result: ok. 4 passed; 0 failed`

- [ ] **Step 5: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 2: Stage and unstage files

**Files:**
- Modify: `src-tauri/src/workdir.rs`

**Interfaces:**
- Consumes: `get_status` (Task 1, tests only).
- Produces: `stage_file(repo_path: &str, file_path: &str) -> Result<(), AppError>`, `unstage_file(repo_path: &str, file_path: &str) -> Result<(), AppError>`. Task 7's Tauri commands and Task 8's frontend call these by these exact names.

- [ ] **Step 1: Write the failing tests**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/workdir.rs`:

```rust
    #[test]
    fn stage_file_moves_untracked_file_to_staged() {
        let (dir, _repo) = init_repo_with_commits();
        std::fs::write(dir.path().join("new.txt"), "hello").unwrap();
        let repo_path = dir.path().to_str().unwrap();

        stage_file(repo_path, "new.txt").unwrap();

        let status = get_status(repo_path).unwrap();
        assert_eq!(status.len(), 1);
        assert_eq!(status[0].state, FileState::ModifiedStaged);
    }

    #[test]
    fn unstage_file_reverts_staged_new_file_to_untracked() {
        let (dir, _repo) = init_repo_with_commits();
        std::fs::write(dir.path().join("new.txt"), "hello").unwrap();
        let repo_path = dir.path().to_str().unwrap();
        stage_file(repo_path, "new.txt").unwrap();

        unstage_file(repo_path, "new.txt").unwrap();

        let status = get_status(repo_path).unwrap();
        assert_eq!(status.len(), 1);
        assert_eq!(status[0].state, FileState::Untracked);
    }

    #[test]
    fn unstage_file_reverts_staged_modification_to_unstaged() {
        let (dir, repo) = init_repo_with_commits();
        std::fs::write(dir.path().join("a.txt"), "three").unwrap();
        let repo_path = dir.path().to_str().unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("a.txt")).unwrap();
        index.write().unwrap();

        unstage_file(repo_path, "a.txt").unwrap();

        let status = get_status(repo_path).unwrap();
        assert_eq!(status.len(), 1);
        assert_eq!(status[0].state, FileState::ModifiedUnstaged);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml workdir::tests`
Expected: FAIL to compile — `stage_file`, `unstage_file` not defined.

- [ ] **Step 3: Write the implementation**

Add to `src-tauri/src/workdir.rs`, below `get_status` (still above `#[cfg(test)]`):

```rust
pub fn stage_file(repo_path: &str, file_path: &str) -> Result<(), AppError> {
    let repo = Repository::open(repo_path)?;
    let mut index = repo.index()?;
    let full_path = std::path::Path::new(repo_path).join(file_path);
    if full_path.exists() {
        index.add_path(std::path::Path::new(file_path))?;
    } else {
        index.remove_path(std::path::Path::new(file_path))?;
    }
    index.write()?;
    Ok(())
}

pub fn unstage_file(repo_path: &str, file_path: &str) -> Result<(), AppError> {
    let repo = Repository::open(repo_path)?;
    let head = repo.head()?.peel_to_commit()?;
    repo.reset_default(Some(head.as_object()), [file_path])?;
    Ok(())
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml workdir::tests`
Expected: `test result: ok. 7 passed; 0 failed`

- [ ] **Step 5: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 3: Commit changes

**Files:**
- Modify: `src-tauri/src/workdir.rs`

**Interfaces:**
- Consumes: `stage_file` (Task 2, tests only).
- Produces: `commit_changes(repo_path: &str, message: &str) -> Result<String, AppError>` (returns the new commit's oid as a hex string). Task 7's Tauri command calls this by this exact name.

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)] mod tests` block:

```rust
    #[test]
    fn commit_changes_creates_commit_from_staged_index() {
        let (dir, repo) = init_repo_with_commits();
        std::fs::write(dir.path().join("new.txt"), "hello").unwrap();
        let repo_path = dir.path().to_str().unwrap();
        stage_file(repo_path, "new.txt").unwrap();

        let new_oid = commit_changes(repo_path, "add new.txt").unwrap();

        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.id().to_string(), new_oid);
        assert_eq!(head.message().unwrap(), "add new.txt");
        assert_eq!(head.parent_count(), 1);

        let status = get_status(repo_path).unwrap();
        assert!(status.is_empty(), "expected clean status after commit, got: {status:?}");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml workdir::tests::commit_changes_creates_commit_from_staged_index`
Expected: FAIL to compile — `commit_changes` not defined.

- [ ] **Step 3: Write the implementation**

Add to `src-tauri/src/workdir.rs`, below `unstage_file` (still above `#[cfg(test)]`):

```rust
pub fn commit_changes(repo_path: &str, message: &str) -> Result<String, AppError> {
    let repo = Repository::open(repo_path)?;
    let mut index = repo.index()?;
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    let sig = repo.signature()?;
    let parent = repo.head()?.peel_to_commit()?;
    let oid = repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[&parent])?;
    Ok(oid.to_string())
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml workdir::tests`
Expected: `test result: ok. 8 passed; 0 failed`

- [ ] **Step 5: Run the full backend suite to confirm no regressions**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests from Plan 1, Plan 2, and this plan's Task 1–3 pass.

- [ ] **Step 6: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 4: Structured commit diff for the drawer

**Files:**
- Create: `src-tauri/src/diff.rs`

**Interfaces:**
- Consumes: `AppError`, `test_support::init_repo_with_commits` (tests only).
- Produces: `FileDiff { path: String, status: String, patch: String, old_content: Option<String>, new_content: Option<String>, insertions: usize, deletions: usize }`, `CommitDetail { oid: String, author: String, email: String, timestamp: i64, message: String, files: Vec<FileDiff> }`, `get_commit_diff(repo_path: &str, oid_str: &str) -> Result<CommitDetail, AppError>`. `insertions`/`deletions` are the spec's "diff stats" requirement — per-file added/removed line counts. Task 7's Tauri command and Task 10's `DiffViewer`/`CommitDrawer` consume this shape exactly.

- [ ] **Step 1: Write the failing tests**

`src-tauri/src/diff.rs` (tests only for now):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::init_repo_with_commits;

    #[test]
    fn file_diff_serializes_with_camel_case_keys() {
        let fd = FileDiff {
            path: "a.txt".into(),
            status: "modified".into(),
            patch: "".into(),
            old_content: Some("one".into()),
            new_content: Some("two".into()),
            insertions: 1,
            deletions: 1,
        };
        let json = serde_json::to_string(&fd).unwrap();
        assert!(json.contains("\"oldContent\""), "json was: {json}");
        assert!(json.contains("\"newContent\""), "json was: {json}");
    }

    #[test]
    fn diffs_second_commit_against_its_parent() {
        let (dir, repo) = init_repo_with_commits();
        let head_oid = repo.head().unwrap().target().unwrap();

        let detail = get_commit_diff(dir.path().to_str().unwrap(), &head_oid.to_string()).unwrap();

        assert_eq!(detail.message.trim(), "second commit");
        assert_eq!(detail.files.len(), 1);
        assert_eq!(detail.files[0].path, "a.txt");
        assert_eq!(detail.files[0].status, "modified");
        assert_eq!(detail.files[0].old_content.as_deref(), Some("one"));
        assert_eq!(detail.files[0].new_content.as_deref(), Some("two"));
        assert!(detail.files[0].patch.contains("-one"));
        assert!(detail.files[0].patch.contains("+two"));
        assert_eq!(detail.files[0].insertions, 1);
        assert_eq!(detail.files[0].deletions, 1);
    }

    #[test]
    fn diffs_root_commit_with_no_parent() {
        let (dir, repo) = init_repo_with_commits();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        let root_oid = head.parent_id(0).unwrap();

        let detail = get_commit_diff(dir.path().to_str().unwrap(), &root_oid.to_string()).unwrap();

        assert_eq!(detail.files.len(), 1);
        assert_eq!(detail.files[0].status, "added");
        assert_eq!(detail.files[0].old_content, None);
        assert_eq!(detail.files[0].new_content.as_deref(), Some("one"));
        assert_eq!(detail.files[0].insertions, 1);
        assert_eq!(detail.files[0].deletions, 0);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml diff::tests`
Expected: FAIL to compile — `FileDiff`, `CommitDetail`, `get_commit_diff` not defined.

- [ ] **Step 3: Write the implementation**

Prepend this to `src-tauri/src/diff.rs` (above the `#[cfg(test)]` block):

```rust
use crate::error::AppError;
use git2::{Delta, Repository};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub status: String,
    pub patch: String,
    pub old_content: Option<String>,
    pub new_content: Option<String>,
    pub insertions: usize,
    pub deletions: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub oid: String,
    pub author: String,
    pub email: String,
    pub timestamp: i64,
    pub message: String,
    pub files: Vec<FileDiff>,
}

pub fn get_commit_diff(repo_path: &str, oid_str: &str) -> Result<CommitDetail, AppError> {
    let repo = Repository::open(repo_path)?;
    let oid = git2::Oid::from_str(oid_str)?;
    let commit = repo.find_commit(oid)?;
    let tree = commit.tree()?;
    let parent_tree = if commit.parent_count() > 0 {
        Some(commit.parent(0)?.tree()?)
    } else {
        None
    };
    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)?;

    let mut files: Vec<FileDiff> = Vec::new();
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
            files.push(FileDiff {
                path,
                status,
                patch: String::new(),
                old_content: None,
                new_content: None,
                insertions: 0,
                deletions: 0,
            });
            true
        },
        None,
        None,
        None,
    )?;

    let mut patch_texts: HashMap<String, String> = HashMap::new();
    let mut line_counts: HashMap<String, (usize, usize)> = HashMap::new();
    diff.print(git2::DiffFormat::Patch, |delta, _hunk, line| {
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        // git2's DiffLine::content() is the raw line text only — the
        // '+'/'-'/' ' marker is exposed separately via origin() and must
        // be prepended manually to get real unified-diff text.
        let origin = line.origin();
        if let Ok(s) = std::str::from_utf8(line.content()) {
            let entry = patch_texts.entry(path.clone()).or_default();
            if matches!(origin, '+' | '-' | ' ') {
                entry.push(origin);
            }
            entry.push_str(s);
        }
        let counts = line_counts.entry(path).or_insert((0, 0));
        match origin {
            '+' => counts.0 += 1,
            '-' => counts.1 += 1,
            _ => {}
        }
        true
    })?;

    for file in &mut files {
        file.patch = patch_texts.get(&file.path).cloned().unwrap_or_default();
        let (insertions, deletions) = line_counts.get(&file.path).copied().unwrap_or((0, 0));
        file.insertions = insertions;
        file.deletions = deletions;
        file.old_content = parent_tree
            .as_ref()
            .and_then(|t| t.get_path(Path::new(&file.path)).ok())
            .and_then(|entry| repo.find_blob(entry.id()).ok())
            .and_then(|blob| std::str::from_utf8(blob.content()).ok().map(|s| s.to_string()));
        file.new_content = tree
            .get_path(Path::new(&file.path))
            .ok()
            .and_then(|entry| repo.find_blob(entry.id()).ok())
            .and_then(|blob| std::str::from_utf8(blob.content()).ok().map(|s| s.to_string()));
    }

    let author = commit.author();
    Ok(CommitDetail {
        oid: oid_str.to_string(),
        author: author.name().unwrap_or("").to_string(),
        email: author.email().unwrap_or("").to_string(),
        timestamp: commit.time().seconds(),
        message: commit.message().unwrap_or("").to_string(),
        files,
    })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml diff::tests`
Expected: `test result: ok. 3 passed; 0 failed`

- [ ] **Step 5: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 5: Credentials and fetch

**Files:**
- Modify: `src-tauri/src/test_support.rs`
- Create: `src-tauri/src/remote.rs`

**Interfaces:**
- Consumes: `AppError`, `test_support::init_repo_with_commits`.
- Produces: `test_support::init_repo_with_remote() -> (TempDir, TempDir, Repository)` (local repo dir, bare "remote" dir, opened local repo — the local repo already has a remote named `"origin"` pointing at the bare dir); `fetch(repo_path: &str, remote_name: &str) -> Result<(), AppError>`. Task 6 (`pull`, `push`) and their tests reuse `init_repo_with_remote` and `fetch`.

- [ ] **Step 1: Add the shared remote-repo test fixture**

Add to `src-tauri/src/test_support.rs` (below `init_repo_with_commits_and_merge`):

```rust
/// A local repo with two commits (from init_repo_with_commits) plus a
/// bare "remote" repo registered as its "origin", with nothing pushed
/// yet — the starting point for fetch/pull/push tests.
pub fn init_repo_with_remote() -> (TempDir, TempDir, Repository) {
    let (local_dir, local_repo) = init_repo_with_commits();
    let bare_dir = TempDir::new().unwrap();
    Repository::init_bare(bare_dir.path()).unwrap();
    local_repo
        .remote("origin", bare_dir.path().to_str().unwrap())
        .unwrap();
    (local_dir, bare_dir, local_repo)
}
```

- [ ] **Step 2: Write the failing test**

`src-tauri/src/remote.rs` (tests only for now):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::init_repo_with_remote;

    #[test]
    fn fetch_populates_remote_tracking_ref_after_a_push() {
        let (local_dir, bare_dir, local_repo) = init_repo_with_remote();
        let repo_path = local_dir.path().to_str().unwrap();

        // Push directly via git2 (not our own push(), which Task 6 adds)
        // to get content onto the remote for fetch to retrieve.
        let mut remote = local_repo.find_remote("origin").unwrap();
        remote.push(&["refs/heads/main:refs/heads/main"], None).unwrap();

        fetch(repo_path, "origin").unwrap();

        let local_head = local_repo.head().unwrap().target().unwrap();
        let remote_tracking = local_repo.refname_to_id("refs/remotes/origin/main").unwrap();
        assert_eq!(remote_tracking, local_head);

        let bare_repo = git2::Repository::open_bare(bare_dir.path()).unwrap();
        let bare_main = bare_repo.refname_to_id("refs/heads/main").unwrap();
        assert_eq!(bare_main, local_head);
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml remote::tests`
Expected: FAIL to compile — `fetch` not defined.

- [ ] **Step 4: Write the implementation**

Prepend this to `src-tauri/src/remote.rs` (above the `#[cfg(test)]` block):

```rust
use crate::error::AppError;
use git2::{Cred, FetchOptions, RemoteCallbacks, Repository};

fn make_callbacks<'a>() -> RemoteCallbacks<'a> {
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(|url, username_from_url, allowed_types| {
        if allowed_types.is_ssh_key() {
            if let Some(username) = username_from_url {
                if let Ok(cred) = Cred::ssh_key_from_agent(username) {
                    return Ok(cred);
                }
            }
        }
        if allowed_types.is_user_pass_plaintext() || allowed_types.is_default() {
            if let Ok(config) = git2::Config::open_default() {
                if let Ok(cred) = Cred::credential_helper(&config, url, username_from_url) {
                    return Ok(cred);
                }
            }
        }
        Err(git2::Error::from_str("no credentials available"))
    });
    callbacks
}

pub fn fetch(repo_path: &str, remote_name: &str) -> Result<(), AppError> {
    let repo = Repository::open(repo_path)?;
    let mut remote = repo.find_remote(remote_name)?;
    let mut opts = FetchOptions::new();
    opts.remote_callbacks(make_callbacks());
    remote.fetch(&[] as &[&str], Some(&mut opts), None)?;
    Ok(())
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml remote::tests`
Expected: `test result: ok. 1 passed; 0 failed`

- [ ] **Step 6: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 6: Push and fast-forward pull

**Files:**
- Modify: `src-tauri/src/error.rs`
- Modify: `src-tauri/src/remote.rs`

**Interfaces:**
- Consumes: `fetch`, `make_callbacks` (Task 5).
- Produces: `AppError::Operation(String)` variant; `push(repo_path: &str, remote_name: &str) -> Result<(), AppError>`, `pull(repo_path: &str, remote_name: &str) -> Result<(), AppError>`. Task 7's Tauri commands call these by these exact names.

- [ ] **Step 1: Add the Operation error variant**

Modify `src-tauri/src/error.rs`:

```rust
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("git error: {0}")]
    Git(#[from] git2::Error),
    #[error("repo not found: {0}")]
    RepoNotFound(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("could not determine app data directory")]
    NoDataDir,
    #[error("{0}")]
    Operation(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
```

- [ ] **Step 2: Write the failing tests**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/remote.rs`:

```rust
    #[test]
    fn push_updates_the_remote_branch() {
        let (local_dir, bare_dir, local_repo) = init_repo_with_remote();
        let repo_path = local_dir.path().to_str().unwrap();

        push(repo_path, "origin").unwrap();

        let bare_repo = git2::Repository::open_bare(bare_dir.path()).unwrap();
        let bare_main = bare_repo.refname_to_id("refs/heads/main").unwrap();
        let local_head = local_repo.head().unwrap().target().unwrap();
        assert_eq!(bare_main, local_head);
    }

    #[test]
    fn pull_fast_forwards_when_remote_is_ahead() {
        let (local_dir, _bare_dir, local_repo) = init_repo_with_remote();
        let repo_path = local_dir.path().to_str().unwrap();
        push(repo_path, "origin").unwrap();

        // Build a commit ahead of HEAD under a throwaway ref, then push it
        // to the bare remote's main branch directly — simulating another
        // contributor's push without needing a second clone.
        let sig = git2::Signature::now("Test User", "test@example.com").unwrap();
        let head_commit = local_repo.head().unwrap().peel_to_commit().unwrap();
        let tree = head_commit.tree().unwrap();
        let ahead_oid = local_repo
            .commit(Some("refs/tmp/ahead"), &sig, &sig, "third commit", &tree, &[&head_commit])
            .unwrap();

        let mut remote = local_repo.find_remote("origin").unwrap();
        remote.push(&["refs/tmp/ahead:refs/heads/main"], None).unwrap();

        pull(repo_path, "origin").unwrap();

        let local_head = local_repo.head().unwrap().target().unwrap();
        assert_eq!(local_head, ahead_oid);
    }

    #[test]
    fn pull_is_a_no_op_when_already_up_to_date() {
        let (local_dir, _bare_dir, _local_repo) = init_repo_with_remote();
        let repo_path = local_dir.path().to_str().unwrap();
        push(repo_path, "origin").unwrap();

        pull(repo_path, "origin").unwrap();
    }
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml remote::tests`
Expected: FAIL to compile — `push`, `pull` not defined.

- [ ] **Step 4: Write the implementation**

Add to `src-tauri/src/remote.rs`, below `fetch` (still above `#[cfg(test)]`):

```rust
pub fn push(repo_path: &str, remote_name: &str) -> Result<(), AppError> {
    let repo = Repository::open(repo_path)?;
    let mut remote = repo.find_remote(remote_name)?;
    let head_ref = repo.head()?;
    let branch_name = head_ref
        .name()
        .ok_or_else(|| AppError::Operation("HEAD is not a branch".into()))?
        .to_string();
    let refspec = format!("{branch_name}:{branch_name}");
    let mut opts = git2::PushOptions::new();
    opts.remote_callbacks(make_callbacks());
    remote.push(&[refspec.as_str()], Some(&mut opts))?;
    Ok(())
}

pub fn pull(repo_path: &str, remote_name: &str) -> Result<(), AppError> {
    fetch(repo_path, remote_name)?;
    let repo = Repository::open(repo_path)?;
    let head_ref = repo.head()?;
    let branch_name = head_ref
        .shorthand()
        .ok_or_else(|| AppError::Operation("HEAD is not a branch".into()))?
        .to_string();
    let head_ref_name = head_ref
        .name()
        .ok_or_else(|| AppError::Operation("HEAD is not a branch".into()))?
        .to_string();

    let upstream_ref_name = format!("refs/remotes/{remote_name}/{branch_name}");
    let upstream_oid = repo.refname_to_id(&upstream_ref_name)?;
    let upstream_commit = repo.find_annotated_commit(upstream_oid)?;

    let (merge_analysis, _) = repo.merge_analysis(&[&upstream_commit])?;
    if merge_analysis.is_up_to_date() {
        return Ok(());
    }
    if !merge_analysis.is_fast_forward() {
        return Err(AppError::Operation(
            "pull requires a merge; only fast-forward pulls are supported in this version".into(),
        ));
    }

    let mut branch_ref = repo.find_reference(&head_ref_name)?;
    branch_ref.set_target(upstream_oid, "fast-forward pull")?;
    repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))?;
    Ok(())
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml remote::tests`
Expected: `test result: ok. 4 passed; 0 failed`

- [ ] **Step 6: Run the full backend suite to confirm no regressions**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests from Plan 1, Plan 2, and this plan's Tasks 1–6 pass.

- [ ] **Step 7: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 7: Tauri commands wiring

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `workdir::{get_status, stage_file, unstage_file, commit_changes}` (Tasks 1–3), `diff::get_commit_diff` (Task 4), `remote::{fetch, pull, push}` (Tasks 5–6).
- Produces: Tauri commands `get_status(repo_path: String) -> Result<Vec<StatusEntry>, AppError>`, `stage_file(repo_path: String, file_path: String) -> Result<(), AppError>`, `unstage_file(repo_path: String, file_path: String) -> Result<(), AppError>`, `commit_changes(repo_path: String, message: String) -> Result<String, AppError>`, `get_commit_diff(repo_path: String, oid: String) -> Result<CommitDetail, AppError>`, `fetch_remote(repo_path: String) -> Result<(), AppError>`, `pull_remote(repo_path: String) -> Result<(), AppError>`, `push_remote(repo_path: String) -> Result<(), AppError>`. `fetch_remote`/`pull_remote`/`push_remote` hardcode `"origin"` as the remote name (see Plan 3's header note). Task 8's `src/lib/tauri.ts` calls these by these exact names.

No new unit test — thin wiring over already-tested functions, verified via the full backend suite plus frontend integration tests.

- [ ] **Step 1: Add the commands**

Modify `src-tauri/src/commands.rs` — add these imports alongside the existing ones at the top of the file:

```rust
use crate::diff::{self, CommitDetail};
use crate::remote;
use crate::workdir::{self, StatusEntry};
```

Add these commands at the bottom of the file, after `search_commits`:

```rust
#[tauri::command]
pub fn get_status(repo_path: String) -> Result<Vec<StatusEntry>, AppError> {
    workdir::get_status(&repo_path)
}

#[tauri::command]
pub fn stage_file(repo_path: String, file_path: String) -> Result<(), AppError> {
    workdir::stage_file(&repo_path, &file_path)
}

#[tauri::command]
pub fn unstage_file(repo_path: String, file_path: String) -> Result<(), AppError> {
    workdir::unstage_file(&repo_path, &file_path)
}

#[tauri::command]
pub fn commit_changes(repo_path: String, message: String) -> Result<String, AppError> {
    workdir::commit_changes(&repo_path, &message)
}

#[tauri::command]
pub fn get_commit_diff(repo_path: String, oid: String) -> Result<CommitDetail, AppError> {
    diff::get_commit_diff(&repo_path, &oid)
}

#[tauri::command]
pub fn fetch_remote(repo_path: String) -> Result<(), AppError> {
    remote::fetch(&repo_path, "origin")
}

#[tauri::command]
pub fn pull_remote(repo_path: String) -> Result<(), AppError> {
    remote::pull(&repo_path, "origin")
}

#[tauri::command]
pub fn push_remote(repo_path: String) -> Result<(), AppError> {
    remote::push(&repo_path, "origin")
}
```

- [ ] **Step 2: Register the modules and commands**

Modify `src-tauri/src/lib.rs`:

```rust
mod error;
mod db;
mod repo;
mod graph;
mod search;
mod workdir;
mod diff;
mod remote;
mod commands;
mod test_support;
```

(add `mod workdir;`, `mod diff;`, `mod remote;` after `mod search;`)

```rust
        .invoke_handler(tauri::generate_handler![
            commands::list_repos,
            commands::add_repo,
            commands::remove_repo,
            commands::get_branches,
            commands::get_tags,
            commands::get_commit_graph,
            commands::ensure_search_index,
            commands::search_commits,
            commands::get_status,
            commands::stage_file,
            commands::unstage_file,
            commands::commit_changes,
            commands::get_commit_diff,
            commands::fetch_remote,
            commands::pull_remote,
            commands::push_remote,
        ])
```

- [ ] **Step 3: Verify the backend still builds and all tests pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests from Plan 1, Plan 2, and this plan's Tasks 1–6 still pass, plus a successful compile of the updated `commands.rs` and `lib.rs`.

- [ ] **Step 4: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 8: Working-copy panel (status, stage/unstage, commit)

**Files:**
- Modify: `src/lib/tauri.ts`
- Create: `src/store/workingCopyStore.ts`
- Create: `src/components/WorkingCopyPanel.tsx`
- Create: `src/__tests__/workingCopyStore.test.ts`
- Create: `src/__tests__/WorkingCopyPanel.test.tsx`
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: Tauri commands `get_status`, `stage_file`, `unstage_file`, `commit_changes` (Task 7); `useWorkspaceStore()` for the active repo's path and to trigger a commit-graph refresh after committing.
- Produces: `StatusEntry` TS type; `invokeGetStatus`, `invokeStageFile`, `invokeUnstageFile`, `invokeCommitChanges`; `useWorkingCopyStore()` exposing `{ status, commitMessage, setCommitMessage, refreshStatus(repoPath), stage(repoPath, filePath), unstage(repoPath, filePath), commit(repoPath) }`. Task 9 doesn't consume this; Task 10 doesn't either — this store is self-contained.

- [ ] **Step 1: Write the failing tests**

`src/__tests__/workingCopyStore.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/tauri", () => ({
  invokeGetStatus: vi.fn(),
  invokeStageFile: vi.fn(),
  invokeUnstageFile: vi.fn(),
  invokeCommitChanges: vi.fn(),
}));

import { useWorkingCopyStore } from "../store/workingCopyStore";
import * as tauriLib from "../lib/tauri";

describe("workingCopyStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkingCopyStore.setState({ status: [], commitMessage: "" });
  });

  it("refreshStatus populates status from the backend", async () => {
    (tauriLib.invokeGetStatus as any).mockResolvedValue([{ path: "a.txt", state: "ModifiedUnstaged" }]);
    await useWorkingCopyStore.getState().refreshStatus("/tmp/a");
    expect(useWorkingCopyStore.getState().status).toHaveLength(1);
  });

  it("stage calls invokeStageFile then refreshes status", async () => {
    (tauriLib.invokeStageFile as any).mockResolvedValue(undefined);
    (tauriLib.invokeGetStatus as any).mockResolvedValue([{ path: "a.txt", state: "ModifiedStaged" }]);

    await useWorkingCopyStore.getState().stage("/tmp/a", "a.txt");

    expect(tauriLib.invokeStageFile).toHaveBeenCalledWith("/tmp/a", "a.txt");
    expect(useWorkingCopyStore.getState().status[0].state).toBe("ModifiedStaged");
  });

  it("commit sends the current commit message, then clears it and refreshes status", async () => {
    useWorkingCopyStore.setState({ commitMessage: "fix bug" });
    (tauriLib.invokeCommitChanges as any).mockResolvedValue("deadbeef");
    (tauriLib.invokeGetStatus as any).mockResolvedValue([]);

    await useWorkingCopyStore.getState().commit("/tmp/a");

    expect(tauriLib.invokeCommitChanges).toHaveBeenCalledWith("/tmp/a", "fix bug");
    expect(useWorkingCopyStore.getState().commitMessage).toBe("");
    expect(useWorkingCopyStore.getState().status).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run workingCopyStore`
Expected: FAIL — `src/lib/tauri` doesn't export the new functions yet, and `src/store/workingCopyStore` doesn't exist.

- [ ] **Step 3: Write the implementation**

Add to `src/lib/tauri.ts` (below the existing `SearchHit`/`invokeSearchCommits` block):

```typescript
export type FileState = "Untracked" | "ModifiedUnstaged" | "ModifiedStaged" | "Deleted" | "Renamed";

export interface StatusEntry {
  path: string;
  state: FileState;
}

export interface FileDiff {
  path: string;
  status: string;
  patch: string;
  oldContent: string | null;
  newContent: string | null;
  insertions: number;
  deletions: number;
}

export interface CommitDetail {
  oid: string;
  author: string;
  email: string;
  timestamp: number;
  message: string;
  files: FileDiff[];
}

export const invokeGetStatus = (repoPath: string) => invoke<StatusEntry[]>("get_status", { repoPath });
export const invokeStageFile = (repoPath: string, filePath: string) =>
  invoke<void>("stage_file", { repoPath, filePath });
export const invokeUnstageFile = (repoPath: string, filePath: string) =>
  invoke<void>("unstage_file", { repoPath, filePath });
export const invokeCommitChanges = (repoPath: string, message: string) =>
  invoke<string>("commit_changes", { repoPath, message });
export const invokeGetCommitDiff = (repoPath: string, oid: string) =>
  invoke<CommitDetail>("get_commit_diff", { repoPath, oid });
export const invokeFetchRemote = (repoPath: string) => invoke<void>("fetch_remote", { repoPath });
export const invokePullRemote = (repoPath: string) => invoke<void>("pull_remote", { repoPath });
export const invokePushRemote = (repoPath: string) => invoke<void>("push_remote", { repoPath });
```

`src/store/workingCopyStore.ts`:

```typescript
import { create } from "zustand";
import {
  invokeGetStatus,
  invokeStageFile,
  invokeUnstageFile,
  invokeCommitChanges,
  type StatusEntry,
} from "../lib/tauri";

interface WorkingCopyState {
  status: StatusEntry[];
  commitMessage: string;
  setCommitMessage: (message: string) => void;
  refreshStatus: (repoPath: string) => Promise<void>;
  stage: (repoPath: string, filePath: string) => Promise<void>;
  unstage: (repoPath: string, filePath: string) => Promise<void>;
  commit: (repoPath: string) => Promise<void>;
}

export const useWorkingCopyStore = create<WorkingCopyState>((set, get) => ({
  status: [],
  commitMessage: "",
  setCommitMessage: (commitMessage: string) => set({ commitMessage }),

  refreshStatus: async (repoPath: string) => {
    const status = await invokeGetStatus(repoPath);
    set({ status });
  },

  stage: async (repoPath: string, filePath: string) => {
    await invokeStageFile(repoPath, filePath);
    await get().refreshStatus(repoPath);
  },

  unstage: async (repoPath: string, filePath: string) => {
    await invokeUnstageFile(repoPath, filePath);
    await get().refreshStatus(repoPath);
  },

  commit: async (repoPath: string) => {
    const { commitMessage } = get();
    await invokeCommitChanges(repoPath, commitMessage);
    set({ commitMessage: "" });
    await get().refreshStatus(repoPath);
  },
}));
```

`src/__tests__/WorkingCopyPanel.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useWorkingCopyStore } from "../store/workingCopyStore";
import WorkingCopyPanel from "../components/WorkingCopyPanel";

vi.mock("../lib/tauri", () => ({
  invokeGetStatus: vi.fn(),
  invokeStageFile: vi.fn(),
  invokeUnstageFile: vi.fn(),
  invokeCommitChanges: vi.fn(),
}));

import * as tauriLib from "../lib/tauri";

describe("WorkingCopyPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
    });
    useWorkingCopyStore.setState({
      status: [{ path: "a.txt", state: "ModifiedUnstaged" }],
      commitMessage: "",
    });
  });

  it("stages a file when its Stage button is clicked", async () => {
    (tauriLib.invokeStageFile as any).mockResolvedValue(undefined);
    (tauriLib.invokeGetStatus as any).mockResolvedValue([{ path: "a.txt", state: "ModifiedStaged" }]);

    render(<WorkingCopyPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Stage" }));

    await waitFor(() => {
      expect(tauriLib.invokeStageFile).toHaveBeenCalledWith("/tmp/a", "a.txt");
    });
  });

  it("commits with the typed message and disables the button when message is empty", () => {
    render(<WorkingCopyPanel />);
    const commitButton = screen.getByRole("button", { name: "Commit" });
    expect(commitButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("Commit message"), { target: { value: "fix bug" } });
    expect(commitButton).not.toBeDisabled();
  });
});
```

`src/components/WorkingCopyPanel.tsx`:

```typescript
import { useEffect } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useWorkingCopyStore } from "../store/workingCopyStore";

export default function WorkingCopyPanel() {
  const { activeRepoId, repos } = useWorkspaceStore();
  const { status, commitMessage, setCommitMessage, refreshStatus, stage, unstage, commit } =
    useWorkingCopyStore();
  const activeRepo = repos.find((r) => r.id === activeRepoId);

  useEffect(() => {
    if (activeRepo) refreshStatus(activeRepo.path);
  }, [activeRepo?.path, refreshStatus]);

  if (!activeRepo) return null;

  return (
    <div className="p-2 border-t border-gray-200 text-sm">
      <div className="text-xs uppercase text-gray-400 mb-1">Changes</div>
      <div className="flex flex-col gap-1 mb-2">
        {status.map((entry) => (
          <div key={entry.path} className="flex items-center justify-between gap-1">
            <span className="truncate flex-1">{entry.path}</span>
            <span className="text-gray-400 text-xs">{entry.state}</span>
            {entry.state === "ModifiedStaged" ? (
              <button
                className="text-xs px-2 py-0.5 border border-gray-200 rounded"
                onClick={() => unstage(activeRepo.path, entry.path)}
              >
                Unstage
              </button>
            ) : (
              <button
                className="text-xs px-2 py-0.5 border border-gray-200 rounded"
                onClick={() => stage(activeRepo.path, entry.path)}
              >
                Stage
              </button>
            )}
          </div>
        ))}
      </div>
      <input
        className="w-full px-2 py-1 border border-gray-200 rounded mb-1"
        placeholder="Commit message"
        value={commitMessage}
        onChange={(e) => setCommitMessage(e.target.value)}
      />
      <button
        className="w-full px-2 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
        onClick={() => commit(activeRepo.path)}
        disabled={commitMessage.trim().length === 0}
      >
        Commit
      </button>
    </div>
  );
}
```

Update `src/components/Sidebar.tsx`:

```typescript
import RepoList from "./RepoList";
import BranchTree from "./BranchTree";
import AdvancedSearch from "./AdvancedSearch";
import WorkingCopyPanel from "./WorkingCopyPanel";

export default function Sidebar() {
  return (
    <div className="w-64 border-r border-gray-200 h-full overflow-y-auto flex flex-col">
      <RepoList />
      <BranchTree />
      <WorkingCopyPanel />
      <AdvancedSearch />
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run workingCopyStore WorkingCopyPanel`
Expected: all 5 tests pass (3 store, 2 component).

- [ ] **Step 5: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 9: Fetch/Pull/Push toolbar with error surfacing

**Files:**
- Create: `src/components/Toolbar.tsx`
- Create: `src/__tests__/Toolbar.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `invokeFetchRemote`, `invokePullRemote`, `invokePushRemote` (Task 8's `tauri.ts` additions); `useWorkspaceStore()` for the active repo and to refresh the graph/branches after a successful pull.
- Produces: `Toolbar` component (no props). No later task in this plan consumes its output.

- [ ] **Step 1: Write the failing test**

`src/__tests__/Toolbar.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import Toolbar from "../components/Toolbar";

// setActiveRepo (called by Toolbar's refresh-after-pull/fetch path) also
// calls invokeEnsureSearchIndex internally — it must be mocked here too,
// or that fire-and-forget call throws "not a function" inside the test.
vi.mock("../lib/tauri", () => ({
  invokeFetchRemote: vi.fn(),
  invokePullRemote: vi.fn(),
  invokePushRemote: vi.fn(),
  invokeGetBranches: vi.fn(),
  invokeGetTags: vi.fn(),
  invokeGetCommitGraph: vi.fn(),
  invokeEnsureSearchIndex: vi.fn().mockResolvedValue(undefined),
}));

import * as tauriLib from "../lib/tauri";

describe("Toolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
      branches: [],
      tags: [],
      commits: [],
    });
  });

  it("shows an error banner when push fails", async () => {
    (tauriLib.invokePushRemote as any).mockRejectedValue("push rejected: pull first");

    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: "Push" }));

    await waitFor(() => {
      expect(screen.getByText("push rejected: pull first")).toBeInTheDocument();
    });
  });

  it("refreshes branches after a successful pull", async () => {
    (tauriLib.invokePullRemote as any).mockResolvedValue(undefined);
    (tauriLib.invokeGetBranches as any).mockResolvedValue([]);
    (tauriLib.invokeGetTags as any).mockResolvedValue([]);
    (tauriLib.invokeGetCommitGraph as any).mockResolvedValue([]);

    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: "Pull" }));

    await waitFor(() => {
      expect(tauriLib.invokeGetBranches).toHaveBeenCalledWith("/tmp/a");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run Toolbar`
Expected: FAIL — `Toolbar` component does not exist yet.

- [ ] **Step 3: Write the implementation**

`src/components/Toolbar.tsx`:

```typescript
import { useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { invokeFetchRemote, invokePullRemote, invokePushRemote } from "../lib/tauri";

export default function Toolbar() {
  const { activeRepoId, repos, setActiveRepo } = useWorkspaceStore();
  const [error, setError] = useState<string | null>(null);
  const activeRepo = repos.find((r) => r.id === activeRepoId);

  const run = async (action: (path: string) => Promise<unknown>, refreshAfter: boolean) => {
    if (!activeRepo) return;
    setError(null);
    try {
      await action(activeRepo.path);
      if (refreshAfter) await setActiveRepo(activeRepo.id);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="flex items-center gap-2 px-2 py-1 border-b border-gray-200">
      <button
        className="text-xs px-2 py-1 border border-gray-200 rounded disabled:opacity-50"
        onClick={() => run(invokeFetchRemote, true)}
        disabled={!activeRepo}
      >
        Fetch
      </button>
      <button
        className="text-xs px-2 py-1 border border-gray-200 rounded disabled:opacity-50"
        onClick={() => run(invokePullRemote, true)}
        disabled={!activeRepo}
      >
        Pull
      </button>
      <button
        className="text-xs px-2 py-1 border border-gray-200 rounded disabled:opacity-50"
        onClick={() => run(invokePushRemote, false)}
        disabled={!activeRepo}
      >
        Push
      </button>
      {error && <span className="text-xs text-red-600 truncate">{error}</span>}
    </div>
  );
}
```

Note: `setActiveRepo` is reused here to refresh branches/tags/commits after fetch/pull, rather than adding a separate "refresh" action — it does exactly what a refresh needs (re-fetches branches, tags, and the commit graph for the already-active repo) and is already tested in Plan 1's `workspaceStore.test.ts`.

- [ ] **Step 4: Wire the Toolbar into App**

Update `src/App.tsx`:

```typescript
import Sidebar from "./components/Sidebar";
import CommitGraph from "./components/CommitGraph";
import SearchBar from "./components/SearchBar";
import Toolbar from "./components/Toolbar";

export default function App() {
  return (
    <div className="h-screen w-screen flex flex-col">
      <SearchBar />
      <Toolbar />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <CommitGraph />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run Toolbar`
Expected: both tests pass.

- [ ] **Step 6: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 10: Commit selection, diff viewer, and bottom drawer

**Files:**
- Create: `src/store/uiStore.ts`
- Create: `src/components/DiffViewer.tsx`
- Create: `src/components/CommitDrawer.tsx`
- Create: `src/__tests__/CommitDrawer.test.tsx`
- Modify: `src/components/CommitGraphRow.tsx`
- Modify: `src/App.tsx`
- Modify: `e2e/mockTauri.ts`
- Create: `e2e/workingcopy.spec.ts`

**Interfaces:**
- Consumes: `invokeGetCommitDiff` (Task 8's `tauri.ts` additions), `useWorkspaceStore()` for the active repo path.
- Produces: `useUiStore()` exposing `{ selectedCommitOid, selectCommit(oid) }`; `DiffViewer({ files: FileDiff[] })` (unified/side-by-side toggle); `CommitDrawer` (no props, reads `uiStore` + fetches `CommitDetail`). Last task in this plan — nothing consumes these further.

- [ ] **Step 1: Write the failing test**

`src/__tests__/CommitDrawer.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useUiStore } from "../store/uiStore";
import CommitDrawer from "../components/CommitDrawer";

vi.mock("../lib/tauri", () => ({
  invokeGetCommitDiff: vi.fn(),
}));

import * as tauriLib from "../lib/tauri";

describe("CommitDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
    });
    useUiStore.setState({ selectedCommitOid: null });
  });

  it("renders nothing when no commit is selected", () => {
    render(<CommitDrawer />);
    expect(screen.queryByText("fix bug")).not.toBeInTheDocument();
  });

  it("loads and renders commit metadata and diff when a commit is selected", async () => {
    (tauriLib.invokeGetCommitDiff as any).mockResolvedValue({
      oid: "c2",
      author: "Test User",
      email: "test@example.com",
      timestamp: 200,
      message: "fix bug",
      files: [
        { path: "a.txt", status: "modified", patch: "-one\n+two\n", oldContent: "one", newContent: "two", insertions: 1, deletions: 1 },
      ],
    });
    useUiStore.setState({ selectedCommitOid: "c2" });

    render(<CommitDrawer />);

    await waitFor(() => {
      expect(screen.getByText("fix bug")).toBeInTheDocument();
    });
    expect(screen.getByText("a.txt")).toBeInTheDocument();
    expect(tauriLib.invokeGetCommitDiff).toHaveBeenCalledWith("/tmp/a", "c2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run CommitDrawer`
Expected: FAIL — `useUiStore`, `CommitDrawer` do not exist yet.

- [ ] **Step 3: Write the implementation**

`src/store/uiStore.ts`:

```typescript
import { create } from "zustand";

interface UiState {
  selectedCommitOid: string | null;
  selectCommit: (oid: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedCommitOid: null,
  selectCommit: (selectedCommitOid: string | null) => set({ selectedCommitOid }),
}));
```

`src/components/DiffViewer.tsx`:

```typescript
import { useState } from "react";
import { type FileDiff } from "../lib/tauri";

export default function DiffViewer({ files }: { files: FileDiff[] }) {
  const [mode, setMode] = useState<"unified" | "split">("unified");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        <button
          className={`text-xs px-2 py-0.5 rounded ${mode === "unified" ? "bg-blue-600 text-white" : "border border-gray-200"}`}
          onClick={() => setMode("unified")}
        >
          Unified
        </button>
        <button
          className={`text-xs px-2 py-0.5 rounded ${mode === "split" ? "bg-blue-600 text-white" : "border border-gray-200"}`}
          onClick={() => setMode("split")}
        >
          Side-by-side
        </button>
      </div>
      {files.map((file) => (
        <div key={file.path} className="border border-gray-200 rounded">
          <div className="px-2 py-1 bg-gray-50 text-xs font-medium flex justify-between">
            <span>{file.path}</span>
            <span className="text-gray-400">
              {file.status} <span className="text-green-600">+{file.insertions}</span>{" "}
              <span className="text-red-600">-{file.deletions}</span>
            </span>
          </div>
          {mode === "unified" ? (
            <pre className="text-xs p-2 overflow-x-auto whitespace-pre-wrap">{file.patch}</pre>
          ) : (
            <div className="grid grid-cols-2 gap-px bg-gray-200">
              <pre className="text-xs p-2 bg-white overflow-x-auto whitespace-pre-wrap">
                {file.oldContent ?? ""}
              </pre>
              <pre className="text-xs p-2 bg-white overflow-x-auto whitespace-pre-wrap">
                {file.newContent ?? ""}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

`src/components/CommitDrawer.tsx`:

```typescript
import { useEffect, useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useUiStore } from "../store/uiStore";
import { invokeGetCommitDiff, type CommitDetail } from "../lib/tauri";
import DiffViewer from "./DiffViewer";

export default function CommitDrawer() {
  const { activeRepoId, repos } = useWorkspaceStore();
  const { selectedCommitOid, selectCommit } = useUiStore();
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const activeRepo = repos.find((r) => r.id === activeRepoId);

  useEffect(() => {
    if (!activeRepo || !selectedCommitOid) {
      setDetail(null);
      return;
    }
    invokeGetCommitDiff(activeRepo.path, selectedCommitOid).then(setDetail);
  }, [activeRepo?.path, selectedCommitOid]);

  if (!selectedCommitOid || !detail) return null;

  const date = new Date(detail.timestamp * 1000).toLocaleString();

  return (
    <div className="border-t border-gray-200 bg-white max-h-80 overflow-y-auto p-3">
      <div className="flex justify-between items-start mb-2">
        <div>
          <div className="font-medium">{detail.message}</div>
          <div className="text-xs text-gray-400">
            {detail.author} &lt;{detail.email}&gt; — {date}
          </div>
        </div>
        <button className="text-xs text-gray-400" onClick={() => selectCommit(null)}>
          Close
        </button>
      </div>
      <DiffViewer files={detail.files} />
    </div>
  );
}
```

Update `src/components/CommitGraphRow.tsx` — add the click handler:

```typescript
import { GraphCommit } from "../lib/tauri";
import { useUiStore } from "../store/uiStore";

const LANE_WIDTH = 16;
const ROW_HEIGHT = 24;

export default function CommitGraphRow({ commit }: { commit: GraphCommit }) {
  const selectCommit = useUiStore((s) => s.selectCommit);
  const cx = 12 + commit.lane * LANE_WIDTH;
  const date = new Date(commit.timestamp * 1000).toLocaleDateString();

  return (
    <div
      data-testid="commit-row"
      className="flex items-center h-6 text-sm cursor-pointer hover:bg-gray-50"
      style={{ height: ROW_HEIGHT }}
      onClick={() => selectCommit(commit.oid)}
    >
      <svg width={cx + 12} height={ROW_HEIGHT} className="shrink-0">
        <circle data-testid="commit-dot" cx={cx} cy={ROW_HEIGHT / 2} r={4} fill="#2563eb" />
      </svg>
      <span className="truncate flex-1">{commit.summary}</span>
      <span className="text-gray-400 w-24 text-right">{commit.author}</span>
      <span className="text-gray-400 w-20 text-right">{date}</span>
    </div>
  );
}
```

Update `src/App.tsx`:

```typescript
import Sidebar from "./components/Sidebar";
import CommitGraph from "./components/CommitGraph";
import SearchBar from "./components/SearchBar";
import Toolbar from "./components/Toolbar";
import CommitDrawer from "./components/CommitDrawer";

export default function App() {
  return (
    <div className="h-screen w-screen flex flex-col">
      <SearchBar />
      <Toolbar />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <CommitGraph />
          <CommitDrawer />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run CommitDrawer`
Expected: both tests pass.

- [ ] **Step 5: Extend the e2e mock and write the e2e test**

Modify `e2e/mockTauri.ts` — add fixture data and cases (place the new fixture near the others, and the new `switch` cases before `default:`):

```typescript
    const statusFixture = [{ path: "new.txt", state: "Untracked" }];
    const commitDiffFixture = {
      oid: "c2",
      author: "Test User",
      email: "test@example.com",
      timestamp: 200,
      message: "second commit",
      files: [
        { path: "a.txt", status: "modified", patch: "-one\n+two\n", oldContent: "one", newContent: "two", insertions: 1, deletions: 1 },
      ],
    };
```

```typescript
          case "get_status":
            return statusFixture;
          case "stage_file":
          case "unstage_file":
            return null;
          case "commit_changes":
            return "newcommitoid";
          case "get_commit_diff":
            return commitDiffFixture;
```

`e2e/workingcopy.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";
import { installTauriMock } from "./mockTauri";

test("stage a file, commit it, then view a commit's diff in the drawer", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  await page.getByRole("button", { name: "+ Add repo" }).click();
  await page.getByText("repo-a").click();

  await expect(page.getByText("new.txt")).toBeVisible();
  await page.getByRole("button", { name: "Stage" }).click();

  await page.getByPlaceholder("Commit message").fill("add new.txt");
  await page.getByRole("button", { name: "Commit" }).click();

  await page.getByTestId("commit-row").first().click();
  await expect(page.getByText("second commit").last()).toBeVisible();
  await expect(page.getByText("a.txt")).toBeVisible();

  await page.getByRole("button", { name: "Side-by-side" }).click();
  await expect(page.getByText("one")).toBeVisible();
  await expect(page.getByText("two")).toBeVisible();
});
```

- [ ] **Step 6: Run the full test suite**

Run: `npm run e2e`
Expected: all three e2e specs pass — `workspace.spec.ts`, `search.spec.ts`, `workingcopy.spec.ts`.

Run: `npm test`
Expected: all Vitest suites pass, including this plan's new tests.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all Rust tests from Plan 1, Plan 2, and this plan pass — no regressions.

- [ ] **Step 7: Mark task complete**

No commit (see Global Constraints). Update the progress ledger — Plan 3 is now complete, and Bettertree's v1 scope (per the spec) is done.

---

## Definition of Done for Plan 3

- The working-copy panel shows untracked/modified/staged files, lets the user stage/unstage individually, and commit with a message — verified by Rust unit tests (Tasks 1–3), frontend tests (Task 8), and the e2e flow (Task 10).
- Fetch/Pull/Push buttons work against a real remote (fast-forward pulls only, v1), with failures surfaced as a visible error message rather than a silent failure or crash — verified by Rust unit tests against a local bare-repo fixture (Tasks 5–6) and a frontend test asserting the error banner (Task 9).
- Clicking a commit in the graph opens a bottom drawer with its metadata and a diff viewer that toggles between unified and side-by-side — verified by frontend tests (Task 10) and the e2e flow.
- `cargo test --manifest-path src-tauri/Cargo.toml` passes (Plan 1 + 2 + 3 Rust tests, no regressions).
- `npm test` passes (Plan 1 + 2 + 3 Vitest tests, no regressions).
- `npm run e2e` passes all three specs (`workspace.spec.ts`, `search.spec.ts`, `workingcopy.spec.ts`).
- This completes the spec's v1 scope: multi-repo workspace, commit graph + branch view, branch/tag/message/content search with filters, working-copy operations, and rich metadata/diff panels.

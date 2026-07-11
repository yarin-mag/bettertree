# Bettertree Plan 2: Commit Message/Content Search (SQLite FTS5) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full-history commit message and content (diff) search with author/date filters, backed by a per-repo SQLite FTS5 index, with a live-walk fallback when the index isn't available.

**Architecture:** A new Rust `search.rs` module builds a per-repo FTS5 index (one SQLite file per repo, keyed by a hash of the repo path) containing one row per commit (message, author, timestamp, and the commit's diff text). A new "Search history" panel in the frontend queries it via two new Tauri commands. The existing Plan 1 quick filter (branch/tag/loaded-commit fuzzy search) is untouched; this is a separate, deeper search over full history.

**Tech Stack:** Same as Plan 1 — Tauri v2, Rust, git2, rusqlite (with FTS5), React 18, TypeScript, Zustand, Tailwind CSS.

**Relationship to spec:** This is Plan 2 of 3 covering `docs/superpowers/specs/2026-07-06-bettertree-design.md`. Plan 1 delivered the read-only workspace/graph/branch-search foundation. Plan 3 will add working-copy operations (stage/commit/push/pull/fetch) and the diff viewer/drawer UI. **v1 simplification (documented, not a gap):** the spec calls for "incremental index update on fetch"; since `fetch` doesn't exist until Plan 3, this plan does a full index rebuild each time a repo becomes active. Plan 3 should replace the rebuild-on-activate call with rebuild-on-fetch plus incremental append, per the spec's original design.

## Global Constraints

- **No git version control for this project.** Do not run `git init`, `git add`, or `git commit`. Every task's last step is "mark task complete," not a commit.
- Builds on Plan 1's files — read `src-tauri/src/{error,db,repo,graph,commands,lib}.rs` and `src/{lib/tauri.ts,store/workspaceStore.ts,store/searchStore.ts,components/*}` before starting; this plan modifies several of them.
- SQLite via `rusqlite` (already a dependency) — enable the `bundled` feature's FTS5 support by adding the `"bundled"` build already present; no new crate dependency needed for FTS5 itself (it ships in SQLite's amalgamation, enabled by default in `rusqlite`'s bundled build).
- Cross-platform target: macOS, Windows, Linux — use `PathBuf`/`Path` for all index file paths.
- Read-only scope still holds: no push/pull/fetch/stage/commit in this plan — those remain Plan 3.
- Index files live under `<data_dir>/bettertree/index/<hash-of-repo-path>.db`, separate from the Plan 1 workspace registry (`<data_dir>/bettertree/workspace.db`).
- Every task's last verification step re-runs the full test suite (`cargo test` + `npm test` + `npm run e2e`), per the spec's cross-phase testing policy — not just the new task's own tests.

---

## File Structure

```
bettertree/
  src-tauri/src/
    error.rs           # MODIFY: add Io and NoDataDir variants
    search.rs           # NEW: FTS5 index builder, indexed search, live-walk fallback
    commands.rs         # MODIFY: add ensure_search_index, search_commits commands
    lib.rs               # MODIFY: register search module and new commands
  src/
    lib/tauri.ts         # MODIFY: add SearchHit type, invokeEnsureSearchIndex, invokeSearchCommits
    store/workspaceStore.ts  # MODIFY: fire-and-forget ensure_search_index on setActiveRepo
    store/searchStore.ts      # MODIFY: add advanced-search state and runAdvancedSearch action
    components/
      AdvancedSearch.tsx  # NEW: history search panel (query/author/date inputs + results)
      Sidebar.tsx          # MODIFY: render AdvancedSearch below BranchTree
    __tests__/
      workspaceStore.test.ts  # MODIFY: assert ensure_search_index fires on setActiveRepo
      AdvancedSearch.test.tsx  # NEW
  e2e/
    mockTauri.ts          # MODIFY: add ensure_search_index/search_commits mock handlers
    search.spec.ts         # NEW: advanced search e2e flow
```

`search.rs` owns everything FTS5-related (schema, indexing, querying, fallback) — no other module touches SQLite full-text search. `AdvancedSearch.tsx` owns the history-search UI; it doesn't touch the Plan 1 quick-filter UI (`SearchBar.tsx`, `BranchTree.tsx`, `CommitGraph.tsx` are untouched by this plan).

---

### Task 1: Error variants and FTS5 index builder

**Files:**
- Modify: `src-tauri/src/error.rs`
- Create: `src-tauri/src/search.rs`

**Interfaces:**
- Consumes: `AppError` (extended here), `test_support::init_repo_with_commits` (tests only).
- Produces: `AppError::Io` and `AppError::NoDataDir` variants; `ensure_index_at(index_dir: &Path, repo_path: &str) -> Result<(), AppError>` (testable, takes an explicit index directory); `ensure_index(repo_path: &str) -> Result<(), AppError>` (production entry point, resolves the real app data dir). Task 2 builds `search_commits_at`/`search_commits` on top of the index this task creates.

- [ ] **Step 1: Confirm FTS5 is available**

rusqlite 0.31 has no separate `fts5` cargo feature — the existing `bundled` feature (already in `src-tauri/Cargo.toml` from Plan 1) compiles SQLite from source via `libsqlite3-sys`, which enables FTS5 by default. No `Cargo.toml` change is needed; this step exists only so the plan doesn't silently assume FTS5 works — Task 1's own tests (`CREATE VIRTUAL TABLE ... USING fts5(...)`) are the actual verification.

- [ ] **Step 2: Add the new error variants**

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

- [ ] **Step 3: Write the failing test**

`src-tauri/src/search.rs` (tests only for now):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::init_repo_with_commits;
    use tempfile::TempDir;

    #[test]
    fn ensure_index_creates_one_row_per_commit() {
        let (repo_dir, _repo) = init_repo_with_commits();
        let index_dir = TempDir::new().unwrap();

        ensure_index_at(index_dir.path(), repo_dir.path().to_str().unwrap()).unwrap();

        let db_path = index_db_path(index_dir.path(), repo_dir.path().to_str().unwrap());
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM commits_fts", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn ensure_index_stores_diff_text_for_content_search() {
        let (repo_dir, _repo) = init_repo_with_commits();
        let index_dir = TempDir::new().unwrap();

        ensure_index_at(index_dir.path(), repo_dir.path().to_str().unwrap()).unwrap();

        let db_path = index_db_path(index_dir.path(), repo_dir.path().to_str().unwrap());
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        let diff_text: String = conn
            .query_row(
                "SELECT diff_text FROM commits_fts WHERE summary = 'second commit'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(diff_text.contains("two"), "diff_text was: {diff_text}");
    }
}
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml search::tests`
Expected: FAIL to compile — `ensure_index_at`, `index_db_path` not defined.

- [ ] **Step 5: Write the implementation**

Prepend this to `src-tauri/src/search.rs` (above the `#[cfg(test)]` block):

```rust
use crate::error::AppError;
use git2::{Repository, Sort};
use rusqlite::{params, Connection};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

fn repo_hash(repo_path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    repo_path.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn index_db_path(index_dir: &Path, repo_path: &str) -> PathBuf {
    index_dir.join(format!("{}.db", repo_hash(repo_path)))
}

fn default_index_dir() -> Result<PathBuf, AppError> {
    let base = dirs::data_dir().ok_or(AppError::NoDataDir)?;
    Ok(base.join("bettertree").join("index"))
}

fn commit_diff_text(repo: &Repository, commit: &git2::Commit) -> Result<String, AppError> {
    let tree = commit.tree()?;
    let parent_tree = if commit.parent_count() > 0 {
        Some(commit.parent(0)?.tree()?)
    } else {
        None
    };
    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)?;
    let mut text = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        if let Ok(s) = std::str::from_utf8(line.content()) {
            text.push_str(s);
        }
        true
    })?;
    Ok(text)
}

/// Builds (or fully rebuilds) the FTS5 search index for a repo under the
/// given index directory. v1 always does a full rebuild — see Plan 2's
/// header note on why incremental updates wait for Plan 3's fetch support.
pub fn ensure_index_at(index_dir: &Path, repo_path: &str) -> Result<(), AppError> {
    std::fs::create_dir_all(index_dir)?;
    let db_path = index_db_path(index_dir, repo_path);
    let conn = Connection::open(&db_path)?;
    conn.execute_batch(
        "DROP TABLE IF EXISTS commits_fts;
         CREATE VIRTUAL TABLE commits_fts USING fts5(
            oid UNINDEXED,
            summary,
            author UNINDEXED,
            timestamp UNINDEXED,
            diff_text
         );",
    )?;

    let repo = Repository::open(repo_path)?;
    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;

    for oid_result in revwalk {
        let oid = oid_result?;
        let commit = repo.find_commit(oid)?;
        let diff_text = commit_diff_text(&repo, &commit)?;
        let author = commit.author();
        conn.execute(
            "INSERT INTO commits_fts (oid, summary, author, timestamp, diff_text) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                oid.to_string(),
                commit.summary().unwrap_or(""),
                author.name().unwrap_or(""),
                commit.time().seconds(),
                diff_text,
            ],
        )?;
    }
    Ok(())
}

pub fn ensure_index(repo_path: &str) -> Result<(), AppError> {
    ensure_index_at(&default_index_dir()?, repo_path)
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml search::tests`
Expected: `test result: ok. 2 passed; 0 failed`

- [ ] **Step 7: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 2: Indexed search with author/date filters

**Files:**
- Modify: `src-tauri/src/search.rs`

**Interfaces:**
- Consumes: `index_db_path`, `default_index_dir` (Task 1, both private to this module).
- Produces: `SearchHit { oid: String, summary: String, author: String, timestamp: i64, snippet: String }`, `search_commits_at(index_dir: &Path, repo_path: &str, query: &str, author: Option<&str>, since: Option<i64>, until: Option<i64>) -> Result<Vec<SearchHit>, AppError>`. Task 4's Tauri command and Task 5's frontend `SearchHit` type must match these field names/types exactly.

- [ ] **Step 1: Write the failing tests**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/search.rs` (alongside the Task 1 tests):

```rust
    #[test]
    fn search_finds_commit_by_message() {
        let (repo_dir, _repo) = init_repo_with_commits();
        let index_dir = TempDir::new().unwrap();
        let repo_path = repo_dir.path().to_str().unwrap();
        ensure_index_at(index_dir.path(), repo_path).unwrap();

        let hits = search_commits_at(index_dir.path(), repo_path, "second", None, None, None).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].summary, "second commit");
    }

    #[test]
    fn search_finds_commit_by_diff_content_not_in_message() {
        let (repo_dir, _repo) = init_repo_with_commits();
        let index_dir = TempDir::new().unwrap();
        let repo_path = repo_dir.path().to_str().unwrap();
        ensure_index_at(index_dir.path(), repo_path).unwrap();

        // "two" appears in the second commit's diff but not in either commit's summary.
        let hits = search_commits_at(index_dir.path(), repo_path, "two", None, None, None).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].summary, "second commit");
    }

    #[test]
    fn search_filters_by_author() {
        let (repo_dir, _repo) = init_repo_with_commits();
        let index_dir = TempDir::new().unwrap();
        let repo_path = repo_dir.path().to_str().unwrap();
        ensure_index_at(index_dir.path(), repo_path).unwrap();

        let matching = search_commits_at(index_dir.path(), repo_path, "commit", Some("Test User"), None, None).unwrap();
        assert_eq!(matching.len(), 2);

        let none = search_commits_at(index_dir.path(), repo_path, "commit", Some("Nobody"), None, None).unwrap();
        assert!(none.is_empty());
    }

    #[test]
    fn search_filters_by_date_range() {
        let dir = TempDir::new().unwrap();
        let mut opts = git2::RepositoryInitOptions::new();
        opts.initial_head("main");
        let repo = Repository::init_opts(dir.path(), &opts).unwrap();

        let old_time = git2::Time::new(1_000_000_000, 0);
        let old_sig = git2::Signature::new("Test User", "test@example.com", &old_time).unwrap();
        std::fs::write(dir.path().join("a.txt"), "one").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("a.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        repo.commit(Some("HEAD"), &old_sig, &old_sig, "old commit", &tree, &[]).unwrap();

        let new_time = git2::Time::new(2_000_000_000, 0);
        let new_sig = git2::Signature::new("Test User", "test@example.com", &new_time).unwrap();
        std::fs::write(dir.path().join("a.txt"), "two").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("a.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(Some("HEAD"), &new_sig, &new_sig, "new commit", &tree, &[&parent]).unwrap();

        let index_dir = TempDir::new().unwrap();
        let repo_path = dir.path().to_str().unwrap();
        ensure_index_at(index_dir.path(), repo_path).unwrap();

        let all = search_commits_at(index_dir.path(), repo_path, "commit", None, None, None).unwrap();
        assert_eq!(all.len(), 2);

        let only_new = search_commits_at(index_dir.path(), repo_path, "commit", None, Some(1_500_000_000), None).unwrap();
        assert_eq!(only_new.len(), 1);
        assert_eq!(only_new[0].summary, "new commit");

        let only_old = search_commits_at(index_dir.path(), repo_path, "commit", None, None, Some(1_500_000_000)).unwrap();
        assert_eq!(only_old.len(), 1);
        assert_eq!(only_old[0].summary, "old commit");
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml search::tests`
Expected: FAIL to compile — `SearchHit`, `search_commits_at` not defined.

- [ ] **Step 3: Write the implementation**

Add to `src-tauri/src/search.rs`, below the Task 1 code (still above `#[cfg(test)]`):

```rust
#[derive(Debug, Clone, serde::Serialize)]
pub struct SearchHit {
    pub oid: String,
    pub summary: String,
    pub author: String,
    pub timestamp: i64,
    pub snippet: String,
}

pub fn search_commits_at(
    index_dir: &Path,
    repo_path: &str,
    query: &str,
    author: Option<&str>,
    since: Option<i64>,
    until: Option<i64>,
) -> Result<Vec<SearchHit>, AppError> {
    let db_path = index_db_path(index_dir, repo_path);
    if db_path.exists() {
        search_indexed(&db_path, query, author, since, until)
    } else {
        search_live(repo_path, query, author, since, until)
    }
}

pub fn search_commits(
    repo_path: &str,
    query: &str,
    author: Option<&str>,
    since: Option<i64>,
    until: Option<i64>,
) -> Result<Vec<SearchHit>, AppError> {
    search_commits_at(&default_index_dir()?, repo_path, query, author, since, until)
}

fn search_indexed(
    db_path: &Path,
    query: &str,
    author: Option<&str>,
    since: Option<i64>,
    until: Option<i64>,
) -> Result<Vec<SearchHit>, AppError> {
    let conn = Connection::open(db_path)?;
    let mut sql = String::from(
        "SELECT oid, summary, author, timestamp, snippet(commits_fts, -1, '[', ']', '...', 8) \
         FROM commits_fts WHERE commits_fts MATCH ?1",
    );
    let mut bound: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(query.to_string())];

    if let Some(a) = author {
        sql.push_str(&format!(" AND author LIKE ?{}", bound.len() + 1));
        bound.push(Box::new(format!("%{}%", a)));
    }
    if let Some(s) = since {
        sql.push_str(&format!(" AND timestamp >= ?{}", bound.len() + 1));
        bound.push(Box::new(s));
    }
    if let Some(u) = until {
        sql.push_str(&format!(" AND timestamp <= ?{}", bound.len() + 1));
        bound.push(Box::new(u));
    }
    sql.push_str(" ORDER BY timestamp DESC");

    let mut stmt = conn.prepare(&sql)?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = bound.iter().map(|b| b.as_ref()).collect();
    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        Ok(SearchHit {
            oid: row.get(0)?,
            summary: row.get(1)?,
            author: row.get(2)?,
            timestamp: row.get(3)?,
            snippet: row.get(4)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Used when no index exists yet for a repo. Only searches commit
/// messages (not diff content) and does simple case-insensitive
/// substring matching rather than FTS ranking — a deliberately smaller
/// feature set than the indexed path, acceptable for the rare case where
/// a search happens before the background index finishes.
fn search_live(
    repo_path: &str,
    query: &str,
    author: Option<&str>,
    since: Option<i64>,
    until: Option<i64>,
) -> Result<Vec<SearchHit>, AppError> {
    let repo = Repository::open(repo_path)?;
    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;

    let query_lower = query.to_lowercase();
    let mut out = Vec::new();
    for oid_result in revwalk {
        let oid = oid_result?;
        let commit = repo.find_commit(oid)?;
        let summary = commit.summary().unwrap_or("").to_string();
        let author_name = commit.author().name().unwrap_or("").to_string();
        let timestamp = commit.time().seconds();

        if !query.is_empty() && !summary.to_lowercase().contains(&query_lower) {
            continue;
        }
        if let Some(a) = author {
            if !author_name.to_lowercase().contains(&a.to_lowercase()) {
                continue;
            }
        }
        if let Some(s) = since {
            if timestamp < s {
                continue;
            }
        }
        if let Some(u) = until {
            if timestamp > u {
                continue;
            }
        }
        out.push(SearchHit {
            oid: oid.to_string(),
            summary: summary.clone(),
            author: author_name,
            timestamp,
            snippet: summary,
        });
    }
    Ok(out)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml search::tests`
Expected: `test result: ok. 6 passed; 0 failed`

- [ ] **Step 5: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 3: Live-walk fallback test (no index present)

**Files:**
- Modify: `src-tauri/src/search.rs`

**Interfaces:**
- Consumes: `search_commits_at` (Task 2).
- Produces: nothing new — this task only adds test coverage for the fallback branch of `search_commits_at` that Task 2 already implemented (`search_live`), since Task 2's tests only exercised the indexed branch.

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)] mod tests` block:

```rust
    #[test]
    fn falls_back_to_live_search_when_no_index_exists() {
        let (repo_dir, _repo) = init_repo_with_commits();
        let index_dir = TempDir::new().unwrap();
        let repo_path = repo_dir.path().to_str().unwrap();
        // Deliberately do not call ensure_index_at — no .db file exists yet.

        let hits = search_commits_at(index_dir.path(), repo_path, "second", None, None, None).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].summary, "second commit");
    }
```

This test is expected to pass immediately since `search_commits_at`'s existence check already routes to `search_live` — it's a regression guard, not new functionality.

- [ ] **Step 2: Run the test**

Run: `cargo test --manifest-path src-tauri/Cargo.toml search::tests::falls_back_to_live_search_when_no_index_exists`
Expected: PASS (1 passed).

- [ ] **Step 3: Run the full backend suite to confirm no regressions**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests from Plan 1 (Tasks 2–5) plus this plan's Tasks 1–3 pass — `test result: ok.` for every module.

- [ ] **Step 4: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 4: Tauri commands wiring

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `search::{ensure_index, search_commits, SearchHit}` (Tasks 1–2).
- Produces: Tauri commands `ensure_search_index(repo_path: String) -> Result<(), AppError>`, `search_commits(repo_path: String, query: String, author: Option<String>, since: Option<i64>, until: Option<i64>) -> Result<Vec<SearchHit>, AppError>`. Task 5's `src/lib/tauri.ts` calls these by these exact names.

No new unit test — this is thin wiring over already-tested functions, verified via the full backend suite plus the frontend integration test in later tasks.

- [ ] **Step 1: Add the commands**

Modify `src-tauri/src/commands.rs` — add these two commands and the `search` import:

```rust
use crate::search::{self, SearchHit};
```

(add this alongside the existing `use` lines at the top of the file)

```rust
#[tauri::command]
pub fn ensure_search_index(repo_path: String) -> Result<(), AppError> {
    search::ensure_index(&repo_path)
}

#[tauri::command]
pub fn search_commits(
    repo_path: String,
    query: String,
    author: Option<String>,
    since: Option<i64>,
    until: Option<i64>,
) -> Result<Vec<SearchHit>, AppError> {
    search::search_commits(&repo_path, &query, author.as_deref(), since, until)
}
```

(add these two functions at the bottom of the file, after the existing `get_commit_graph` command)

- [ ] **Step 2: Register the module and commands**

Modify `src-tauri/src/lib.rs`:

```rust
mod error;
mod db;
mod repo;
mod graph;
mod search;
mod commands;
mod test_support;
```

(add `mod search;` after `mod graph;`)

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
        ])
```

(replace the existing `invoke_handler!` list with this one, which adds the two new commands)

- [ ] **Step 3: Verify the backend still builds and all tests pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests from Plan 1 and this plan's Tasks 1–3 still pass, plus a successful compile of the updated `commands.rs` and `lib.rs`.

- [ ] **Step 4: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 5: Frontend wiring — tauri.ts, searchStore, workspaceStore

**Files:**
- Modify: `src/lib/tauri.ts`
- Modify: `src/store/searchStore.ts`
- Modify: `src/store/workspaceStore.ts`
- Modify: `src/__tests__/workspaceStore.test.ts`

**Interfaces:**
- Consumes: Tauri commands `ensure_search_index`, `search_commits` (Task 4).
- Produces: `SearchHit` TS type, `invokeEnsureSearchIndex(repoPath: string) -> Promise<void>`, `invokeSearchCommits(repoPath: string, query: string, author?: string, since?: number, until?: number) -> Promise<SearchHit[]>`; `useSearchStore()` gains `historyQuery`, `setHistoryQuery`, `authorFilter`, `setAuthorFilter`, `sinceFilter`, `setSinceFilter`, `untilFilter`, `setUntilFilter`, `advancedResults`, `runAdvancedSearch(repoPath: string) -> Promise<void>`. Task 6's `AdvancedSearch.tsx` consumes all of these.

- [ ] **Step 1: Write the failing test**

Add this test to `src/__tests__/workspaceStore.test.ts` (extend the existing `vi.mock` factory and add a new test to the existing `describe` block):

Update the `vi.mock` call at the top of the file to also mock the new function:

```typescript
vi.mock("../lib/tauri", () => ({
  invokeListRepos: vi.fn(),
  invokeAddRepo: vi.fn(),
  invokeGetBranches: vi.fn(),
  invokeGetTags: vi.fn(),
  invokeGetCommitGraph: vi.fn(),
  invokeEnsureSearchIndex: vi.fn().mockResolvedValue(undefined),
}));
```

Add this test inside the existing `describe("workspaceStore", ...)` block:

```typescript
  it("setActiveRepo fires ensure_search_index without blocking on it", async () => {
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
    });
    (tauriLib.invokeGetBranches as any).mockResolvedValue([]);
    (tauriLib.invokeGetTags as any).mockResolvedValue([]);
    (tauriLib.invokeGetCommitGraph as any).mockResolvedValue([]);

    await useWorkspaceStore.getState().setActiveRepo(1);

    expect(tauriLib.invokeEnsureSearchIndex).toHaveBeenCalledWith("/tmp/a");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run workspaceStore`
Expected: FAIL — `invokeEnsureSearchIndex` is not exported from `src/lib/tauri.ts` yet, and `setActiveRepo` doesn't call it.

- [ ] **Step 3: Write the implementation**

Add to `src/lib/tauri.ts` (below the existing `GraphCommit` interface and `invokeGetCommitGraph` export):

```typescript
export interface SearchHit {
  oid: string;
  summary: string;
  author: string;
  timestamp: number;
  snippet: string;
}

export const invokeEnsureSearchIndex = (repoPath: string) =>
  invoke<void>("ensure_search_index", { repoPath });

export const invokeSearchCommits = (
  repoPath: string,
  query: string,
  author?: string,
  since?: number,
  until?: number
) => invoke<SearchHit[]>("search_commits", { repoPath, query, author, since, until });
```

Replace `src/store/workspaceStore.ts` in full:

```typescript
import { create } from "zustand";
import {
  invokeListRepos,
  invokeAddRepo,
  invokeGetBranches,
  invokeGetTags,
  invokeGetCommitGraph,
  invokeEnsureSearchIndex,
  RepoEntry,
  BranchInfo,
  TagInfo,
  GraphCommit,
} from "../lib/tauri";

interface WorkspaceState {
  repos: RepoEntry[];
  activeRepoId: number | null;
  branches: BranchInfo[];
  tags: TagInfo[];
  commits: GraphCommit[];
  loadRepos: () => Promise<void>;
  addRepo: (path: string) => Promise<void>;
  setActiveRepo: (id: number) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  repos: [],
  activeRepoId: null,
  branches: [],
  tags: [],
  commits: [],

  loadRepos: async () => {
    const repos = await invokeListRepos();
    set({ repos });
  },

  addRepo: async (path: string) => {
    const repo = await invokeAddRepo(path);
    set({ repos: [...get().repos, repo] });
  },

  setActiveRepo: async (id: number) => {
    const repo = get().repos.find((r) => r.id === id);
    if (!repo) return;
    set({ activeRepoId: id });
    const [branches, tags, commits] = await Promise.all([
      invokeGetBranches(repo.path),
      invokeGetTags(repo.path),
      invokeGetCommitGraph(repo.path, 200),
    ]);
    set({ branches, tags, commits });
    // Fire-and-forget: index build must not block the UI, and a failed
    // build degrades to the live-walk fallback in search_commits.
    invokeEnsureSearchIndex(repo.path).catch(() => {});
  },
}));
```

Replace `src/store/searchStore.ts` in full:

```typescript
import { create } from "zustand";
import { invokeSearchCommits, type SearchHit } from "../lib/tauri";

interface SearchState {
  query: string;
  setQuery: (query: string) => void;

  historyQuery: string;
  setHistoryQuery: (q: string) => void;
  authorFilter: string;
  setAuthorFilter: (a: string) => void;
  sinceFilter: string;
  setSinceFilter: (d: string) => void;
  untilFilter: string;
  setUntilFilter: (d: string) => void;
  advancedResults: SearchHit[];
  runAdvancedSearch: (repoPath: string) => Promise<void>;
}

function dateToUnixSeconds(dateStr: string): number | undefined {
  if (!dateStr) return undefined;
  const ms = Date.parse(dateStr);
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}

export const useSearchStore = create<SearchState>((set, get) => ({
  query: "",
  setQuery: (query: string) => set({ query }),

  historyQuery: "",
  setHistoryQuery: (historyQuery: string) => set({ historyQuery }),
  authorFilter: "",
  setAuthorFilter: (authorFilter: string) => set({ authorFilter }),
  sinceFilter: "",
  setSinceFilter: (sinceFilter: string) => set({ sinceFilter }),
  untilFilter: "",
  setUntilFilter: (untilFilter: string) => set({ untilFilter }),
  advancedResults: [],

  runAdvancedSearch: async (repoPath: string) => {
    const { historyQuery, authorFilter, sinceFilter, untilFilter } = get();
    const results = await invokeSearchCommits(
      repoPath,
      historyQuery,
      authorFilter || undefined,
      dateToUnixSeconds(sinceFilter),
      dateToUnixSeconds(untilFilter)
    );
    set({ advancedResults: results });
  },
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run workspaceStore`
Expected: all 3 tests pass (2 from Plan 1, 1 new).

- [ ] **Step 5: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 6: AdvancedSearch component

**Files:**
- Create: `src/components/AdvancedSearch.tsx`
- Create: `src/__tests__/AdvancedSearch.test.tsx`
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `useWorkspaceStore()` (`activeRepoId`, `repos`), `useSearchStore()` (Task 5's new fields/actions).
- Produces: `AdvancedSearch` component (no props, reads both stores). No later task in this plan consumes its output.

- [ ] **Step 1: Write the failing test**

`src/__tests__/AdvancedSearch.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSearchStore } from "../store/searchStore";
import AdvancedSearch from "../components/AdvancedSearch";

vi.mock("../lib/tauri", () => ({
  invokeSearchCommits: vi.fn(),
}));

import * as tauriLib from "../lib/tauri";

describe("AdvancedSearch", () => {
  beforeEach(() => {
    // The "Search history" text appears in both the section label and the
    // button, so tests target the button via role, not getByText. Mock call
    // counts also persist across tests unless cleared here.
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
    });
    useSearchStore.setState({
      historyQuery: "",
      authorFilter: "",
      sinceFilter: "",
      untilFilter: "",
      advancedResults: [],
    });
  });

  it("runs a search against the active repo and renders results", async () => {
    (tauriLib.invokeSearchCommits as any).mockResolvedValue([
      { oid: "c2", summary: "second commit", author: "Test User", timestamp: 200, snippet: "...two..." },
    ]);

    render(<AdvancedSearch />);
    fireEvent.change(screen.getByPlaceholderText("Message or code..."), { target: { value: "two" } });
    fireEvent.click(screen.getByRole("button", { name: "Search history" }));

    await waitFor(() => {
      expect(screen.getByTestId("search-hit")).toBeInTheDocument();
    });
    expect(tauriLib.invokeSearchCommits).toHaveBeenCalledWith("/tmp/a", "two", undefined, undefined, undefined);
  });

  it("does nothing when no repo is active", () => {
    useWorkspaceStore.setState({ repos: [], activeRepoId: null });
    render(<AdvancedSearch />);
    fireEvent.click(screen.getByRole("button", { name: "Search history" }));
    expect(tauriLib.invokeSearchCommits).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run AdvancedSearch`
Expected: FAIL — `AdvancedSearch` component does not exist yet.

- [ ] **Step 3: Write the implementation**

`src/components/AdvancedSearch.tsx`:

```typescript
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSearchStore } from "../store/searchStore";

export default function AdvancedSearch() {
  const { activeRepoId, repos } = useWorkspaceStore();
  const {
    historyQuery,
    setHistoryQuery,
    authorFilter,
    setAuthorFilter,
    sinceFilter,
    setSinceFilter,
    untilFilter,
    setUntilFilter,
    advancedResults,
    runAdvancedSearch,
  } = useSearchStore();

  const activeRepo = repos.find((r) => r.id === activeRepoId);

  const handleSearch = () => {
    if (!activeRepo) return;
    runAdvancedSearch(activeRepo.path);
  };

  return (
    <div className="p-2 border-t border-gray-200 text-sm">
      <div className="text-xs uppercase text-gray-400 mb-1">Search history</div>
      <input
        className="w-full px-2 py-1 border border-gray-200 rounded mb-1"
        placeholder="Message or code..."
        value={historyQuery}
        onChange={(e) => setHistoryQuery(e.target.value)}
      />
      <input
        className="w-full px-2 py-1 border border-gray-200 rounded mb-1"
        placeholder="Author"
        value={authorFilter}
        onChange={(e) => setAuthorFilter(e.target.value)}
      />
      <div className="flex gap-1 mb-1">
        <input
          type="date"
          className="flex-1 px-2 py-1 border border-gray-200 rounded"
          value={sinceFilter}
          onChange={(e) => setSinceFilter(e.target.value)}
        />
        <input
          type="date"
          className="flex-1 px-2 py-1 border border-gray-200 rounded"
          value={untilFilter}
          onChange={(e) => setUntilFilter(e.target.value)}
        />
      </div>
      <button
        className="w-full px-2 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
        onClick={handleSearch}
        disabled={!activeRepo}
      >
        Search history
      </button>
      <div className="mt-2 flex flex-col gap-1">
        {advancedResults.map((hit) => (
          <div key={hit.oid} data-testid="search-hit" className="px-1 py-0.5 border-b border-gray-100">
            <div className="font-medium truncate">{hit.summary}</div>
            <div className="text-gray-400 text-xs truncate">{hit.snippet}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

Update `src/components/Sidebar.tsx`:

```typescript
import RepoList from "./RepoList";
import BranchTree from "./BranchTree";
import AdvancedSearch from "./AdvancedSearch";

export default function Sidebar() {
  return (
    <div className="w-64 border-r border-gray-200 h-full overflow-y-auto flex flex-col">
      <RepoList />
      <BranchTree />
      <AdvancedSearch />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run AdvancedSearch`
Expected: both tests pass.

- [ ] **Step 5: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 7: End-to-end test for advanced search

**Files:**
- Modify: `e2e/mockTauri.ts`
- Create: `e2e/search.spec.ts`

**Interfaces:**
- Consumes: the mocked Tauri bridge pattern from Plan 1's `e2e/mockTauri.ts`.
- Produces: nothing new for later tasks — this is the last task in Plan 2.

- [ ] **Step 1: Extend the Tauri mock**

Modify `e2e/mockTauri.ts` — add these two cases to the `switch (cmd)` block (after the existing `get_commit_graph` case), and declare the fixture data above the `switch`:

```typescript
    const searchFixture = [
      { oid: "c1", summary: "first commit", author: "Test User", timestamp: 100, snippet: "...one..." },
      { oid: "c2", summary: "second commit", author: "Test User", timestamp: 200, snippet: "...two..." },
    ];
```

(add this near the other `const ...ByPath` declarations, before the `invoke:` function)

```typescript
          case "ensure_search_index":
            return null;
          case "search_commits":
            return searchFixture.filter((hit) => {
              const q = args.query as string;
              if (q && !(hit.summary.includes(q) || hit.snippet.includes(q))) return false;
              const a = args.author as string | undefined;
              if (a && !hit.author.toLowerCase().includes(a.toLowerCase())) return false;
              return true;
            });
```

(add these two cases inside the existing `switch (cmd)` block, before `default:`)

- [ ] **Step 2: Write the e2e test**

`e2e/search.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";
import { installTauriMock } from "./mockTauri";

test("search commit history by content and filter by author", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  await page.getByRole("button", { name: "+ Add repo" }).click();
  await page.getByText("repo-a").click();

  await page.getByPlaceholder("Message or code...").fill("two");
  await page.getByRole("button", { name: "Search history" }).click();

  await expect(page.getByTestId("search-hit")).toBeVisible();
  await expect(page.getByTestId("search-hit").getByText("second commit")).toBeVisible();

  await page.getByPlaceholder("Author").fill("Nobody");
  await page.getByRole("button", { name: "Search history" }).click();

  await expect(page.getByTestId("search-hit")).not.toBeVisible();
});
```

- [ ] **Step 3: Run the full test suite**

Run: `npm run e2e`
Expected: both `workspace.spec.ts` (Plan 1) and `search.spec.ts` (this task) pass — 2 passed.

Run: `npm test`
Expected: all Vitest suites pass, including this plan's `AdvancedSearch` tests and the updated `workspaceStore` test.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all Rust tests from Plan 1 and this plan's Tasks 1–3 still pass — no regressions.

- [ ] **Step 4: Mark task complete**

No commit (see Global Constraints). Update the progress ledger — Plan 2 is now complete.

---

## Definition of Done for Plan 2

- Switching to a repo triggers a background FTS5 index build that doesn't block the UI (verified by the fire-and-forget wiring in Task 5 and its test).
- The "Search history" panel finds commits by message text, by diff content not present in the message, and can filter by author and by since/until date — all verified by Rust unit tests (Task 2) and the Playwright e2e flow (Task 7).
- Searching a repo with no index yet still returns message-based results via the live-walk fallback (Task 3).
- `cargo test --manifest-path src-tauri/Cargo.toml` passes (Plan 1 + Plan 2 Rust tests, no regressions).
- `npm test` passes (Plan 1 + Plan 2 Vitest tests, no regressions).
- `npm run e2e` passes both `workspace.spec.ts` and `search.spec.ts`.

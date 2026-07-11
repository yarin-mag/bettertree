# Bettertree Plan 1: Foundation (Workspace, Branches, Commit Graph, Name Search) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a working, testable read-only Bettertree app: multi-repo workspace management, branch/tag browsing, commit graph visualization, and branch/tag name search.

**Architecture:** Tauri v2 app — Rust backend using `git2` (libgit2) for repo reads and `rusqlite` for the workspace registry, React+TypeScript frontend using Zustand for state and a custom SVG commit-graph renderer. Frontend calls backend via Tauri `invoke` commands.

**Tech Stack:** Tauri v2, Rust, git2, rusqlite, React 18, TypeScript, Vite, Zustand, Tailwind CSS.

**Relationship to spec:** This is Plan 1 of 3 covering `docs/superpowers/specs/2026-07-06-bettertree-design.md`. Plan 2 will add commit message/content search (SQLite FTS5) and author/date/path filters. Plan 3 will add working-copy operations (stage/commit/push/pull/fetch) and the diff viewer/drawer UI. This plan intentionally does not touch working-copy writes, diffs, or FTS5 search — those are out of scope here.

## Global Constraints

- **No git version control for this project.** Do not run `git init`, `git add`, or `git commit` at any point. Every task's last step is "mark task complete," not a commit.
- Tauri v2, React 18 + TypeScript, Zustand, Tailwind CSS (per spec) — shadcn/ui components are not required until Plan 3's UI grows more complex; Plan 1 uses plain Tailwind-styled elements.
- Rust backend uses `git2` (libgit2 bindings) exclusively — never shell out to the system `git` CLI in this plan's scope.
- SQLite via `rusqlite` for the workspace registry (per spec).
- Cross-platform target: macOS, Windows, Linux — use `PathBuf`/`Path`, never hand-rolled string path separators.
- Read-only scope: no push/pull/fetch/stage/commit in this plan — those are Plan 3.
- Every task includes both a unit-test step and, where it changes user-facing behavior, updates the end-to-end test in Task 8 — per the spec's cross-phase testing policy, the full test suite (`cargo test` + `npm test` + the e2e spec) must pass before a task is marked complete, not just that task's own new tests.

---

## File Structure

```
bettertree/
  src-tauri/
    Cargo.toml
    tauri.conf.json
    src/
      main.rs          # binary entrypoint, calls lib::run()
      lib.rs            # Tauri app builder, command registration, AppState
      error.rs          # AppError enum shared by all backend modules
      db.rs              # SQLite workspace registry (repos table) + CRUD
      repo.rs            # git2 wrapper: list_branches, list_tags
      graph.rs           # commit graph engine: lane assignment algorithm
      commands.rs        # #[tauri::command] functions wiring db/repo/graph to the frontend
      test_support.rs    # #[cfg(test)] fixture repo builders shared by repo.rs/graph.rs tests
  src/
    main.tsx
    App.tsx
    lib/
      tauri.ts            # typed wrappers around @tauri-apps/api invoke calls
      fuzzyMatch.ts        # client-side fuzzy scoring for branch/tag/name search
    store/
      workspaceStore.ts    # Zustand: repos, activeRepoId, branches, tags, commits
      searchStore.ts        # Zustand: query string, derived filtered results
    components/
      Sidebar.tsx
      RepoList.tsx
      BranchTree.tsx
      SearchBar.tsx
      CommitGraph.tsx
      CommitGraphRow.tsx
    __tests__/
      fuzzyMatch.test.ts
      BranchTree.test.tsx
      CommitGraph.test.tsx
  e2e/
    mockTauri.ts          # mocks window.__TAURI_INTERNALS__.invoke for browser-based e2e
    workspace.spec.ts
  playwright.config.ts
```

Each backend module has one responsibility: `db.rs` never touches git2, `repo.rs`/`graph.rs` never touch SQLite, `commands.rs` is the only place that wires them together for the frontend. Each frontend store owns one slice of state; components read from stores, they don't fetch directly.

---

### Task 1: Project scaffold

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/error.rs`
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`

**Interfaces:**
- Produces: a running Tauri dev app titled "Bettertree" that later tasks add commands and UI to. `AppError` enum (in `error.rs`) that all later Rust modules use as their `Result` error type and that Tauri serializes to the frontend as a string.

- [ ] **Step 1: Create the Rust backend crate files**

`src-tauri/Cargo.toml`:

```toml
[package]
name = "bettertree"
version = "0.1.0"
edition = "2021"

[lib]
name = "bettertree_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
rusqlite = { version = "0.31", features = ["bundled"] }
git2 = "0.19"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "1"
dirs = "5"

[dev-dependencies]
tempfile = "3"
```

`src-tauri/tauri.conf.json`:

```json
{
  "productName": "Bettertree",
  "version": "0.1.0",
  "identifier": "ai.cemento.bettertree",
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "devUrl": "http://localhost:5173",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "Bettertree",
        "width": 1200,
        "height": 800
      }
    ]
  }
}
```

`src-tauri/src/error.rs`:

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

`src-tauri/src/lib.rs`:

```rust
mod error;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running Bettertree");
}
```

`src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    bettertree_lib::run();
}
```

- [ ] **Step 2: Create the frontend scaffold**

`package.json`:

```json
{
  "name": "bettertree",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-dialog": "^2",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "zustand": "^4.5.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2",
    "@testing-library/react": "^16",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4",
    "jsdom": "^25",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

`vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
  },
});
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Bettertree</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/main.tsx`:

```typescript
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

`src/App.tsx`:

```typescript
export default function App() {
  return (
    <div className="h-screen w-screen flex items-center justify-center text-gray-700">
      <p>Bettertree</p>
    </div>
  );
}
```

- [ ] **Step 3: Install dependencies and verify the app runs**

Run: `npm install`
Expected: installs without error.

Run: `npm run tauri dev`
Expected: a window titled "Bettertree" opens showing centered text "Bettertree". Stop the dev server (Ctrl+C) once confirmed.

- [ ] **Step 4: Mark task complete**

No commit (project has no git — see Global Constraints). Update the todo list / progress ledger to mark Task 1 done.

---

### Task 2: Workspace registry (SQLite via rusqlite)

**Files:**
- Create: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/lib.rs` (register `db` module and open the connection as managed state)

**Interfaces:**
- Consumes: `AppError` from `error.rs` (Task 1).
- Produces: `RepoEntry { id: i64, path: String, name: String, pinned: bool }`, `init_db(conn: &Connection) -> Result<(), AppError>`, `list_repos(conn: &Connection) -> Result<Vec<RepoEntry>, AppError>`, `add_repo(conn: &Connection, path: &str, name: &str) -> Result<RepoEntry, AppError>`, `remove_repo(conn: &Connection, id: i64) -> Result<(), AppError>`. Task 3's Tauri commands call these directly.

- [ ] **Step 1: Write the failing tests**

`src-tauri/src/db.rs` (tests at the bottom of the same file — see Step 3 for the non-test code):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        conn
    }

    #[test]
    fn add_repo_then_list_returns_it() {
        let conn = setup();
        let added = add_repo(&conn, "/tmp/repo-a", "repo-a").unwrap();
        assert_eq!(added.path, "/tmp/repo-a");
        assert!(!added.pinned);

        let repos = list_repos(&conn).unwrap();
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].name, "repo-a");
    }

    #[test]
    fn remove_repo_deletes_it() {
        let conn = setup();
        let added = add_repo(&conn, "/tmp/repo-b", "repo-b").unwrap();
        remove_repo(&conn, added.id).unwrap();
        let repos = list_repos(&conn).unwrap();
        assert!(repos.is_empty());
    }

    #[test]
    fn adding_duplicate_path_fails() {
        let conn = setup();
        add_repo(&conn, "/tmp/repo-c", "repo-c").unwrap();
        let result = add_repo(&conn, "/tmp/repo-c", "repo-c-again");
        assert!(result.is_err());
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml db::tests`
Expected: FAIL to compile — `init_db`, `list_repos`, `add_repo`, `remove_repo` not defined.

- [ ] **Step 3: Write the implementation**

Prepend this to `src-tauri/src/db.rs` (above the `#[cfg(test)]` block from Step 1):

```rust
use rusqlite::{params, Connection};
use serde::Serialize;
use crate::error::AppError;

#[derive(Debug, Clone, Serialize)]
pub struct RepoEntry {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub pinned: bool,
}

pub fn init_db(conn: &Connection) -> Result<(), AppError> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS repos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            pinned INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )?;
    Ok(())
}

pub fn list_repos(conn: &Connection) -> Result<Vec<RepoEntry>, AppError> {
    let mut stmt = conn.prepare("SELECT id, path, name, pinned FROM repos ORDER BY pinned DESC, name ASC")?;
    let rows = stmt.query_map([], |row| {
        Ok(RepoEntry {
            id: row.get(0)?,
            path: row.get(1)?,
            name: row.get(2)?,
            pinned: row.get::<_, i64>(3)? != 0,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn add_repo(conn: &Connection, path: &str, name: &str) -> Result<RepoEntry, AppError> {
    conn.execute(
        "INSERT INTO repos (path, name, pinned) VALUES (?1, ?2, 0)",
        params![path, name],
    )?;
    let id = conn.last_insert_rowid();
    Ok(RepoEntry { id, path: path.to_string(), name: name.to_string(), pinned: false })
}

pub fn remove_repo(conn: &Connection, id: i64) -> Result<(), AppError> {
    conn.execute("DELETE FROM repos WHERE id = ?1", params![id])?;
    Ok(())
}
```

Add the module and managed SQLite state to `src-tauri/src/lib.rs`:

```rust
mod error;
mod db;

use rusqlite::Connection;
use std::sync::Mutex;

pub struct AppState {
    pub db: Mutex<Connection>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = Connection::open(
        dirs::data_dir().unwrap().join("bettertree").join("workspace.db"),
    )
    .expect("failed to open workspace db");
    std::fs::create_dir_all(dirs::data_dir().unwrap().join("bettertree")).ok();
    db::init_db(&conn).expect("failed to init db schema");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState { db: Mutex::new(conn) })
        .run(tauri::generate_context!())
        .expect("error while running Bettertree");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml db::tests`
Expected: `test result: ok. 3 passed; 0 failed`

- [ ] **Step 5: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 3: Repo reader (branches and tags via git2)

**Files:**
- Create: `src-tauri/src/repo.rs`
- Create: `src-tauri/src/test_support.rs`
- Modify: `src-tauri/src/lib.rs` (register `repo` and `test_support` modules)

**Interfaces:**
- Consumes: `AppError` from `error.rs`.
- Produces: `BranchInfo { name: String, is_remote: bool, is_head: bool, target_oid: String }`, `TagInfo { name: String, target_oid: String }`, `list_branches(repo_path: &str) -> Result<Vec<BranchInfo>, AppError>`, `list_tags(repo_path: &str) -> Result<Vec<TagInfo>, AppError>`. Task 4 (graph engine) and Task 6 (Tauri commands) call these. `test_support::init_repo_with_commits()` is reused by Task 4's tests.

- [ ] **Step 1: Write the fixture helper and failing tests**

`src-tauri/src/test_support.rs`:

```rust
#![cfg(test)]

use git2::{Repository, RepositoryInitOptions, Signature};
use std::path::Path;
use tempfile::TempDir;

/// Builds a repo with two commits on "main" and a "feature" branch
/// pointing at the first commit.
pub fn init_repo_with_commits() -> (TempDir, Repository) {
    let dir = TempDir::new().unwrap();
    let mut opts = RepositoryInitOptions::new();
    opts.initial_head("main");
    let repo = Repository::init_opts(dir.path(), &opts).unwrap();
    let sig = Signature::now("Test User", "test@example.com").unwrap();

    std::fs::write(dir.path().join("a.txt"), "one").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("a.txt")).unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    let commit1 = repo
        .commit(Some("HEAD"), &sig, &sig, "first commit", &tree, &[])
        .unwrap();

    std::fs::write(dir.path().join("a.txt"), "two").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("a.txt")).unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    let parent = repo.find_commit(commit1).unwrap();
    repo.commit(Some("HEAD"), &sig, &sig, "second commit", &tree, &[&parent])
        .unwrap();

    repo.branch("feature", &repo.find_commit(commit1).unwrap(), false)
        .unwrap();

    (dir, repo)
}

/// Builds on init_repo_with_commits by adding a commit on "feature" and
/// merging it into "main", producing a commit with two parents.
pub fn init_repo_with_commits_and_merge() -> (TempDir, Repository) {
    let (dir, repo) = init_repo_with_commits();
    let sig = Signature::now("Test User", "test@example.com").unwrap();

    let feature_branch = repo.find_branch("feature", git2::BranchType::Local).unwrap();
    let feature_commit = feature_branch.get().peel_to_commit().unwrap();

    std::fs::write(dir.path().join("b.txt"), "feature work").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("b.txt")).unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    let feature_tip_oid = repo
        .commit(
            Some("refs/heads/feature"),
            &sig,
            &sig,
            "feature commit",
            &tree,
            &[&feature_commit],
        )
        .unwrap();
    let feature_tip = repo.find_commit(feature_tip_oid).unwrap();

    let main_tip = repo.head().unwrap().peel_to_commit().unwrap();
    let mut index = repo.index().unwrap();
    index.read(true).unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        "merge feature",
        &tree,
        &[&main_tip, &feature_tip],
    )
    .unwrap();

    (dir, repo)
}
```

`src-tauri/src/repo.rs` (tests only for now):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::init_repo_with_commits;

    #[test]
    fn lists_local_and_remote_branches_with_head_flag() {
        let (dir, _repo) = init_repo_with_commits();
        let branches = list_branches(dir.path().to_str().unwrap()).unwrap();
        let names: Vec<&str> = branches.iter().map(|b| b.name.as_str()).collect();
        assert!(names.contains(&"main"));
        assert!(names.contains(&"feature"));

        let head_branch = branches.iter().find(|b| b.is_head).unwrap();
        assert_eq!(head_branch.name, "main");
        assert!(!head_branch.is_remote);
    }

    #[test]
    fn lists_tags() {
        let (dir, repo) = init_repo_with_commits();
        let head_oid = repo.head().unwrap().target().unwrap();
        repo.tag_lightweight("v1.0", &repo.find_object(head_oid, None).unwrap(), false)
            .unwrap();

        let tags = list_tags(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].name, "v1.0");
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml repo::tests`
Expected: FAIL to compile — `list_branches`, `list_tags` not defined.

- [ ] **Step 3: Write the implementation**

Prepend this to `src-tauri/src/repo.rs` (above the `#[cfg(test)]` block):

```rust
use crate::error::AppError;
use git2::{BranchType, Repository};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_remote: bool,
    pub is_head: bool,
    pub target_oid: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagInfo {
    pub name: String,
    pub target_oid: String,
}

pub fn list_branches(repo_path: &str) -> Result<Vec<BranchInfo>, AppError> {
    let repo = Repository::open(repo_path)?;
    let head_name = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));

    let mut out = Vec::new();
    for branch_result in repo.branches(None)? {
        let (branch, branch_type) = branch_result?;
        let name = branch.name()?.unwrap_or("").to_string();
        let is_remote = branch_type == BranchType::Remote;
        let target_oid = branch
            .get()
            .target()
            .map(|o| o.to_string())
            .unwrap_or_default();
        let is_head = !is_remote && head_name.as_deref() == Some(name.as_str());
        out.push(BranchInfo { name, is_remote, is_head, target_oid });
    }
    Ok(out)
}

pub fn list_tags(repo_path: &str) -> Result<Vec<TagInfo>, AppError> {
    let repo = Repository::open(repo_path)?;
    let mut out = Vec::new();
    repo.tag_foreach(|oid, name_bytes| {
        let name = String::from_utf8_lossy(name_bytes)
            .trim_start_matches("refs/tags/")
            .to_string();
        out.push(TagInfo { name, target_oid: oid.to_string() });
        true
    })?;
    Ok(out)
}
```

Add the modules to `src-tauri/src/lib.rs`:

```rust
mod error;
mod db;
mod repo;
mod test_support;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml repo::tests`
Expected: `test result: ok. 2 passed; 0 failed`

- [ ] **Step 5: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 4: Commit graph engine (lane assignment)

**Files:**
- Create: `src-tauri/src/graph.rs`

**Interfaces:**
- Consumes: `AppError` from `error.rs`, `test_support::init_repo_with_commits` / `init_repo_with_commits_and_merge` from Task 3 (tests only).
- Produces: `GraphEdge { parent_oid: String, parent_lane: usize }`, `GraphCommit { oid: String, summary: String, author: String, timestamp: i64, lane: usize, edges: Vec<GraphEdge> }`, `get_commit_graph(repo_path: &str, limit: usize) -> Result<Vec<GraphCommit>, AppError>`. Task 6's Tauri command and Task 7's frontend renderer consume `GraphCommit` — field names and types must match exactly.

- [ ] **Step 1: Write the failing tests**

`src-tauri/src/graph.rs` (tests only for now):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{init_repo_with_commits, init_repo_with_commits_and_merge};

    #[test]
    fn linear_history_stays_in_single_lane() {
        let (dir, _repo) = init_repo_with_commits();
        let graph = get_commit_graph(dir.path().to_str().unwrap(), 10).unwrap();
        assert_eq!(graph.len(), 2);
        assert!(graph.iter().all(|c| c.lane == 0));
        assert_eq!(graph[0].summary, "second commit");
        assert_eq!(graph[1].summary, "first commit");
    }

    #[test]
    fn merge_commit_has_two_parent_edges() {
        let (dir, _repo) = init_repo_with_commits_and_merge();
        let graph = get_commit_graph(dir.path().to_str().unwrap(), 10).unwrap();
        let merge_commit = graph
            .iter()
            .find(|c| c.summary == "merge feature")
            .expect("merge commit present");
        assert_eq!(merge_commit.edges.len(), 2);
    }

    #[test]
    fn respects_limit() {
        let (dir, _repo) = init_repo_with_commits();
        let graph = get_commit_graph(dir.path().to_str().unwrap(), 1).unwrap();
        assert_eq!(graph.len(), 1);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml graph::tests`
Expected: FAIL to compile — `get_commit_graph` not defined.

- [ ] **Step 3: Write the implementation**

Prepend this to `src-tauri/src/graph.rs` (above the `#[cfg(test)]` block):

```rust
use crate::error::AppError;
use git2::{Repository, Sort};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct GraphEdge {
    pub parent_oid: String,
    pub parent_lane: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphCommit {
    pub oid: String,
    pub summary: String,
    pub author: String,
    pub timestamp: i64,
    pub lane: usize,
    pub edges: Vec<GraphEdge>,
}

pub fn get_commit_graph(repo_path: &str, limit: usize) -> Result<Vec<GraphCommit>, AppError> {
    let repo = Repository::open(repo_path)?;
    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;

    // lanes[i] holds the oid this lane is waiting to see next, or None if free.
    let mut lanes: Vec<Option<String>> = Vec::new();
    let mut out = Vec::new();

    for oid_result in revwalk.take(limit) {
        let oid = oid_result?;
        let commit = repo.find_commit(oid)?;
        let oid_str = oid.to_string();

        let lane = match lanes.iter().position(|slot| slot.as_deref() == Some(oid_str.as_str())) {
            Some(idx) => idx,
            None => match lanes.iter().position(|slot| slot.is_none()) {
                Some(idx) => idx,
                None => {
                    lanes.push(None);
                    lanes.len() - 1
                }
            },
        };

        let parent_count = commit.parent_count();
        let mut edges = Vec::new();

        if parent_count == 0 {
            lanes[lane] = None;
        } else {
            for i in 0..parent_count {
                let parent_oid = commit.parent_id(i)?.to_string();
                if i == 0 {
                    lanes[lane] = Some(parent_oid.clone());
                    edges.push(GraphEdge { parent_oid, parent_lane: lane });
                } else {
                    let parent_lane = match lanes
                        .iter()
                        .position(|slot| slot.as_deref() == Some(parent_oid.as_str()))
                    {
                        Some(idx) => idx,
                        None => match lanes.iter().position(|slot| slot.is_none()) {
                            Some(idx) => {
                                lanes[idx] = Some(parent_oid.clone());
                                idx
                            }
                            None => {
                                lanes.push(Some(parent_oid.clone()));
                                lanes.len() - 1
                            }
                        },
                    };
                    edges.push(GraphEdge { parent_oid, parent_lane });
                }
            }
        }

        let author = commit.author();
        out.push(GraphCommit {
            oid: oid_str,
            summary: commit.summary().unwrap_or("").to_string(),
            author: author.name().unwrap_or("").to_string(),
            timestamp: commit.time().seconds(),
            lane,
            edges,
        });
    }

    Ok(out)
}
```

Add the module to `src-tauri/src/lib.rs`: add `mod graph;` alongside the other `mod` lines.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml graph::tests`
Expected: `test result: ok. 3 passed; 0 failed`

- [ ] **Step 5: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 5: Tauri commands wiring backend to frontend

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs` (register commands in `invoke_handler`, add `mod commands;`)

**Interfaces:**
- Consumes: `AppState` (Task 2), `db::{list_repos, add_repo, remove_repo}` (Task 2), `repo::{list_branches, list_tags}` (Task 3), `graph::get_commit_graph` (Task 4).
- Produces: Tauri commands `list_repos() -> Result<Vec<RepoEntry>, AppError>`, `add_repo(path: String) -> Result<RepoEntry, AppError>`, `remove_repo(id: i64) -> Result<(), AppError>`, `get_branches(repo_path: String) -> Result<Vec<BranchInfo>, AppError>`, `get_tags(repo_path: String) -> Result<Vec<TagInfo>, AppError>`, `get_commit_graph(repo_path: String, limit: usize) -> Result<Vec<GraphCommit>, AppError>`. Task 6 (`src/lib/tauri.ts`) calls these five commands by these exact names.

This task has no new logic to unit-test (it's thin wiring over already-tested functions); its test is the frontend integration test in Task 6, and the manual verification below.

- [ ] **Step 1: Write the commands**

`src-tauri/src/commands.rs`:

```rust
use crate::db::{self, RepoEntry};
use crate::error::AppError;
use crate::graph::{self, GraphCommit};
use crate::repo::{self, BranchInfo, TagInfo};
use crate::AppState;
use std::path::Path;
use tauri::State;

#[tauri::command]
pub fn list_repos(state: State<AppState>) -> Result<Vec<RepoEntry>, AppError> {
    let conn = state.db.lock().unwrap();
    db::list_repos(&conn)
}

#[tauri::command]
pub fn add_repo(state: State<AppState>, path: String) -> Result<RepoEntry, AppError> {
    let name = Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    let conn = state.db.lock().unwrap();
    db::add_repo(&conn, &path, &name)
}

#[tauri::command]
pub fn remove_repo(state: State<AppState>, id: i64) -> Result<(), AppError> {
    let conn = state.db.lock().unwrap();
    db::remove_repo(&conn, id)
}

#[tauri::command]
pub fn get_branches(repo_path: String) -> Result<Vec<BranchInfo>, AppError> {
    repo::list_branches(&repo_path)
}

#[tauri::command]
pub fn get_tags(repo_path: String) -> Result<Vec<TagInfo>, AppError> {
    repo::list_tags(&repo_path)
}

#[tauri::command]
pub fn get_commit_graph(repo_path: String, limit: usize) -> Result<Vec<GraphCommit>, AppError> {
    graph::get_commit_graph(&repo_path, limit)
}
```

Update `src-tauri/src/lib.rs` to register the module and the commands:

```rust
mod error;
mod db;
mod repo;
mod graph;
mod commands;
mod test_support;

use rusqlite::Connection;
use std::sync::Mutex;

pub struct AppState {
    pub db: Mutex<Connection>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let data_dir = dirs::data_dir().unwrap().join("bettertree");
    std::fs::create_dir_all(&data_dir).ok();
    let conn = Connection::open(data_dir.join("workspace.db")).expect("failed to open workspace db");
    db::init_db(&conn).expect("failed to init db schema");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState { db: Mutex::new(conn) })
        .invoke_handler(tauri::generate_handler![
            commands::list_repos,
            commands::add_repo,
            commands::remove_repo,
            commands::get_branches,
            commands::get_tags,
            commands::get_commit_graph,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Bettertree");
}
```

- [ ] **Step 2: Verify the backend still builds and all existing tests pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests from Tasks 2–4 still pass (`test result: ok.` for each module), plus a successful compile of `commands.rs`.

- [ ] **Step 3: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 6: Workspace store and repo list UI

**Files:**
- Create: `src/lib/tauri.ts`
- Create: `src/store/workspaceStore.ts`
- Create: `src/components/RepoList.tsx`
- Create: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx` (render `Sidebar`)

**Interfaces:**
- Consumes: Tauri commands from Task 5 (`list_repos`, `add_repo`, `remove_repo`, `get_branches`, `get_tags`, `get_commit_graph`).
- Produces: `useWorkspaceStore()` Zustand hook exposing `{ repos, activeRepoId, branches, tags, commits, loadRepos(), addRepo(path), setActiveRepo(id) }`. Task 7 (`BranchTree`) and Task 8 (`SearchBar`, `CommitGraph`) read `branches`, `tags`, `commits` from this store.

- [ ] **Step 1: Write the failing test**

`src/__tests__/workspaceStore.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/tauri", () => ({
  invokeListRepos: vi.fn(),
  invokeAddRepo: vi.fn(),
  invokeGetBranches: vi.fn(),
  invokeGetTags: vi.fn(),
  invokeGetCommitGraph: vi.fn(),
}));

import { useWorkspaceStore } from "../store/workspaceStore";
import * as tauriLib from "../lib/tauri";

describe("workspaceStore", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      repos: [],
      activeRepoId: null,
      branches: [],
      tags: [],
      commits: [],
    });
  });

  it("loadRepos populates repos from the backend", async () => {
    (tauriLib.invokeListRepos as any).mockResolvedValue([
      { id: 1, path: "/tmp/a", name: "a", pinned: false },
    ]);
    await useWorkspaceStore.getState().loadRepos();
    expect(useWorkspaceStore.getState().repos).toHaveLength(1);
    expect(useWorkspaceStore.getState().repos[0].name).toBe("a");
  });

  it("setActiveRepo loads branches, tags, and commits for that repo", async () => {
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
    });
    (tauriLib.invokeGetBranches as any).mockResolvedValue([
      { name: "main", isRemote: false, isHead: true, targetOid: "abc" },
    ]);
    (tauriLib.invokeGetTags as any).mockResolvedValue([]);
    (tauriLib.invokeGetCommitGraph as any).mockResolvedValue([]);

    await useWorkspaceStore.getState().setActiveRepo(1);

    expect(useWorkspaceStore.getState().activeRepoId).toBe(1);
    expect(useWorkspaceStore.getState().branches).toHaveLength(1);
    expect(tauriLib.invokeGetBranches).toHaveBeenCalledWith("/tmp/a");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- workspaceStore`
Expected: FAIL — `src/lib/tauri` and `src/store/workspaceStore` do not exist yet.

- [ ] **Step 3: Write the implementation**

`src/lib/tauri.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core";

export interface RepoEntry {
  id: number;
  path: string;
  name: string;
  pinned: boolean;
}

export interface BranchInfo {
  name: string;
  isRemote: boolean;
  isHead: boolean;
  targetOid: string;
}

export interface TagInfo {
  name: string;
  targetOid: string;
}

export interface GraphEdge {
  parentOid: string;
  parentLane: number;
}

export interface GraphCommit {
  oid: string;
  summary: string;
  author: string;
  timestamp: number;
  lane: number;
  edges: GraphEdge[];
}

export const invokeListRepos = () => invoke<RepoEntry[]>("list_repos");
export const invokeAddRepo = (path: string) => invoke<RepoEntry>("add_repo", { path });
export const invokeRemoveRepo = (id: number) => invoke<void>("remove_repo", { id });
export const invokeGetBranches = (repoPath: string) =>
  invoke<BranchInfo[]>("get_branches", { repoPath });
export const invokeGetTags = (repoPath: string) => invoke<TagInfo[]>("get_tags", { repoPath });
export const invokeGetCommitGraph = (repoPath: string, limit: number) =>
  invoke<GraphCommit[]>("get_commit_graph", { repoPath, limit });
```

`src/store/workspaceStore.ts`:

```typescript
import { create } from "zustand";
import {
  invokeListRepos,
  invokeAddRepo,
  invokeGetBranches,
  invokeGetTags,
  invokeGetCommitGraph,
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
  },
}));
```

`src/components/RepoList.tsx`:

```typescript
import { useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useWorkspaceStore } from "../store/workspaceStore";

export default function RepoList() {
  const { repos, activeRepoId, loadRepos, addRepo, setActiveRepo } = useWorkspaceStore();

  useEffect(() => {
    loadRepos();
  }, [loadRepos]);

  const handleAdd = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      await addRepo(selected);
    }
  };

  return (
    <div className="flex flex-col gap-1 p-2">
      <button className="text-sm text-left px-2 py-1 rounded hover:bg-gray-200" onClick={handleAdd}>
        + Add repo
      </button>
      {repos.map((r) => (
        <button
          key={r.id}
          className={`text-sm text-left px-2 py-1 rounded ${
            r.id === activeRepoId ? "bg-blue-100 font-medium" : "hover:bg-gray-100"
          }`}
          onClick={() => setActiveRepo(r.id)}
        >
          {r.name}
        </button>
      ))}
    </div>
  );
}
```

`src/components/Sidebar.tsx`:

```typescript
import RepoList from "./RepoList";

export default function Sidebar() {
  return (
    <div className="w-64 border-r border-gray-200 h-full overflow-y-auto">
      <RepoList />
    </div>
  );
}
```

Update `src/App.tsx`:

```typescript
import Sidebar from "./components/Sidebar";

export default function App() {
  return (
    <div className="h-screen w-screen flex">
      <Sidebar />
      <div className="flex-1 flex items-center justify-center text-gray-400">
        Select or add a repo
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- workspaceStore`
Expected: both tests pass.

- [ ] **Step 5: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 7: Branch/tag tree and commit graph rendering

**Files:**
- Create: `src/components/BranchTree.tsx`
- Create: `src/components/CommitGraph.tsx`
- Create: `src/components/CommitGraphRow.tsx`
- Modify: `src/components/Sidebar.tsx` (render `BranchTree` below `RepoList`)
- Modify: `src/App.tsx` (render `CommitGraph` in the main area)

**Interfaces:**
- Consumes: `branches`, `tags`, `commits` from `useWorkspaceStore()` (Task 6).
- Produces: `BranchTree` (no props, reads store), `CommitGraph` (no props, reads store), `CommitGraphRow({ commit }: { commit: GraphCommit })`. Task 8's search bar filters what `BranchTree`/`CommitGraph` display via the search store, so both must read row visibility from `useSearchStore` (created in Task 8) — for this task, they render all rows unconditionally.

- [ ] **Step 1: Write the failing tests**

`src/__tests__/BranchTree.test.tsx`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import BranchTree from "../components/BranchTree";

describe("BranchTree", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      branches: [
        { name: "main", isRemote: false, isHead: true, targetOid: "a" },
        { name: "origin/main", isRemote: true, isHead: false, targetOid: "a" },
      ],
      tags: [{ name: "v1.0", targetOid: "a" }],
    });
  });

  it("renders local branches, remote branches, and tags in separate groups", () => {
    render(<BranchTree />);
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("origin/main")).toBeInTheDocument();
    expect(screen.getByText("v1.0")).toBeInTheDocument();
  });

  it("marks the HEAD branch", () => {
    render(<BranchTree />);
    expect(screen.getByText("main").closest("[data-head]")).toHaveAttribute("data-head", "true");
  });
});
```

`src/__tests__/CommitGraph.test.tsx`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import CommitGraph from "../components/CommitGraph";

describe("CommitGraph", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      commits: [
        { oid: "c2", summary: "second commit", author: "Test User", timestamp: 200, lane: 0, edges: [{ parentOid: "c1", parentLane: 0 }] },
        { oid: "c1", summary: "first commit", author: "Test User", timestamp: 100, lane: 0, edges: [] },
      ],
    });
  });

  it("renders one row per commit with its summary and lane", () => {
    render(<CommitGraph />);
    const rows = screen.getAllByTestId("commit-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("second commit")).toBeInTheDocument();
    expect(screen.getByText("first commit")).toBeInTheDocument();
  });

  it("positions each row's dot according to its lane", () => {
    render(<CommitGraph />);
    const dots = screen.getAllByTestId("commit-dot");
    expect(dots[0]).toHaveAttribute("cx", "12");
    expect(dots[1]).toHaveAttribute("cx", "12");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- BranchTree CommitGraph`
Expected: FAIL — `BranchTree`, `CommitGraph`, `CommitGraphRow` do not exist yet.

- [ ] **Step 3: Write the implementation**

`src/components/BranchTree.tsx`:

```typescript
import { useWorkspaceStore } from "../store/workspaceStore";

export default function BranchTree() {
  const { branches, tags } = useWorkspaceStore();
  const local = branches.filter((b) => !b.isRemote);
  const remote = branches.filter((b) => b.isRemote);

  return (
    <div className="text-sm p-2">
      <div className="text-xs uppercase text-gray-400 mt-2">Branches</div>
      {local.map((b) => (
        <div key={b.name} data-head={b.isHead} className="px-2 py-0.5">
          {b.isHead ? "* " : ""}
          {b.name}
        </div>
      ))}
      <div className="text-xs uppercase text-gray-400 mt-2">Remotes</div>
      {remote.map((b) => (
        <div key={b.name} data-head={b.isHead} className="px-2 py-0.5 text-gray-500">
          {b.name}
        </div>
      ))}
      <div className="text-xs uppercase text-gray-400 mt-2">Tags</div>
      {tags.map((t) => (
        <div key={t.name} className="px-2 py-0.5">
          {t.name}
        </div>
      ))}
    </div>
  );
}
```

`src/components/CommitGraphRow.tsx`:

```typescript
import { GraphCommit } from "../lib/tauri";

const LANE_WIDTH = 16;
const ROW_HEIGHT = 24;

export default function CommitGraphRow({ commit }: { commit: GraphCommit }) {
  const cx = 12 + commit.lane * LANE_WIDTH;
  const date = new Date(commit.timestamp * 1000).toLocaleDateString();

  return (
    <div data-testid="commit-row" className="flex items-center h-6 text-sm" style={{ height: ROW_HEIGHT }}>
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

`src/components/CommitGraph.tsx`:

```typescript
import { useWorkspaceStore } from "../store/workspaceStore";
import CommitGraphRow from "./CommitGraphRow";

export default function CommitGraph() {
  const { commits } = useWorkspaceStore();

  return (
    <div className="flex-1 overflow-y-auto">
      {commits.map((c) => (
        <CommitGraphRow key={c.oid} commit={c} />
      ))}
    </div>
  );
}
```

Update `src/components/Sidebar.tsx`:

```typescript
import RepoList from "./RepoList";
import BranchTree from "./BranchTree";

export default function Sidebar() {
  return (
    <div className="w-64 border-r border-gray-200 h-full overflow-y-auto">
      <RepoList />
      <BranchTree />
    </div>
  );
}
```

Update `src/App.tsx`:

```typescript
import Sidebar from "./components/Sidebar";
import CommitGraph from "./components/CommitGraph";

export default function App() {
  return (
    <div className="h-screen w-screen flex">
      <Sidebar />
      <CommitGraph />
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- BranchTree CommitGraph`
Expected: all four tests pass.

- [ ] **Step 5: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 8: Branch/tag/commit name search and end-to-end test

**Files:**
- Create: `src/lib/fuzzyMatch.ts`
- Create: `src/store/searchStore.ts`
- Create: `src/components/SearchBar.tsx`
- Modify: `src/components/BranchTree.tsx` (filter by search store)
- Modify: `src/components/CommitGraph.tsx` (filter by search store)
- Modify: `src/App.tsx` (render `SearchBar`)
- Modify: `vite.config.ts` (scope vitest's `include` to `src/**/*.test.{ts,tsx}` so it doesn't try to run the Playwright spec in `e2e/`)
- Modify: `package.json` (add `@playwright/test` devDependency and `e2e` script)
- Create: `playwright.config.ts`
- Create: `e2e/mockTauri.ts`
- Create: `e2e/workspace.spec.ts`

**Interfaces:**
- Consumes: `branches`, `tags`, `commits` from `useWorkspaceStore()` (Task 6/7).
- Produces: `fuzzyMatch(query: string, target: string) -> boolean` (subsequence match, case-insensitive), `useSearchStore()` exposing `{ query, setQuery(q) }`. This is the last task in Plan 1 — no later task in this plan consumes its output.

- [ ] **Step 1: Write the failing tests**

`src/__tests__/fuzzyMatch.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { fuzzyMatch } from "../lib/fuzzyMatch";

describe("fuzzyMatch", () => {
  it("matches when query characters appear in order in the target", () => {
    expect(fuzzyMatch("mn", "main")).toBe(true);
    expect(fuzzyMatch("ftr", "feature/login")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(fuzzyMatch("MAIN", "main")).toBe(true);
  });

  it("returns false when characters are out of order or missing", () => {
    expect(fuzzyMatch("nma", "main")).toBe(false);
    expect(fuzzyMatch("xyz", "main")).toBe(false);
  });

  it("empty query matches everything", () => {
    expect(fuzzyMatch("", "main")).toBe(true);
  });
});
```

Update `src/__tests__/BranchTree.test.tsx` (add this test to the existing `describe` block from Task 7):

```typescript
  it("hides branches that don't match the search query", async () => {
    const { useSearchStore } = await import("../store/searchStore");
    useSearchStore.setState({ query: "orig" });
    render(<BranchTree />);
    expect(screen.queryByText("main")).not.toBeInTheDocument();
    expect(screen.getByText("origin/main")).toBeInTheDocument();
    useSearchStore.setState({ query: "" });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- fuzzyMatch BranchTree`
Expected: FAIL — `src/lib/fuzzyMatch` and `src/store/searchStore` do not exist yet.

- [ ] **Step 3: Write the implementation**

`src/lib/fuzzyMatch.ts`:

```typescript
export function fuzzyMatch(query: string, target: string): boolean {
  if (query.length === 0) return true;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}
```

`src/store/searchStore.ts`:

```typescript
import { create } from "zustand";

interface SearchState {
  query: string;
  setQuery: (query: string) => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  query: "",
  setQuery: (query: string) => set({ query }),
}));
```

`src/components/SearchBar.tsx`:

```typescript
import { useSearchStore } from "../store/searchStore";

export default function SearchBar() {
  const { query, setQuery } = useSearchStore();
  return (
    <input
      className="w-full px-3 py-2 border-b border-gray-200 text-sm outline-none"
      placeholder="Search branches, tags, commits..."
      value={query}
      onChange={(e) => setQuery(e.target.value)}
    />
  );
}
```

Update `src/components/BranchTree.tsx`:

```typescript
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSearchStore } from "../store/searchStore";
import { fuzzyMatch } from "../lib/fuzzyMatch";

export default function BranchTree() {
  const { branches, tags } = useWorkspaceStore();
  const { query } = useSearchStore();
  const local = branches.filter((b) => !b.isRemote && fuzzyMatch(query, b.name));
  const remote = branches.filter((b) => b.isRemote && fuzzyMatch(query, b.name));
  const filteredTags = tags.filter((t) => fuzzyMatch(query, t.name));

  return (
    <div className="text-sm p-2">
      <div className="text-xs uppercase text-gray-400 mt-2">Branches</div>
      {local.map((b) => (
        <div key={b.name} data-head={b.isHead} className="px-2 py-0.5">
          {b.isHead ? "* " : ""}
          {b.name}
        </div>
      ))}
      <div className="text-xs uppercase text-gray-400 mt-2">Remotes</div>
      {remote.map((b) => (
        <div key={b.name} data-head={b.isHead} className="px-2 py-0.5 text-gray-500">
          {b.name}
        </div>
      ))}
      <div className="text-xs uppercase text-gray-400 mt-2">Tags</div>
      {filteredTags.map((t) => (
        <div key={t.name} className="px-2 py-0.5">
          {t.name}
        </div>
      ))}
    </div>
  );
}
```

Update `src/components/CommitGraph.tsx`:

```typescript
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSearchStore } from "../store/searchStore";
import { fuzzyMatch } from "../lib/fuzzyMatch";
import CommitGraphRow from "./CommitGraphRow";

export default function CommitGraph() {
  const { commits } = useWorkspaceStore();
  const { query } = useSearchStore();
  const visible = commits.filter((c) => fuzzyMatch(query, c.summary));

  return (
    <div className="flex-1 overflow-y-auto">
      {visible.map((c) => (
        <CommitGraphRow key={c.oid} commit={c} />
      ))}
    </div>
  );
}
```

Update `src/App.tsx`:

```typescript
import Sidebar from "./components/Sidebar";
import CommitGraph from "./components/CommitGraph";
import SearchBar from "./components/SearchBar";

export default function App() {
  return (
    <div className="h-screen w-screen flex flex-col">
      <SearchBar />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <CommitGraph />
      </div>
    </div>
  );
}
```

This plan's e2e test runs the real frontend in a plain browser via Playwright, with the Tauri `invoke` bridge mocked at `window.__TAURI_INTERNALS__.invoke` — the same function `@tauri-apps/api/core`'s `invoke()` calls under the hood. This avoids needing the native `tauri-driver`/WebDriver stack while still exercising the actual React components, stores, and UI flow end-to-end.

`e2e/mockTauri.ts`:

```typescript
import { Page } from "@playwright/test";

export async function installTauriMock(page: Page) {
  await page.addInitScript(() => {
    const repos: any[] = [];
    let nextId = 1;

    const branchesByPath: Record<string, any[]> = {
      "/fake/repo-a": [
        { name: "main", isRemote: false, isHead: true, targetOid: "c2" },
        { name: "origin/main", isRemote: true, isHead: false, targetOid: "c2" },
      ],
    };
    const tagsByPath: Record<string, any[]> = { "/fake/repo-a": [] };
    const commitsByPath: Record<string, any[]> = {
      "/fake/repo-a": [
        { oid: "c2", summary: "second commit", author: "Test User", timestamp: 200, lane: 0, edges: [{ parentOid: "c1", parentLane: 0 }] },
        { oid: "c1", summary: "first commit", author: "Test User", timestamp: 100, lane: 0, edges: [] },
      ],
    };

    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: any) => {
        switch (cmd) {
          case "plugin:dialog|open":
            return "/fake/repo-a";
          case "list_repos":
            return [...repos];
          case "add_repo": {
            const name = args.path.split("/").pop();
            const entry = { id: nextId++, path: args.path, name, pinned: false };
            repos.push(entry);
            return entry;
          }
          case "get_branches":
            return branchesByPath[args.repoPath] ?? [];
          case "get_tags":
            return tagsByPath[args.repoPath] ?? [];
          case "get_commit_graph":
            return commitsByPath[args.repoPath] ?? [];
          default:
            throw new Error(`unmocked Tauri command: ${cmd}`);
        }
      },
    };
  });
}
```

`playwright.config.ts`:

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: "http://localhost:5173",
  },
});
```

`e2e/workspace.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";
import { installTauriMock } from "./mockTauri";

test("add a repo, browse its branches and graph, then search", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  await page.getByRole("button", { name: "+ Add repo" }).click();
  await page.getByText("repo-a").click();

  await expect(page.getByText("Branches")).toBeVisible();
  await expect(page.getByTestId("commit-row").first()).toBeVisible();
  await expect(page.getByText("second commit")).toBeVisible();

  await page.getByPlaceholder("Search branches, tags, commits...").fill("orig");
  await expect(page.getByText("origin/main")).toBeVisible();
  await expect(page.getByText("main", { exact: true })).not.toBeVisible();
});
```

Add the Playwright dependency and script to `package.json` (edit the `devDependencies` and `scripts` blocks created in Task 1):

```json
{
  "scripts": {
    "e2e": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.47.0"
  }
}
```

- [ ] **Step 4: Install Playwright and run all tests**

Run: `npm install -D @playwright/test && npx playwright install chromium`
Expected: installs without error.

Run: `npm test`
Expected: every test file in `src/__tests__` passes, including the new `fuzzyMatch` tests and the updated `BranchTree` search test.

Run: `npm run e2e`
Expected: `workspace.spec.ts` passes — 1 passed.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all Rust tests from Tasks 2–4 still pass (no regressions).

- [ ] **Step 5: Mark task complete**

No commit (see Global Constraints). Update the progress ledger — Plan 1 is now complete.

---

## Definition of Done for Plan 1

- `npm run tauri dev` opens Bettertree, lets you add a repo via folder picker, shows its local/remote branches and tags in the sidebar, renders its commit graph with correct lanes for linear and merge history, and the search bar filters branches/tags/commits by fuzzy name match.
- `cargo test --manifest-path src-tauri/Cargo.toml` passes (Tasks 2–4's unit tests, no regressions).
- `npm test` passes (Tasks 6–8's component/unit tests, no regressions).
- `npm run e2e` passes (Task 8's Playwright flow: add repo → browse branches/graph → search).

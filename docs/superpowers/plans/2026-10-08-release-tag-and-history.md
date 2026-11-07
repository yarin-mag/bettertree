# Latest release tag button and release-notes history (P2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One click (or one palette command) opens release notes from the newest matching release tag reachable from HEAD to HEAD, and every copied note is saved to a per-repo history that can be reopened.

**Architecture:** A fourth per-repo setting (`releaseTagPattern`, a glob) feeds a Rust `latest_release_tag` command (libgit2 `tag_names` + ancestry check). History is a new SQLite table with add/list/delete commands (de-dup against the newest entry, cap 50 per repo). The existing release-notes dialog gains save-on-copy and a History view.

**Tech Stack:** Rust (git2, rusqlite, serde, Tauri v2), React 18 + TypeScript, zustand, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-08-release-tag-and-history-design.md` (builds on `2026-10-06-per-repo-settings-design.md`)

**No git:** the project is deliberately not tracked in git, so there are no commit steps; each task ends with a checkpoint that runs the suites.

## Global Constraints

- Wire format is camelCase (`releaseTagPattern`, `fromLabel`, `toLabel`, `createdAt`); Rust fields are snake_case with `#[serde(rename_all = "camelCase")]`.
- `releaseTagPattern` default is the empty string and means "any tag"; existing databases and repos with no row must keep working with it empty.
- Latest tag rule, verbatim: candidates from `tag_names(pattern)` (all tags when empty); keep only tags whose commit is HEAD or an ancestor of HEAD; date = tagger time for annotated tags, commit time for lightweight; newest wins; ties go to the lexicographically greater name; no match → `None`; unborn HEAD → `None`.
- History: the newest entry for a repo with identical `from_label`, `to_label` and `text` only gets a refreshed `created_at`; otherwise insert, then keep only the newest 50 for that repo; empty/whitespace `text` is rejected.
- History is saved only after a successful Copy / Cmd+Enter of live text. Copying a saved copy never adds an entry.
- Test commands: `cd src-tauri && cargo test`; `npm test`; `npx tsc --noEmit` (project root). The project has no remaining known unhandled-error noise; any `Errors` line in the Vitest summary is new and must be investigated.

## Review Focus

Inputs the spec implies but its tests would not obviously exercise; each is pinned by a test in the owning task:

1. Tag names containing slashes (`archive/0.95`) must match a glob like `archive/*` — Task 2.
2. A tag pointing at a tree or blob (not a commit) must be skipped, not crash the lookup — Task 2.
3. An existing database with the old 3-column `repo_settings` table and data must upgrade without losing rows — Task 1.
4. History for one repo must never appear in or be trimmed by another repo's list/cap — Task 3.
5. De-dup applies only against the *newest* entry (copy A, copy B, copy A again → three entries) — Task 3.
6. Viewing a saved copy and pressing Copy must not create a new entry, and HTML-special characters in saved text must come back unchanged — Task 6.

## File Structure

| File | Responsibility |
|---|---|
| `src-tauri/src/db.rs` (modify) | `release_tag_pattern` column + migration; `release_notes_history` table and add/list/delete |
| `src-tauri/src/release_notes.rs` (modify) | `ReleaseTag`, `latest_release_tag` |
| `src-tauri/src/commands.rs`, `lib.rs` (modify) | four new commands, registered |
| `src/lib/repoSettings.ts` (modify) | `releaseTagPattern` in type + defaults |
| `src/lib/tauri.ts` (modify) | wrappers + `ReleaseTag`, `ReleaseNoteEntry` types |
| `src/components/RepoSettingsSection.tsx` (modify) | "Release tag pattern" field |
| `src/lib/latestReleaseTag.ts` (create) | `releaseNotesSinceLatestTag()` flow |
| `src/components/BranchTree.tsx`, `CommandPalette.tsx` (modify) | button + palette entry |
| `src/store/releaseNotesHistoryStore.ts` (create) | per-repo history cache |
| `src/lib/branchActions.ts` (modify) | `copyRichWithToast` returns success |
| `src/components/ReleaseNotesDialog.tsx` (modify) | save on copy, History view |

---

### Task 1: Release tag pattern setting + column migration (Rust)

**Files:**
- Modify: `src-tauri/src/db.rs`

**Interfaces:**
- Produces: `RepoSettings.release_tag_pattern: String` (wire `releaseTagPattern`), default `""`; `init_db` upgrades an old `repo_settings` table in place.

- [ ] **Step 1: Write the failing tests**

Append inside `mod tests` of `src-tauri/src/db.rs`:

```rust
    #[test]
    fn release_tag_pattern_defaults_empty_and_round_trips() {
        let conn = setup();
        assert_eq!(get_repo_settings(&conn, "/r").unwrap().release_tag_pattern, "");

        let mut s = custom();
        s.release_tag_pattern = "  beta-ota-v-mobile-*  ".into();
        let stored = set_repo_settings(&conn, "/r", &s).unwrap();
        assert_eq!(stored.release_tag_pattern, "beta-ota-v-mobile-*");
        assert_eq!(get_repo_settings(&conn, "/r").unwrap().release_tag_pattern, "beta-ota-v-mobile-*");
    }

    #[test]
    fn init_db_upgrades_an_old_three_column_settings_table_keeping_its_rows() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE repo_settings (
                path TEXT PRIMARY KEY,
                ticket_pattern TEXT NOT NULL,
                jira_base_url TEXT NOT NULL,
                worktree_dir TEXT NOT NULL
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO repo_settings VALUES ('/old', 'ABC-\\d+', 'https://j.example.com/', '/wt')",
            [],
        )
        .unwrap();

        init_db(&conn).unwrap();
        init_db(&conn).unwrap(); // idempotent

        let s = get_repo_settings(&conn, "/old").unwrap();
        assert_eq!(s.ticket_pattern, r"ABC-\d+");
        assert_eq!(s.jira_base_url, "https://j.example.com/");
        assert_eq!(s.worktree_dir, "/wt");
        assert_eq!(s.release_tag_pattern, "");
    }
```

Also update the two struct literals that already exist in this test module so the file compiles once the field exists: in `custom()` add `release_tag_pattern: String::new(),` and in `repo_settings_allow_empty_pattern_and_url_to_disable_linking` add `release_tag_pattern: String::new(),` to the `RepoSettings { ... }` literal.

- [ ] **Step 2: Add the field with stub behavior so the tests compile and fail**

In `RepoSettings` add `pub release_tag_pattern: String,` after `worktree_dir`; in `Default` add `release_tag_pattern: String::new(),`; in `normalize_repo_settings`'s returned struct add `release_tag_pattern: s.release_tag_pattern.clone(),`; in `get_repo_settings`'s row mapper add `release_tag_pattern: String::new(),`.

Run: `cd src-tauri && cargo test release_tag_pattern init_db_upgrades`
Expected: both new tests FAIL (round trip returns empty; upgrade test may pass the column assertions but fails nothing yet — confirm at least the round-trip test fails).

- [ ] **Step 3: Implement**

In `init_db`, change the `repo_settings` CREATE TABLE to include `release_tag_pattern TEXT NOT NULL DEFAULT ''` as the last column, and add right after that statement:

```rust
    // Databases created before this column existed get it added in place.
    let has_column: bool = conn
        .prepare("PRAGMA table_info(repo_settings)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .any(|name| name.map(|n| n == "release_tag_pattern").unwrap_or(false));
    if !has_column {
        conn.execute(
            "ALTER TABLE repo_settings ADD COLUMN release_tag_pattern TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }
```

Replace the SELECT in `get_repo_settings` with `"SELECT ticket_pattern, jira_base_url, worktree_dir, release_tag_pattern FROM repo_settings WHERE path = ?1"` and the mapper's last field with `release_tag_pattern: row.get(3)?,`.

In `normalize_repo_settings` set `release_tag_pattern: s.release_tag_pattern.trim().to_string(),`.

Replace the INSERT in `set_repo_settings` with:

```rust
        "INSERT OR REPLACE INTO repo_settings (path, ticket_pattern, jira_base_url, worktree_dir, release_tag_pattern)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            path,
            normalized.ticket_pattern,
            normalized.jira_base_url,
            normalized.worktree_dir,
            normalized.release_tag_pattern
        ],
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd src-tauri && cargo test`
Expected: all pass, including the two new ones and every earlier `repo_settings_*` test.

- [ ] **Step 5: Checkpoint**

Run: `cd src-tauri && cargo test 2>&1 | grep -E "test result|FAILED"`
Expected: `0 failed`.

---

### Task 2: `latest_release_tag` (Rust)

**Files:**
- Modify: `src-tauri/src/release_notes.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `release_notes::ReleaseTag { name: String, oid: String, timestamp: i64 }` (camelCase on the wire); `release_notes::latest_release_tag(repo_path: &str, pattern: &str) -> Result<Option<ReleaseTag>, AppError>`; Tauri command `latest_release_tag(repo_path, pattern)`.

- [ ] **Step 1: Add a stub so tests compile**

At the top of `src-tauri/src/release_notes.rs` (after the existing `use` lines) add:

```rust
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseTag {
    pub name: String,
    pub oid: String,
    pub timestamp: i64,
}

/// Newest tag matching the glob `pattern` (all tags when empty) that is HEAD or
/// an ancestor of HEAD. Annotated tags are dated by tagger, lightweight tags
/// by their commit; ties go to the greater name.
pub fn latest_release_tag(_repo_path: &str, _pattern: &str) -> Result<Option<ReleaseTag>, AppError> {
    Ok(None)
}
```

- [ ] **Step 2: Write the failing tests**

Append inside `mod tests` of `release_notes.rs` (it already imports `init_repo_with_commits`, `Repository`):

```rust
    fn sig_at(secs: i64) -> git2::Signature<'static> {
        git2::Signature::new("T", "t@example.com", &git2::Time::new(secs, 0)).unwrap()
    }

    fn annotated(repo: &Repository, name: &str, target: git2::Oid, secs: i64) {
        let obj = repo.find_object(target, None).unwrap();
        repo.tag(name, &obj, &sig_at(secs), "release", false).unwrap();
    }

    fn lightweight(repo: &Repository, name: &str, target: git2::Oid) {
        let obj = repo.find_object(target, None).unwrap();
        repo.tag_lightweight(name, &obj, false).unwrap();
    }

    fn commit_on_head_at(repo: &Repository, dir: &std::path::Path, file: &str, msg: &str, secs: i64) -> git2::Oid {
        std::fs::write(dir.join(file), msg).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(file)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        let sig = sig_at(secs);
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &[&parent]).unwrap()
    }

    fn first_commit(repo: &Repository) -> git2::Oid {
        repo.head().unwrap().peel_to_commit().unwrap().parent(0).unwrap().id()
    }

    fn name_of(t: Option<ReleaseTag>) -> Option<String> {
        t.map(|t| t.name)
    }

    #[test]
    fn picks_the_newest_matching_tag_by_tagger_date() {
        let (dir, repo) = init_repo_with_commits();
        let first = first_commit(&repo);
        annotated(&repo, "rel-1", first, 1000);
        annotated(&repo, "rel-2", first, 2000);
        let got = latest_release_tag(dir.path().to_str().unwrap(), "").unwrap().unwrap();
        assert_eq!(got.name, "rel-2");
        assert_eq!(got.oid, first.to_string());
        assert_eq!(got.timestamp, 2000);
    }

    #[test]
    fn the_pattern_filters_and_empty_means_any() {
        let (dir, repo) = init_repo_with_commits();
        let first = first_commit(&repo);
        annotated(&repo, "beta-1", first, 3000);
        annotated(&repo, "rel-1", first, 2000);
        let path = dir.path().to_str().unwrap();
        assert_eq!(name_of(latest_release_tag(path, "rel-*").unwrap()), Some("rel-1".into()));
        assert_eq!(name_of(latest_release_tag(path, "").unwrap()), Some("beta-1".into()));
        assert_eq!(name_of(latest_release_tag(path, "  ").unwrap()), Some("beta-1".into()));
    }

    #[test]
    fn matches_tag_names_that_contain_slashes() {
        let (dir, repo) = init_repo_with_commits();
        annotated(&repo, "archive/0.95", first_commit(&repo), 1000);
        annotated(&repo, "other", first_commit(&repo), 2000);
        let path = dir.path().to_str().unwrap();
        assert_eq!(name_of(latest_release_tag(path, "archive/*").unwrap()), Some("archive/0.95".into()));
    }

    #[test]
    fn ignores_tags_on_commits_that_are_not_in_heads_history() {
        let (dir, repo) = init_repo_with_commits();
        let first = repo.find_commit(first_commit(&repo)).unwrap();
        // a commit on no branch, not an ancestor of HEAD
        let tree = first.tree().unwrap();
        let stray = repo
            .commit(None, &sig_at(9999), &sig_at(9999), "stray", &tree, &[&first])
            .unwrap();
        annotated(&repo, "stray-tag", stray, 9999);
        annotated(&repo, "real", first.id(), 1000);
        let path = dir.path().to_str().unwrap();
        assert_eq!(name_of(latest_release_tag(path, "").unwrap()), Some("real".into()));
    }

    #[test]
    fn a_tag_on_head_itself_counts() {
        let (dir, repo) = init_repo_with_commits();
        let head = repo.head().unwrap().target().unwrap();
        annotated(&repo, "at-head", head, 1000);
        let got = latest_release_tag(dir.path().to_str().unwrap(), "").unwrap().unwrap();
        assert_eq!((got.name.as_str(), got.oid), ("at-head", head.to_string()));
    }

    #[test]
    fn lightweight_tags_are_dated_by_their_commit() {
        let (dir, repo) = init_repo_with_commits();
        let a = commit_on_head_at(&repo, dir.path(), "a.txt", "a", 100);
        let b = commit_on_head_at(&repo, dir.path(), "b.txt", "b", 200);
        lightweight(&repo, "lw-a", a);
        lightweight(&repo, "lw-b", b);
        let got = latest_release_tag(dir.path().to_str().unwrap(), "lw-*").unwrap().unwrap();
        assert_eq!((got.name.as_str(), got.timestamp), ("lw-b", 200));
    }

    #[test]
    fn equal_dates_go_to_the_greater_name() {
        let (dir, repo) = init_repo_with_commits();
        let first = first_commit(&repo);
        annotated(&repo, "v1", first, 1000);
        annotated(&repo, "v2", first, 1000);
        assert_eq!(name_of(latest_release_tag(dir.path().to_str().unwrap(), "").unwrap()), Some("v2".into()));
    }

    #[test]
    fn a_tag_that_does_not_point_at_a_commit_is_skipped() {
        let (dir, repo) = init_repo_with_commits();
        let tree_id = repo.head().unwrap().peel_to_commit().unwrap().tree_id();
        let tree_obj = repo.find_object(tree_id, None).unwrap();
        repo.tag("tree-tag", &tree_obj, &sig_at(9000), "not a commit", false).unwrap();
        annotated(&repo, "real", first_commit(&repo), 1000);
        assert_eq!(name_of(latest_release_tag(dir.path().to_str().unwrap(), "").unwrap()), Some("real".into()));
    }

    #[test]
    fn none_without_matches_and_for_an_unborn_head() {
        let (dir, _repo) = init_repo_with_commits();
        assert_eq!(latest_release_tag(dir.path().to_str().unwrap(), "").unwrap(), None);

        let empty = tempfile::TempDir::new().unwrap();
        Repository::init(empty.path()).unwrap();
        assert_eq!(latest_release_tag(empty.path().to_str().unwrap(), "").unwrap(), None);
    }

    #[test]
    fn works_on_a_detached_head() {
        let (dir, repo) = init_repo_with_commits();
        let first = first_commit(&repo);
        annotated(&repo, "rel-1", first, 1000);
        repo.set_head_detached(repo.head().unwrap().target().unwrap()).unwrap();
        assert_eq!(name_of(latest_release_tag(dir.path().to_str().unwrap(), "").unwrap()), Some("rel-1".into()));
    }
```

Run: `cd src-tauri && cargo test latest_release_tag release_notes::tests`
Expected: the tests asserting a tag FAIL (stub returns `None`); `none_without_matches_and_for_an_unborn_head` passes trivially.

- [ ] **Step 3: Implement**

Replace the stub body:

```rust
pub fn latest_release_tag(repo_path: &str, pattern: &str) -> Result<Option<ReleaseTag>, AppError> {
    let repo = Repository::open(repo_path)?;
    let head = match repo.head() {
        Ok(h) => match h.peel_to_commit() {
            Ok(c) => c.id(),
            Err(_) => return Ok(None),
        },
        Err(e) if e.code() == git2::ErrorCode::UnbornBranch || e.code() == git2::ErrorCode::NotFound => {
            return Ok(None)
        }
        Err(e) => return Err(e.into()),
    };

    let pattern = pattern.trim();
    let names = repo.tag_names(if pattern.is_empty() { None } else { Some(pattern) })?;
    let mut best: Option<ReleaseTag> = None;
    for name in names.iter().flatten() {
        let Ok(obj) = repo.revparse_single(&format!("refs/tags/{name}")) else { continue };
        let Ok(commit) = obj.peel_to_commit() else { continue };
        let reachable =
            commit.id() == head || repo.graph_descendant_of(head, commit.id()).unwrap_or(false);
        if !reachable {
            continue;
        }
        let timestamp = match obj.as_tag().and_then(|t| t.tagger()) {
            Some(sig) => sig.when().seconds(),
            None => commit.time().seconds(),
        };
        let better = match &best {
            None => true,
            Some(b) => (timestamp, name) > (b.timestamp, b.name.as_str()),
        };
        if better {
            best = Some(ReleaseTag { name: name.to_string(), oid: commit.id().to_string(), timestamp });
        }
    }
    Ok(best)
}
```

Append to `src-tauri/src/commands.rs`:

```rust
#[tauri::command]
pub async fn latest_release_tag(
    repo_path: String,
    pattern: String,
) -> Result<Option<crate::release_notes::ReleaseTag>, AppError> {
    run_blocking(move || crate::release_notes::latest_release_tag(&repo_path, &pattern)).await
}
```

In `src-tauri/src/lib.rs`, after `commands::release_notes_commits,` add `commands::latest_release_tag,`.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd src-tauri && cargo test`
Expected: all pass (the 10 new tests included). If `(timestamp, name) > (b.timestamp, b.name.as_str())` does not type-check, compare `(timestamp, name.to_string()) > (b.timestamp, b.name.clone())` instead.

- [ ] **Step 5: Checkpoint**

Run: `cd src-tauri && cargo test 2>&1 | grep -E "test result|FAILED"`
Expected: `0 failed`.

---

### Task 3: Release-notes history storage (Rust)

**Files:**
- Modify: `src-tauri/src/db.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `db::ReleaseNoteEntry { id: i64, from_label, to_label, text: String, created_at: i64 }` (camelCase); `db::add_release_note(&Connection, repo_path: &str, from_label: &str, to_label: &str, text: &str, now: i64) -> Result<ReleaseNoteEntry, AppError>`; `db::list_release_notes(&Connection, repo_path: &str) -> Result<Vec<ReleaseNoteEntry>, AppError>` (newest first); `db::delete_release_note(&Connection, id: i64) -> Result<(), AppError>`; `pub const RELEASE_NOTES_HISTORY_CAP: usize = 50`. Tauri commands `add_release_note(repo_path, from_label, to_label, text)`, `list_release_notes(repo_path)`, `delete_release_note(id)`.

- [ ] **Step 1: Add the type and stubs**

In `db.rs` add:

```rust
pub const RELEASE_NOTES_HISTORY_CAP: usize = 50;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNoteEntry {
    pub id: i64,
    pub from_label: String,
    pub to_label: String,
    pub text: String,
    pub created_at: i64,
}

pub fn add_release_note(
    _conn: &Connection,
    _repo_path: &str,
    _from_label: &str,
    _to_label: &str,
    _text: &str,
    _now: i64,
) -> Result<ReleaseNoteEntry, AppError> {
    Err(AppError::Operation("not implemented".into()))
}

pub fn list_release_notes(_conn: &Connection, _repo_path: &str) -> Result<Vec<ReleaseNoteEntry>, AppError> {
    Ok(vec![])
}

pub fn delete_release_note(_conn: &Connection, _id: i64) -> Result<(), AppError> {
    Ok(())
}
```

- [ ] **Step 2: Write the failing tests**

Append inside `mod tests` of `db.rs`:

```rust
    fn note(conn: &Connection, repo: &str, text: &str, now: i64) -> ReleaseNoteEntry {
        add_release_note(conn, repo, "tag a", "HEAD", text, now).unwrap()
    }

    #[test]
    fn release_notes_list_newest_first_with_all_fields() {
        let conn = setup();
        note(&conn, "/r", "first", 100);
        let second = note(&conn, "/r", "second", 200);
        let list = list_release_notes(&conn, "/r").unwrap();
        assert_eq!(list.iter().map(|e| e.text.as_str()).collect::<Vec<_>>(), vec!["second", "first"]);
        assert_eq!(list[0], second);
        assert_eq!((list[0].from_label.as_str(), list[0].to_label.as_str(), list[0].created_at), ("tag a", "HEAD", 200));
    }

    #[test]
    fn copying_identical_text_for_the_same_range_only_refreshes_the_time() {
        let conn = setup();
        let a = note(&conn, "/r", "same", 100);
        let b = note(&conn, "/r", "same", 500);
        assert_eq!(a.id, b.id);
        assert_eq!(b.created_at, 500);
        assert_eq!(list_release_notes(&conn, "/r").unwrap().len(), 1);
    }

    #[test]
    fn dedupe_only_compares_with_the_newest_entry() {
        let conn = setup();
        note(&conn, "/r", "A", 100);
        note(&conn, "/r", "B", 200);
        note(&conn, "/r", "A", 300);
        assert_eq!(list_release_notes(&conn, "/r").unwrap().len(), 3);
    }

    #[test]
    fn a_different_range_with_the_same_text_is_a_new_entry() {
        let conn = setup();
        add_release_note(&conn, "/r", "tag a", "HEAD", "x", 100).unwrap();
        add_release_note(&conn, "/r", "tag b", "HEAD", "x", 200).unwrap();
        assert_eq!(list_release_notes(&conn, "/r").unwrap().len(), 2);
    }

    #[test]
    fn history_keeps_only_the_newest_fifty_per_repo() {
        let conn = setup();
        for i in 0..(RELEASE_NOTES_HISTORY_CAP + 5) {
            note(&conn, "/r", &format!("note {i}"), i as i64);
        }
        note(&conn, "/other", "keep me", 1);
        let list = list_release_notes(&conn, "/r").unwrap();
        assert_eq!(list.len(), RELEASE_NOTES_HISTORY_CAP);
        assert_eq!(list[0].text, "note 54");
        assert_eq!(list.last().unwrap().text, "note 5");
        assert_eq!(list_release_notes(&conn, "/other").unwrap().len(), 1);
    }

    #[test]
    fn history_is_per_repo() {
        let conn = setup();
        note(&conn, "/a", "for a", 1);
        note(&conn, "/b", "for b", 2);
        assert_eq!(list_release_notes(&conn, "/a").unwrap()[0].text, "for a");
        assert_eq!(list_release_notes(&conn, "/b").unwrap().len(), 1);
        assert!(list_release_notes(&conn, "/c").unwrap().is_empty());
    }

    #[test]
    fn empty_or_blank_text_is_rejected() {
        let conn = setup();
        assert!(add_release_note(&conn, "/r", "a", "b", "", 1).is_err());
        assert!(add_release_note(&conn, "/r", "a", "b", "  \n ", 1).is_err());
        assert!(list_release_notes(&conn, "/r").unwrap().is_empty());
    }

    #[test]
    fn text_is_stored_exactly_including_special_characters() {
        let conn = setup();
        let text = "- <b>bold</b> & [link](https://x.y/z) \"q\" 'q'\nsecond line";
        note(&conn, "/r", text, 1);
        assert_eq!(list_release_notes(&conn, "/r").unwrap()[0].text, text);
    }

    #[test]
    fn delete_removes_one_entry_and_tolerates_unknown_ids() {
        let conn = setup();
        let a = note(&conn, "/r", "a", 1);
        note(&conn, "/r", "b", 2);
        delete_release_note(&conn, a.id).unwrap();
        delete_release_note(&conn, 9999).unwrap();
        assert_eq!(list_release_notes(&conn, "/r").unwrap().len(), 1);
    }
```

Run: `cd src-tauri && cargo test release_notes`
Expected: FAIL (add returns the stub error; list returns empty).

- [ ] **Step 3: Implement**

In `init_db`, add:

```rust
    conn.execute(
        "CREATE TABLE IF NOT EXISTS release_notes_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            repo_path TEXT NOT NULL,
            from_label TEXT NOT NULL,
            to_label TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_release_notes_history_repo
         ON release_notes_history (repo_path, created_at)",
        [],
    )?;
```

Replace the three stubs:

```rust
fn row_to_note(row: &rusqlite::Row) -> rusqlite::Result<ReleaseNoteEntry> {
    Ok(ReleaseNoteEntry {
        id: row.get(0)?,
        from_label: row.get(1)?,
        to_label: row.get(2)?,
        text: row.get(3)?,
        created_at: row.get(4)?,
    })
}

pub fn add_release_note(
    conn: &Connection,
    repo_path: &str,
    from_label: &str,
    to_label: &str,
    text: &str,
    now: i64,
) -> Result<ReleaseNoteEntry, AppError> {
    if text.trim().is_empty() {
        return Err(AppError::Operation("nothing to save: the release notes are empty".into()));
    }
    let newest = conn
        .query_row(
            "SELECT id, from_label, to_label, text, created_at FROM release_notes_history
             WHERE repo_path = ?1 ORDER BY created_at DESC, id DESC LIMIT 1",
            params![repo_path],
            row_to_note,
        )
        .optional()?;
    if let Some(mut entry) = newest {
        if entry.from_label == from_label && entry.to_label == to_label && entry.text == text {
            conn.execute(
                "UPDATE release_notes_history SET created_at = ?1 WHERE id = ?2",
                params![now, entry.id],
            )?;
            entry.created_at = now;
            return Ok(entry);
        }
    }
    conn.execute(
        "INSERT INTO release_notes_history (repo_path, from_label, to_label, text, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![repo_path, from_label, to_label, text, now],
    )?;
    let id = conn.last_insert_rowid();
    conn.execute(
        "DELETE FROM release_notes_history
         WHERE repo_path = ?1 AND id NOT IN (
             SELECT id FROM release_notes_history WHERE repo_path = ?1
             ORDER BY created_at DESC, id DESC LIMIT ?2
         )",
        params![repo_path, RELEASE_NOTES_HISTORY_CAP as i64],
    )?;
    Ok(ReleaseNoteEntry {
        id,
        from_label: from_label.to_string(),
        to_label: to_label.to_string(),
        text: text.to_string(),
        created_at: now,
    })
}

pub fn list_release_notes(conn: &Connection, repo_path: &str) -> Result<Vec<ReleaseNoteEntry>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, from_label, to_label, text, created_at FROM release_notes_history
         WHERE repo_path = ?1 ORDER BY created_at DESC, id DESC",
    )?;
    let rows = stmt.query_map(params![repo_path], row_to_note)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn delete_release_note(conn: &Connection, id: i64) -> Result<(), AppError> {
    conn.execute("DELETE FROM release_notes_history WHERE id = ?1", params![id])?;
    Ok(())
}
```

Append to `commands.rs`:

```rust
#[tauri::command]
pub async fn add_release_note(
    state: State<'_, AppState>,
    repo_path: String,
    from_label: String,
    to_label: String,
    text: String,
) -> Result<db::ReleaseNoteEntry, AppError> {
    let db = state.db.clone();
    run_blocking(move || {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let conn = db.lock().unwrap();
        db::add_release_note(&conn, &repo_path, &from_label, &to_label, &text, now)
    })
    .await
}

#[tauri::command]
pub async fn list_release_notes(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<Vec<db::ReleaseNoteEntry>, AppError> {
    let db = state.db.clone();
    run_blocking(move || {
        let conn = db.lock().unwrap();
        db::list_release_notes(&conn, &repo_path)
    })
    .await
}

#[tauri::command]
pub async fn delete_release_note(state: State<'_, AppState>, id: i64) -> Result<(), AppError> {
    let db = state.db.clone();
    run_blocking(move || {
        let conn = db.lock().unwrap();
        db::delete_release_note(&conn, id)
    })
    .await
}
```

In `lib.rs` after `commands::latest_release_tag,` add `commands::add_release_note, commands::list_release_notes, commands::delete_release_note,` (one per line).

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd src-tauri && cargo test`
Expected: all pass (9 new history tests included).

- [ ] **Step 5: Checkpoint**

Run: `cd src-tauri && cargo test 2>&1 | grep -E "test result|FAILED"`
Expected: `0 failed`.

---

### Task 4: Frontend types, wrappers and the settings field

**Files:**
- Modify: `src/lib/repoSettings.ts`, `src/lib/tauri.ts`, `src/components/RepoSettingsSection.tsx`
- Test: `src/__tests__/repoSettings.test.ts`, `src/__tests__/repoSettingsStore.test.tsx`, `src/__tests__/RepoSettingsSection.test.tsx`

**Interfaces:**
- Consumes: Rust commands from Tasks 1–3.
- Produces: `RepoSettings.releaseTagPattern: string` (default `""`); `invokeLatestReleaseTag(repoPath: string, pattern: string): Promise<ReleaseTag | null>`; `invokeAddReleaseNote(repoPath, fromLabel, toLabel, text): Promise<ReleaseNoteEntry>`; `invokeListReleaseNotes(repoPath): Promise<ReleaseNoteEntry[]>`; `invokeDeleteReleaseNote(id: number): Promise<void>`; types `ReleaseTag { name: string; oid: string; timestamp: number }` and `ReleaseNoteEntry { id: number; fromLabel: string; toLabel: string; text: string; createdAt: number }`.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/repoSettings.test.ts` change the defaults assertion to include `releaseTagPattern: ""`:

```ts
    expect(DEFAULT_REPO_SETTINGS).toEqual({
      ticketPattern: "CEM-\\d+",
      jiraBaseUrl: "https://cemento.atlassian.net/browse/",
      worktreeDir: "",
      releaseTagPattern: "",
    });
```

In `src/__tests__/repoSettingsStore.test.tsx` change `const custom = {...}` to add `releaseTagPattern: "rel-*"`. In `src/__tests__/RepoSettingsSection.test.tsx` change `const other = {...}` (inside the describe) to add `releaseTagPattern: "rel-*"`, and append inside the describe:

```tsx
  it("edits the release tag pattern, with a hint about the empty default", async () => {
    render(<RepoSettingsSection initialRepoPath="/work/other" />);
    await waitFor(() => expect(screen.getByLabelText("Release tag pattern")).toHaveProperty("value", "rel-*"));
    expect(screen.getByText(/Empty = any tag/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Release tag pattern"), { target: { value: "beta-*" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(tauri.invokeSetRepoSettings).toHaveBeenCalledWith("/work/other", { ...other, releaseTagPattern: "beta-*" })
    );
  });
```

Run: `npx vitest run src/__tests__/repoSettings.test.ts src/__tests__/repoSettingsStore.test.tsx src/__tests__/RepoSettingsSection.test.tsx`
Expected: FAIL (defaults lack the field; no input).

- [ ] **Step 2: Implement**

`src/lib/repoSettings.ts`: add `releaseTagPattern: string;` to `RepoSettings` (after `worktreeDir`) and `releaseTagPattern: "",` to `DEFAULT_REPO_SETTINGS`.

`src/lib/tauri.ts`: append

```ts

export interface ReleaseTag {
  name: string;
  oid: string;
  timestamp: number;
}

export interface ReleaseNoteEntry {
  id: number;
  fromLabel: string;
  toLabel: string;
  text: string;
  createdAt: number;
}

export const invokeLatestReleaseTag = (repoPath: string, pattern: string) =>
  invoke<ReleaseTag | null>("latest_release_tag", { repoPath, pattern });

export const invokeAddReleaseNote = (repoPath: string, fromLabel: string, toLabel: string, text: string) =>
  invoke<ReleaseNoteEntry>("add_release_note", { repoPath, fromLabel, toLabel, text });

export const invokeListReleaseNotes = (repoPath: string) =>
  invoke<ReleaseNoteEntry[]>("list_release_notes", { repoPath });

export const invokeDeleteReleaseNote = (id: number) => invoke<void>("delete_release_note", { id });
```

`src/components/RepoSettingsSection.tsx`: after the "Worktree folder" `<label>` block add

```tsx
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        Release tag pattern (glob)
        <input
          aria-label="Release tag pattern"
          disabled={loading}
          value={form.releaseTagPattern}
          onChange={(e) => set({ releaseTagPattern: e.target.value })}
          placeholder="beta-ota-v-mobile-*"
          className={`${inputClass} font-mono`}
        />
        <span>e.g. beta-ota-v-mobile-*. Empty = any tag.</span>
      </label>
```

(keep the same `disabled={loading}` convention the sibling inputs use).

- [ ] **Step 3: Run the tests and verify they pass**

Run: `npx vitest run src/__tests__/repoSettings.test.ts src/__tests__/repoSettingsStore.test.tsx src/__tests__/RepoSettingsSection.test.tsx && npx tsc --noEmit`
Expected: all pass, tsc clean. If `tsc` reports other test files whose `RepoSettings` literals miss `releaseTagPattern` (for example `ReleaseNotesDialog.test.tsx` uses spreads of `DEFAULT_REPO_SETTINGS`, which are fine), add `releaseTagPattern: ""` to those literals.

- [ ] **Step 4: Checkpoint**

Run: `npm test 2>&1 | grep -E "Test Files|Tests  |^ *×|Errors "`
Expected: no failures.

---

### Task 5: "Since latest release tag" button and palette entry

**Files:**
- Create: `src/lib/latestReleaseTag.ts`
- Modify: `src/components/BranchTree.tsx`, `src/components/CommandPalette.tsx`
- Test: `src/__tests__/latestReleaseTag.test.tsx`

**Interfaces:**
- Consumes: `invokeLatestReleaseTag` (Task 4); `useRepoSettingsStore.load/byPath`; `useReleaseNotesStore.startRange`; `headEnd()` from `src/lib/releaseNotes.ts`; `toast`.
- Produces: `releaseNotesSinceLatestTag(): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

`src/__tests__/latestReleaseTag.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../lib/tauri", async (orig) => ({
  ...(await orig<typeof import("../lib/tauri")>()),
  invokeLatestReleaseTag: vi.fn(),
  invokeGetRepoSettings: vi.fn(),
}));

import * as tauri from "../lib/tauri";
import { DEFAULT_REPO_SETTINGS } from "../lib/repoSettings";
import { releaseNotesSinceLatestTag } from "../lib/latestReleaseTag";
import { useRepoSettingsStore } from "../store/repoSettingsStore";
import { useReleaseNotesStore } from "../store/releaseNotesStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useToastStore } from "../store/toastStore";
import BranchTree from "../components/BranchTree";
import CommandPalette from "../components/CommandPalette";

const tag = { name: "beta-ota-378", oid: "abc123", timestamp: 1000 };

function seed() {
  vi.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  useReleaseNotesStore.getState().clear();
  useRepoSettingsStore.setState({ byPath: {} });
  vi.mocked(tauri.invokeGetRepoSettings).mockResolvedValue({ ...DEFAULT_REPO_SETTINGS, releaseTagPattern: "beta-*" });
  vi.mocked(tauri.invokeLatestReleaseTag).mockResolvedValue(tag);
  useWorkspaceStore.setState({
    repos: [{ id: 1, path: "/r", name: "r", pinned: false }],
    activeRepoId: 1,
    branches: [{ name: "release-379", isRemote: false, isHead: true, targetOid: "h" }],
    tags: [{ name: "beta-ota-378", targetOid: "abc123" }],
    commits: [],
  } as never);
}

describe("releaseNotesSinceLatestTag", () => {
  beforeEach(seed);

  it("looks the tag up with the repo's pattern and opens the range tag → HEAD", async () => {
    await releaseNotesSinceLatestTag();
    expect(tauri.invokeLatestReleaseTag).toHaveBeenCalledWith("/r", "beta-*");
    const s = useReleaseNotesStore.getState();
    expect(s.from).toMatchObject({ oid: "abc123", label: "beta-ota-378" });
    expect(s.to).toMatchObject({ oid: "HEAD", label: "HEAD (release-379)" });
  });

  it("says so when no tag matches the pattern, and opens nothing", async () => {
    vi.mocked(tauri.invokeLatestReleaseTag).mockResolvedValue(null);
    await releaseNotesSinceLatestTag();
    expect(useReleaseNotesStore.getState().from).toBeNull();
    expect(useToastStore.getState().toasts[0].message).toBe('No tag matching "beta-*" reachable from HEAD');
  });

  it("uses a different message when the pattern is empty", async () => {
    vi.mocked(tauri.invokeGetRepoSettings).mockResolvedValue(DEFAULT_REPO_SETTINGS);
    vi.mocked(tauri.invokeLatestReleaseTag).mockResolvedValue(null);
    await releaseNotesSinceLatestTag();
    expect(useToastStore.getState().toasts[0].message).toBe("No tags reachable from HEAD");
  });

  it("toasts an error when the lookup fails", async () => {
    vi.mocked(tauri.invokeLatestReleaseTag).mockRejectedValue("repo unreadable");
    await releaseNotesSinceLatestTag();
    expect(useReleaseNotesStore.getState().from).toBeNull();
    expect(useToastStore.getState().toasts[0].message).toContain("repo unreadable");
  });

  it("does nothing without an active repo", async () => {
    useWorkspaceStore.setState({ activeRepoId: null } as never);
    await releaseNotesSinceLatestTag();
    expect(tauri.invokeLatestReleaseTag).not.toHaveBeenCalled();
  });
});

describe("entry points", () => {
  beforeEach(seed);

  it("the TAGS header has a button that runs the flow", async () => {
    render(<BranchTree />);
    fireEvent.click(screen.getByRole("button", { name: "Release notes since latest release tag" }));
    await waitFor(() => expect(useReleaseNotesStore.getState().from?.oid).toBe("abc123"));
  });

  it("the TAGS button is disabled without an active repo", () => {
    useWorkspaceStore.setState({ activeRepoId: null } as never);
    render(<BranchTree />);
    expect(screen.getByRole("button", { name: "Release notes since latest release tag" })).toBeDisabled();
  });

  it("the command palette lists it and running it starts the flow", async () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.click(await screen.findByText("Release notes since latest release tag"));
    await waitFor(() => expect(useReleaseNotesStore.getState().from?.oid).toBe("abc123"));
  });

  it("the palette hides it when no repo is active", async () => {
    useWorkspaceStore.setState({ activeRepoId: null } as never);
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await screen.findByRole("textbox");
    expect(screen.queryByText("Release notes since latest release tag")).toBeNull();
  });
});
```

Run: `npx vitest run src/__tests__/latestReleaseTag.test.tsx`
Expected: FAIL, cannot resolve `../lib/latestReleaseTag`.

- [ ] **Step 2: Implement**

`src/lib/latestReleaseTag.ts`:

```ts
import { useWorkspaceStore } from "../store/workspaceStore";
import { useRepoSettingsStore } from "../store/repoSettingsStore";
import { useReleaseNotesStore } from "../store/releaseNotesStore";
import { invokeLatestReleaseTag } from "./tauri";
import { headEnd } from "./releaseNotes";
import { toast } from "../store/toastStore";

/** Opens release notes from the newest matching release tag reachable from HEAD up to HEAD. */
export async function releaseNotesSinceLatestTag(): Promise<void> {
  const { repos, activeRepoId } = useWorkspaceStore.getState();
  const repo = repos.find((r) => r.id === activeRepoId);
  if (!repo) return;
  try {
    await useRepoSettingsStore.getState().load(repo.path);
    const pattern = useRepoSettingsStore.getState().byPath[repo.path]?.releaseTagPattern ?? "";
    const tag = await invokeLatestReleaseTag(repo.path, pattern);
    if (!tag) {
      toast.info(pattern ? `No tag matching "${pattern}" reachable from HEAD` : "No tags reachable from HEAD");
      return;
    }
    useReleaseNotesStore.getState().startRange({ oid: tag.oid, label: tag.name }, headEnd());
  } catch (e) {
    toast.error(`Couldn't find the latest release tag: ${e instanceof Error ? e.message : String(e)}`);
  }
}
```

`src/components/BranchTree.tsx`: add `FileText` to the lucide import line (it already imports `Search` from "lucide-react"), add `import { releaseNotesSinceLatestTag } from "../lib/latestReleaseTag";`, and in the Tags header `<div className="flex items-center gap-1.5">` add after the search button:

```tsx
        <button
          type="button"
          aria-label="Release notes since latest release tag"
          title="Release notes since the latest release tag"
          disabled={!activeRepo}
          onClick={() => void releaseNotesSinceLatestTag()}
          className="text-text-muted hover:text-text-primary disabled:opacity-40"
        >
          <FileText size={11} />
        </button>
```

(`activeRepo` already exists in BranchTree; the existing handlers use `activeRepo?.path`.)

`src/components/CommandPalette.tsx`: add `import { releaseNotesSinceLatestTag } from "../lib/latestReleaseTag";` and, inside the `if (activeRepo) {` block that pushes branch items, before its closing, add:

```tsx
      result.push({
        id: "release-notes-latest-tag",
        section: "Release notes",
        label: "Release notes since latest release tag",
        run: () => {
          void releaseNotesSinceLatestTag();
          setActiveView("repo");
          close();
        },
      });
```

(Place it before the `for (const b of branches)` loop so it sits ahead of the branch list.)

- [ ] **Step 3: Run the tests and verify they pass**

Run: `npx vitest run src/__tests__/latestReleaseTag.test.tsx && npx tsc --noEmit`
Expected: all pass. If the palette test cannot find the textbox/items because the palette needs `metaKey` on this platform, mirror the key combination used in `src/__tests__/CommandPalette.test.tsx`.

- [ ] **Step 4: Checkpoint**

Run: `npm test 2>&1 | grep -E "Test Files|Tests  |^ *×|Errors "`
Expected: no failures.

---

### Task 6: History in the release-notes dialog

**Files:**
- Create: `src/store/releaseNotesHistoryStore.ts`
- Modify: `src/lib/branchActions.ts`, `src/components/ReleaseNotesDialog.tsx`
- Test: `src/__tests__/releaseNotesHistory.test.tsx`; update `src/__tests__/ReleaseNotesDialog.test.tsx` mock

**Interfaces:**
- Consumes: `invokeAddReleaseNote/ListReleaseNotes/DeleteReleaseNote`, `ReleaseNoteEntry` (Task 4).
- Produces: `useReleaseNotesHistoryStore { byRepo: Record<string, ReleaseNoteEntry[]>; load(path): Promise<void>; add(path, fromLabel, toLabel, text): Promise<void>; remove(path, id): Promise<void> }`; `copyRichWithToast(html, text, what): Promise<boolean>` (true when copied).

- [ ] **Step 1: Write the failing tests**

First, in `src/__tests__/ReleaseNotesDialog.test.tsx` add to the `vi.mock("../lib/tauri", ...)` factory object: `invokeAddReleaseNote: vi.fn().mockResolvedValue({ id: 1, fromLabel: "", toLabel: "", text: "", createdAt: 1 }), invokeListReleaseNotes: vi.fn().mockResolvedValue([]), invokeDeleteReleaseNote: vi.fn().mockResolvedValue(undefined),` (so existing Copy tests keep working now that Copy also saves).

`src/__tests__/releaseNotesHistory.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("../lib/tauri", async (orig) => ({
  ...(await orig<typeof import("../lib/tauri")>()),
  invokeReleaseNotesCommits: vi.fn(),
  invokeGetRepoSettings: vi.fn(),
  invokeAddReleaseNote: vi.fn(),
  invokeListReleaseNotes: vi.fn(),
  invokeDeleteReleaseNote: vi.fn(),
}));
vi.mock("../lib/clipboard", () => ({
  copyText: vi.fn().mockResolvedValue(true),
  copyRich: vi.fn().mockResolvedValue(true),
}));

import * as tauri from "../lib/tauri";
import { copyRich } from "../lib/clipboard";
import { DEFAULT_REPO_SETTINGS } from "../lib/repoSettings";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useReleaseNotesStore } from "../store/releaseNotesStore";
import { useRepoSettingsStore } from "../store/repoSettingsStore";
import { useReleaseNotesHistoryStore } from "../store/releaseNotesHistoryStore";
import { useToastStore } from "../store/toastStore";
import ReleaseNotesDialog from "../components/ReleaseNotesDialog";

const from = { oid: "f", label: "tag v1", timestamp: 100 };
const to = { oid: "t", label: "HEAD tip", timestamp: 200 };
const LIVE = "- [CEM-1](https://cemento.atlassian.net/browse/CEM-1) | one (#1), 04/10";
const saved = (over = {}) => ({ id: 7, fromLabel: "tag v0", toLabel: "tag v1", text: "- old <b>note</b> & more", createdAt: 1_760_000_000, ...over });

async function openDialog() {
  useReleaseNotesStore.getState().markFrom(from);
  useReleaseNotesStore.getState().markTo(to);
  render(<ReleaseNotesDialog />);
  const box = await screen.findByLabelText("Release notes text");
  await waitFor(() => expect(box).toHaveProperty("value", LIVE));
  return box as HTMLTextAreaElement;
}

describe("release notes history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    useReleaseNotesStore.getState().clear();
    useRepoSettingsStore.setState({ byPath: {} });
    useReleaseNotesHistoryStore.setState({ byRepo: {} });
    useWorkspaceStore.setState({ repos: [{ id: 1, path: "/r", name: "r", pinned: false }], activeRepoId: 1 } as never);
    vi.mocked(tauri.invokeGetRepoSettings).mockResolvedValue(DEFAULT_REPO_SETTINGS);
    vi.mocked(tauri.invokeReleaseNotesCommits).mockResolvedValue([
      { oid: "a", subject: "CEM-1 | one (#1)", timestamp: Math.floor(new Date("2026-10-04T12:00:00").getTime() / 1000) },
    ]);
    vi.mocked(tauri.invokeAddReleaseNote).mockImplementation(async (_p, f, t, text) => ({ id: 99, fromLabel: f, toLabel: t, text, createdAt: 1 }));
    vi.mocked(tauri.invokeListReleaseNotes).mockResolvedValue([]);
    vi.mocked(tauri.invokeDeleteReleaseNote).mockResolvedValue(undefined);
  });

  it("saves what was copied, with the range labels, when you press Copy", async () => {
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(tauri.invokeAddReleaseNote).toHaveBeenCalledWith("/r", "tag v1", "HEAD tip", LIVE));
  });

  it("saves the edited text on Cmd+Enter", async () => {
    const box = await openDialog();
    fireEvent.change(box, { target: { value: "- reworded" } });
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    await waitFor(() => expect(tauri.invokeAddReleaseNote).toHaveBeenCalledWith("/r", "tag v1", "HEAD tip", "- reworded"));
  });

  it("does not save when the copy itself failed", async () => {
    vi.mocked(copyRich).mockResolvedValueOnce(false);
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(copyRich).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(tauri.invokeAddReleaseNote).not.toHaveBeenCalled();
  });

  it("a failing save only toasts; the copy still happened", async () => {
    vi.mocked(tauri.invokeAddReleaseNote).mockRejectedValue("disk full");
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(useToastStore.getState().toasts.some((t) => /history/i.test(t.message))).toBe(true));
    expect(copyRich).toHaveBeenCalled();
  });

  it("History shows the saved list newest first, or an empty message", async () => {
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByText(/Nothing saved yet/i)).toBeTruthy();

    vi.mocked(tauri.invokeListReleaseNotes).mockResolvedValue([saved({ id: 8, fromLabel: "tag v1", toLabel: "HEAD" }), saved()]);
    useReleaseNotesHistoryStore.setState({ byRepo: {} });
    fireEvent.click(screen.getByRole("button", { name: "Back to live" }));
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    const rows = await screen.findAllByRole("button", { name: /after tag v/ });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("after tag v1 → HEAD");
  });

  it("opening a saved copy shows its exact text read-only with a banner and locks the live controls", async () => {
    vi.mocked(tauri.invokeListReleaseNotes).mockResolvedValue([saved()]);
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: /after tag v0/ }));

    const box = screen.getByLabelText("Release notes text") as HTMLTextAreaElement;
    expect(box.value).toBe("- old <b>note</b> & more");
    expect(box.readOnly).toBe(true);
    expect(screen.getByText(/Saved copy from/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Swap" })).toBeDisabled();
    expect(screen.getByLabelText("Dates")).toBeDisabled();
  });

  it("copying a saved copy does not create a new history entry", async () => {
    vi.mocked(tauri.invokeListReleaseNotes).mockResolvedValue([saved()]);
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: /after tag v0/ }));

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => expect(copyRich).toHaveBeenCalledWith("<ul><li>old &lt;b&gt;note&lt;/b&gt; &amp; more</li></ul>", "- old <b>note</b> & more"));
    expect(tauri.invokeAddReleaseNote).not.toHaveBeenCalled();
  });

  it("Back to live returns to the generated notes", async () => {
    vi.mocked(tauri.invokeListReleaseNotes).mockResolvedValue([saved()]);
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: /after tag v0/ }));
    fireEvent.click(screen.getByRole("button", { name: "Back to live" }));
    const box = screen.getByLabelText("Release notes text") as HTMLTextAreaElement;
    expect(box.value).toBe(LIVE);
    expect(box.readOnly).toBe(false);
  });

  it("Delete removes the saved copy and returns to the list", async () => {
    vi.mocked(tauri.invokeListReleaseNotes).mockResolvedValue([saved()]);
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: /after tag v0/ }));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(tauri.invokeDeleteReleaseNote).toHaveBeenCalledWith(7));
    expect(await screen.findByText(/Nothing saved yet/i)).toBeTruthy();
  });

  it("Escape steps back (saved copy → list → live) before closing the dialog", async () => {
    vi.mocked(tauri.invokeListReleaseNotes).mockResolvedValue([saved()]);
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: /after tag v0/ }));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: /after tag v0/ })).toBeTruthy(); // back at the list
    fireEvent.keyDown(window, { key: "Escape" });
    expect((screen.getByLabelText("Release notes text") as HTMLTextAreaElement).value).toBe(LIVE);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows an inline message when the history cannot be loaded", async () => {
    vi.mocked(tauri.invokeListReleaseNotes).mockRejectedValue("db locked");
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByText(/Couldn't load history/i)).toBeTruthy();
  });
});

describe("releaseNotesHistoryStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useReleaseNotesHistoryStore.setState({ byRepo: {} });
  });

  it("add puts the entry first and replaces an entry it de-duplicated into", async () => {
    vi.mocked(tauri.invokeListReleaseNotes).mockResolvedValue([saved({ id: 1, text: "x" })]);
    await useReleaseNotesHistoryStore.getState().load("/r");
    vi.mocked(tauri.invokeAddReleaseNote).mockResolvedValue(saved({ id: 1, text: "x", createdAt: 5 }));
    await useReleaseNotesHistoryStore.getState().add("/r", "a", "b", "x");
    const list = useReleaseNotesHistoryStore.getState().byRepo["/r"];
    expect(list).toHaveLength(1);
    expect(list[0].createdAt).toBe(5);
  });

  it("remove drops the entry from that repo only", async () => {
    useReleaseNotesHistoryStore.setState({ byRepo: { "/r": [saved({ id: 1 }), saved({ id: 2 })], "/o": [saved({ id: 3 })] } });
    await useReleaseNotesHistoryStore.getState().remove("/r", 1);
    expect(useReleaseNotesHistoryStore.getState().byRepo["/r"].map((e) => e.id)).toEqual([2]);
    expect(useReleaseNotesHistoryStore.getState().byRepo["/o"]).toHaveLength(1);
  });
});
```

(`within` may be unused; remove it from the import if the linter complains.)

Run: `npx vitest run src/__tests__/releaseNotesHistory.test.tsx`
Expected: FAIL, cannot resolve `../store/releaseNotesHistoryStore`.

- [ ] **Step 2: Implement**

`src/store/releaseNotesHistoryStore.ts`:

```ts
import { create } from "zustand";
import {
  invokeAddReleaseNote,
  invokeListReleaseNotes,
  invokeDeleteReleaseNote,
  type ReleaseNoteEntry,
} from "../lib/tauri";

interface HistoryState {
  /** Newest first, per repo path. */
  byRepo: Record<string, ReleaseNoteEntry[]>;
  /** Always reads from the backend; throws on failure so the list can show it. */
  load: (path: string) => Promise<void>;
  /** Saves one entry; a de-duplicated entry replaces its older copy in the list. */
  add: (path: string, fromLabel: string, toLabel: string, text: string) => Promise<void>;
  remove: (path: string, id: number) => Promise<void>;
}

export const useReleaseNotesHistoryStore = create<HistoryState>((set) => ({
  byRepo: {},
  load: async (path) => {
    const list = await invokeListReleaseNotes(path);
    set((s) => ({ byRepo: { ...s.byRepo, [path]: list } }));
  },
  add: async (path, fromLabel, toLabel, text) => {
    const entry = await invokeAddReleaseNote(path, fromLabel, toLabel, text);
    set((s) => {
      const rest = (s.byRepo[path] ?? []).filter((e) => e.id !== entry.id);
      return { byRepo: { ...s.byRepo, [path]: [entry, ...rest] } };
    });
  },
  remove: async (path, id) => {
    await invokeDeleteReleaseNote(id);
    set((s) => ({ byRepo: { ...s.byRepo, [path]: (s.byRepo[path] ?? []).filter((e) => e.id !== id) } }));
  },
}));
```

`src/lib/branchActions.ts`: change `copyRichWithToast` to

```ts
export async function copyRichWithToast(html: string, text: string, what: string): Promise<boolean> {
  const ok = await copyRich(html, text);
  if (ok) toast.success(`Copied ${what}`);
  else toast.error(`Could not copy ${what}`);
  return ok;
}
```

`src/components/ReleaseNotesDialog.tsx` — make these edits:

1. Imports: add `import { useReleaseNotesHistoryStore } from "../store/releaseNotesHistoryStore";`, `import { toast } from "../store/toastStore";`, `import type { ReleaseNoteEntry } from "../lib/tauri";`.
2. State, next to the existing `useState`s:

```tsx
  type View = { kind: "live" } | { kind: "list" } | { kind: "saved"; entry: ReleaseNoteEntry };
  const [view, setView] = useState<View>({ kind: "live" });
  const [historyError, setHistoryError] = useState<string | null>(null);
  const history = useReleaseNotesHistoryStore((s) => (repoPath ? s.byRepo[repoPath] : undefined)) ?? [];
```

(Define the `View` type at module level above the component rather than inside it.)

3. Replace `const copy = ...` with:

```tsx
  // Copy the live text, then save it to history. A failed save only toasts.
  const copy = async () => {
    const ok = await copyRichWithToast(releaseNotesToHtml(text), text, "release notes");
    if (ok && repoPath && from && to) {
      await useReleaseNotesHistoryStore
        .getState()
        .add(repoPath, from.label, to.label, text)
        .catch(() => toast.error("Couldn't save to history"));
    }
  };
  const copySaved = (entry: ReleaseNoteEntry) =>
    copyRichWithToast(releaseNotesToHtml(entry.text), entry.text, "release notes");
```

4. Reset the view whenever the range changes: add `setView({ kind: "live" });` at the top of the existing effect that loads commits (the one depending on `[repoPath, fromOid, toOid]`), before `setLoading(true)`.
5. Escape handler: change the effect to

```tsx
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (view.kind === "saved") setView({ kind: "list" });
      else if (view.kind === "list") setView({ kind: "live" });
      else clear();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, clear, view]);
```

6. Opening history:

```tsx
  const openHistory = async () => {
    if (!repoPath) return;
    setHistoryError(null);
    setView({ kind: "list" });
    try {
      await useReleaseNotesHistoryStore.getState().load(repoPath);
    } catch {
      setHistoryError("Couldn't load history");
    }
  };
  const deleteSaved = async (entry: ReleaseNoteEntry) => {
    if (!repoPath) return;
    await useReleaseNotesHistoryStore.getState().remove(repoPath, entry.id).catch(() => toast.error("Couldn't delete that entry"));
    setView({ kind: "list" });
  };
```

7. Body: replace the single `<textarea ...>` (and the `{error && ...}` line) with three branches. `view.kind === "list"` renders:

```tsx
        {view.kind === "list" ? (
          <div className="h-72 overflow-y-auto border border-border-subtle rounded bg-surface">
            {historyError ? (
              <div className="p-3 text-xs text-danger">{historyError}</div>
            ) : history.length === 0 ? (
              <div className="p-3 text-xs text-text-muted">Nothing saved yet. Copied notes appear here.</div>
            ) : (
              history.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-hover border-b border-border-subtle truncate"
                  onClick={() => setView({ kind: "saved", entry })}
                >
                  {new Date(entry.createdAt * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · after{" "}
                  {entry.fromLabel} → {entry.toLabel}
                </button>
              ))
            )}
          </div>
        ) : (
          <>
            {view.kind === "saved" && (
              <div className="flex items-center gap-2 mb-1 text-xs text-text-muted">
                <span>Saved copy from {new Date(view.entry.createdAt * 1000).toLocaleString()}</span>
                <button type="button" className="underline hover:text-text-primary" onClick={() => setView({ kind: "live" })}>
                  Back to live
                </button>
              </div>
            )}
            <textarea
              readOnly={view.kind === "saved"}
              onChange={(e) => setEdited(e.target.value)}
              onKeyDown={(e) => {
                if (view.kind === "saved") return;
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text) {
                  e.preventDefault();
                  void copy();
                  clear();
                }
              }}
              aria-label="Release notes text"
              value={view.kind === "saved" ? view.entry.text : loading ? "" : text}
              placeholder={loading ? "Loading…" : "No commits in this range"}
              className="w-full h-72 bg-surface border border-border-subtle rounded px-2 py-1 font-mono text-xs text-text-primary outline-none resize-none"
            />
            {error && view.kind === "live" && <div className="text-xs text-danger mt-1 break-words">{error}</div>}
          </>
        )}
```

In the list view, "Back to live" must also be reachable (the tests click it): in the footer (step 8) show `Back to live` when `view.kind === "list"`.

8. Footer: disable `Dates`, `PR numbers`, `Jira links` checkboxes and `Swap` when `view.kind !== "live"` (add `|| view.kind !== "live"` to each `disabled`; the Jira-links input's existing `disabled={!canLink}` becomes `disabled={!canLink || view.kind !== "live"}`). Replace the footer's button group (`Swap`, `Close`, `Copy`) with:

```tsx
          <button type="button" disabled={view.kind !== "live"} className="px-3 py-1 text-xs rounded border border-border-subtle hover:bg-hover disabled:opacity-50" onClick={swap}>
            Swap
          </button>
          {view.kind === "live" && (
            <button type="button" disabled={!repoPath} className="px-3 py-1 text-xs rounded border border-border-subtle hover:bg-hover disabled:opacity-50" onClick={() => void openHistory()}>
              History
            </button>
          )}
          {view.kind === "list" && (
            <button type="button" className="px-3 py-1 text-xs rounded border border-border-subtle hover:bg-hover" onClick={() => setView({ kind: "live" })}>
              Back to live
            </button>
          )}
          {view.kind === "saved" && (
            <button type="button" className="px-3 py-1 text-xs rounded border border-border-subtle hover:bg-hover" onClick={() => void deleteSaved(view.entry)}>
              Delete
            </button>
          )}
          <button type="button" className="px-3 py-1 text-xs rounded border border-border-subtle hover:bg-hover" onClick={clear}>
            Close
          </button>
          {view.kind !== "list" && (
            <button
              type="button"
              disabled={view.kind === "saved" ? false : !text}
              className="px-3 py-1 text-xs rounded bg-accent text-accent-contrast disabled:opacity-50"
              onClick={() => (view.kind === "saved" ? void copySaved(view.entry) : void copy())}
            >
              Copy
            </button>
          )}
```

The "Back to live" banner button inside the saved view and the footer's list-view button share the accessible name; in the saved view only the banner one exists, in the list view only the footer one, so each test finds exactly one.

- [ ] **Step 3: Run the tests and verify they pass**

Run: `npx vitest run src/__tests__/releaseNotesHistory.test.tsx src/__tests__/ReleaseNotesDialog.test.tsx && npx tsc --noEmit`
Expected: all pass, tsc clean. If the "Escape steps back" test's second assertion fails because the list view hides rows after the first Escape, check the effect deps include `view`.

- [ ] **Step 4: Final verification**

Run:
```
cd src-tauri && cargo test 2>&1 | grep -E "test result|FAILED"; cd .. && npx tsc --noEmit && echo TSC-OK; npm test 2>&1 | grep -E "Test Files|Tests  |^ *×|Errors |Unhandled"
```
Expected: Rust `0 failed`; tsc clean; Vitest all passing with no `Errors` line. Then confirm manually in the running app: set a release tag pattern in Settings → Repository; click the document icon beside TAGS and see the dialog open on that tag → HEAD; press Copy, reopen the dialog, open History and see the entry; open it, press Back to live.

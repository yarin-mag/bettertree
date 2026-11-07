use crate::error::AppError;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

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
    conn.execute(
        "CREATE TABLE IF NOT EXISTS repo_settings (
            path TEXT PRIMARY KEY,
            ticket_pattern TEXT NOT NULL,
            jira_base_url TEXT NOT NULL,
            worktree_dir TEXT NOT NULL,
            release_tag_pattern TEXT NOT NULL DEFAULT ''
        )",
        [],
    )?;
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
    Ok(())
}

pub fn list_repos(conn: &Connection) -> Result<Vec<RepoEntry>, AppError> {
    let mut stmt =
        conn.prepare("SELECT id, path, name, pinned FROM repos ORDER BY pinned DESC, name ASC")?;
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
    Ok(RepoEntry {
        id,
        path: path.to_string(),
        name: name.to_string(),
        pinned: false,
    })
}

pub fn remove_repo(conn: &Connection, id: i64) -> Result<(), AppError> {
    conn.execute("DELETE FROM repos WHERE id = ?1", params![id])?;
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSettings {
    pub ticket_pattern: String,
    pub jira_base_url: String,
    pub worktree_dir: String,
    pub release_tag_pattern: String,
}

impl Default for RepoSettings {
    fn default() -> Self {
        Self {
            ticket_pattern: r"CEM-\d+".into(),
            jira_base_url: "https://cemento.atlassian.net/browse/".into(),
            worktree_dir: String::new(),
            release_tag_pattern: String::new(),
        }
    }
}

fn normalize_repo_settings(s: &RepoSettings) -> Result<RepoSettings, AppError> {
    let mut url = s.jira_base_url.trim().to_string();
    if !url.is_empty() {
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return Err(AppError::Operation(
                "Jira base URL must start with http:// or https://".into(),
            ));
        }
        if !url.ends_with('/') {
            url.push('/');
        }
    }
    let dir = s.worktree_dir.trim().to_string();
    if !dir.is_empty() && !std::path::Path::new(&dir).is_absolute() {
        return Err(AppError::Operation("Worktree folder must be an absolute path".into()));
    }
    Ok(RepoSettings {
        ticket_pattern: s.ticket_pattern.trim().to_string(),
        jira_base_url: url,
        worktree_dir: dir,
        release_tag_pattern: s.release_tag_pattern.trim().to_string(),
    })
}

pub fn get_repo_settings(conn: &Connection, path: &str) -> Result<RepoSettings, AppError> {
    let row = conn
        .query_row(
            "SELECT ticket_pattern, jira_base_url, worktree_dir, release_tag_pattern FROM repo_settings WHERE path = ?1",
            params![path],
            |row| {
                Ok(RepoSettings {
                    ticket_pattern: row.get(0)?,
                    jira_base_url: row.get(1)?,
                    worktree_dir: row.get(2)?,
                    release_tag_pattern: row.get(3)?,
                })
            },
        )
        .optional()?;
    Ok(row.unwrap_or_default())
}

pub fn set_repo_settings(
    conn: &Connection,
    path: &str,
    settings: &RepoSettings,
) -> Result<RepoSettings, AppError> {
    let normalized = normalize_repo_settings(settings)?;
    conn.execute(
        "INSERT OR REPLACE INTO repo_settings (path, ticket_pattern, jira_base_url, worktree_dir, release_tag_pattern)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            path,
            normalized.ticket_pattern,
            normalized.jira_base_url,
            normalized.worktree_dir,
            normalized.release_tag_pattern
        ],
    )?;
    Ok(normalized)
}

pub fn reset_repo_settings(conn: &Connection, path: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM repo_settings WHERE path = ?1", params![path])?;
    Ok(())
}

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

    fn custom() -> RepoSettings {
        RepoSettings {
            ticket_pattern: r"ABC-\d+".into(),
            jira_base_url: "https://jira.example.com/browse/".into(),
            worktree_dir: "/tmp/wt".into(),
            release_tag_pattern: String::new(),
        }
    }

    #[test]
    fn repo_settings_default_when_no_row() {
        let conn = setup();
        assert_eq!(get_repo_settings(&conn, "/r").unwrap(), RepoSettings::default());
    }

    #[test]
    fn repo_settings_round_trip_and_overwrite() {
        let conn = setup();
        assert_eq!(set_repo_settings(&conn, "/r", &custom()).unwrap(), custom());
        assert_eq!(get_repo_settings(&conn, "/r").unwrap(), custom());

        let mut next = custom();
        next.ticket_pattern = r"XYZ-\d+".into();
        set_repo_settings(&conn, "/r", &next).unwrap();
        assert_eq!(get_repo_settings(&conn, "/r").unwrap(), next);
        assert_eq!(get_repo_settings(&conn, "/other").unwrap(), RepoSettings::default());
    }

    #[test]
    fn repo_settings_reset_restores_defaults() {
        let conn = setup();
        set_repo_settings(&conn, "/r", &custom()).unwrap();
        reset_repo_settings(&conn, "/r").unwrap();
        assert_eq!(get_repo_settings(&conn, "/r").unwrap(), RepoSettings::default());
    }

    #[test]
    fn repo_settings_adds_missing_trailing_slash_to_url() {
        let conn = setup();
        let mut s = custom();
        s.jira_base_url = "https://jira.example.com/browse".into();
        let stored = set_repo_settings(&conn, "/r", &s).unwrap();
        assert_eq!(stored.jira_base_url, "https://jira.example.com/browse/");
    }

    #[test]
    fn repo_settings_rejects_non_http_url() {
        let conn = setup();
        let mut s = custom();
        s.jira_base_url = "ftp://jira.example.com/".into();
        assert!(set_repo_settings(&conn, "/r", &s).is_err());
        assert_eq!(get_repo_settings(&conn, "/r").unwrap(), RepoSettings::default());
    }

    #[test]
    fn repo_settings_rejects_relative_worktree_dir() {
        let conn = setup();
        let mut s = custom();
        s.worktree_dir = "relative/dir".into();
        assert!(set_repo_settings(&conn, "/r", &s).is_err());
    }

    #[test]
    fn repo_settings_allow_empty_pattern_and_url_to_disable_linking() {
        let conn = setup();
        let s = RepoSettings { ticket_pattern: String::new(), jira_base_url: String::new(), worktree_dir: String::new(), release_tag_pattern: String::new() };
        assert_eq!(set_repo_settings(&conn, "/r", &s).unwrap(), s);
        assert_eq!(get_repo_settings(&conn, "/r").unwrap(), s);
    }

    #[test]
    fn repo_settings_survive_remove_and_readd_of_the_same_path() {
        let conn = setup();
        let repo = add_repo(&conn, "/r", "r").unwrap();
        set_repo_settings(&conn, "/r", &custom()).unwrap();
        remove_repo(&conn, repo.id).unwrap();
        add_repo(&conn, "/r", "r").unwrap();
        assert_eq!(get_repo_settings(&conn, "/r").unwrap(), custom());
    }

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
}

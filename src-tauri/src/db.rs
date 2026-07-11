use crate::error::AppError;
use rusqlite::{params, Connection};
use serde::Serialize;

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

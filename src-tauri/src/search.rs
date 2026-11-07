use crate::error::AppError;
use git2::{Repository, Sort};
use rusqlite::{params, Connection, OpenFlags};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// Bumped whenever the table layout or what gets stored changes; a db with a
/// different version is wiped and rebuilt.
const SCHEMA_VERSION: &str = "2";
/// Changed-line text kept per file / per commit. Search is for finding the
/// commit that touched something, not for archiving whole patches.
const MAX_FILE_BODY_BYTES: usize = 8 * 1024;
const MAX_COMMIT_BODY_BYTES: usize = 40 * 1024;
const MAX_LINE_CHARS: usize = 400;
/// Total index size across all repos before the least recently used go.
pub const MAX_TOTAL_INDEX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const COMMIT_BATCH: usize = 500;

fn path_hash(path: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// The git dir shared by a repo and all its linked worktrees, so they share
/// one index.
fn common_dir(repo: &Repository) -> PathBuf {
    let git_dir = repo.path();
    let base = match std::fs::read_to_string(git_dir.join("commondir")) {
        Ok(rel) => git_dir.join(rel.trim()),
        Err(_) => git_dir.to_path_buf(),
    };
    base.canonicalize().unwrap_or(base)
}

fn index_key(repo: &Repository) -> String {
    path_hash(&common_dir(repo))
}

fn db_path_for(index_dir: &Path, repo: &Repository) -> PathBuf {
    index_dir.join(format!("{}.db", index_key(repo)))
}

#[cfg(test)]
fn index_db_path(index_dir: &Path, repo_path: &str) -> Result<PathBuf, AppError> {
    Ok(db_path_for(index_dir, &Repository::open(repo_path)?))
}

fn default_index_dir() -> Result<PathBuf, AppError> {
    let base = dirs::data_dir().ok_or(AppError::NoDataDir)?;
    Ok(base.join("bettertree").join("index-v2"))
}

/// Deletes the pre-v2 index directory, which stored whole patches per repo
/// path and grew to many GB.
pub fn remove_legacy_index(data_dir: &Path) {
    let _ = std::fs::remove_dir_all(data_dir.join("index"));
}

fn is_noise_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    let name = lower.rsplit('/').next().unwrap_or("");
    const NAMES: &[&str] = &[
        "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "podfile.lock",
        "cargo.lock", "gemfile.lock", "composer.lock", "go.sum",
    ];
    const EXTS: &[&str] = &[
        "lock", "pbxproj", "map", "snap", "svg", "png", "jpg", "jpeg", "gif", "ico", "webp", "pdf",
        "woff", "woff2", "ttf", "eot", "zip", "gz", "jar",
    ];
    if NAMES.contains(&name) || name.ends_with(".min.js") || name.ends_with(".min.css") {
        return true;
    }
    if name.rsplit_once('.').is_some_and(|(_, ext)| EXTS.contains(&ext)) {
        return true;
    }
    lower.contains("node_modules/") || lower.starts_with("pods/") || lower.contains("/pods/")
}

/// Only the added/removed lines of a commit (no context, no headers), skipping
/// generated and binary files and capping the size. Plus the newline-joined
/// paths of every touched file, noise included, for path search.
fn commit_index_text(repo: &Repository, commit: &git2::Commit) -> Result<(String, String), AppError> {
    let tree = commit.tree()?;
    let parent_tree = if commit.parent_count() > 0 {
        Some(commit.parent(0)?.tree()?)
    } else {
        None
    };
    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)?;
    let mut paths = Vec::new();
    let mut body = String::new();
    for idx in 0..diff.deltas().len() {
        let Some(delta) = diff.get_delta(idx) else { continue };
        let Some(path) = delta.new_file().path().or_else(|| delta.old_file().path()) else { continue };
        let path = path.to_string_lossy().to_string();
        let skip = is_noise_path(&path) || delta.flags().is_binary();
        paths.push(path);
        if skip || body.len() >= MAX_COMMIT_BODY_BYTES {
            continue;
        }
        let Some(mut patch) = git2::Patch::from_diff(&diff, idx)? else { continue };
        let file_start = body.len();
        let mut capped = false;
        let printed = patch.print(&mut |_d, _h, line| {
            if !matches!(line.origin(), '+' | '-') {
                return true;
            }
            if body.len() - file_start >= MAX_FILE_BODY_BYTES || body.len() >= MAX_COMMIT_BODY_BYTES {
                capped = true;
                return false;
            }
            if let Ok(s) = std::str::from_utf8(line.content()) {
                let s = s.trim_end_matches(['\n', '\r']);
                body.extend(s.chars().take(MAX_LINE_CHARS));
                body.push('\n');
            }
            true
        });
        // Stopping the print early reports an error; that is our own cap, not a failure.
        if !capped {
            printed?;
        }
    }
    Ok((body, paths.join("\n")))
}

fn init_schema(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);")?;
    let version: Option<String> =
        conn.query_row("SELECT value FROM meta WHERE key = 'schema_version'", [], |r| r.get(0)).ok();
    if version.as_deref() != Some(SCHEMA_VERSION) {
        conn.execute_batch("DROP TABLE IF EXISTS commits; DELETE FROM meta;")?;
    }
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS commits (
            oid TEXT PRIMARY KEY,
            summary TEXT NOT NULL,
            author TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            file_paths TEXT NOT NULL,
            body TEXT NOT NULL
         ) WITHOUT ROWID;
         CREATE INDEX IF NOT EXISTS commits_timestamp ON commits(timestamp);",
    )?;
    set_meta(conn, "schema_version", SCHEMA_VERSION)?;
    Ok(())
}

fn set_meta(conn: &Connection, key: &str, value: &str) -> Result<(), AppError> {
    conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)", params![key, value])?;
    Ok(())
}

fn get_meta(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", params![key], |r| r.get(0)).ok()
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn in_progress() -> &'static Mutex<HashSet<PathBuf>> {
    static SET: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Keeps two refreshes from indexing the same repo at once.
struct BuildGuard(PathBuf);

impl BuildGuard {
    fn acquire(db_path: &Path) -> Option<Self> {
        let mut set = in_progress().lock().unwrap();
        set.insert(db_path.to_path_buf()).then(|| BuildGuard(db_path.to_path_buf()))
    }
}

impl Drop for BuildGuard {
    fn drop(&mut self) {
        in_progress().lock().unwrap().remove(&self.0);
    }
}

/// Brings the repo's shared index up to date, indexing only commits it has not
/// seen. Searches use the index only after the first full pass has finished.
pub fn ensure_index_at(index_dir: &Path, repo_path: &str) -> Result<(), AppError> {
    std::fs::create_dir_all(index_dir)?;
    let repo = Repository::open(repo_path)?;
    let db_path = db_path_for(index_dir, &repo);
    let Some(_guard) = BuildGuard::acquire(&db_path) else { return Ok(()) };
    let conn = Connection::open(&db_path)?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    init_schema(&conn)?;

    let known: HashSet<String> = {
        let mut stmt = conn.prepare("SELECT oid FROM commits")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.collect::<Result<_, _>>()?
    };

    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(Sort::TIME)?;

    conn.execute_batch("BEGIN")?;
    let mut pending = 0;
    for oid_result in revwalk {
        let oid = oid_result?;
        let oid_string = oid.to_string();
        if known.contains(&oid_string) {
            continue;
        }
        let commit = repo.find_commit(oid)?;
        let (body, file_paths) = commit_index_text(&repo, &commit)?;
        conn.prepare_cached(
            "INSERT OR REPLACE INTO commits (oid, summary, author, timestamp, file_paths, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )?
        .execute(params![
            oid_string,
            commit.summary().unwrap_or(""),
            commit.author().name().unwrap_or(""),
            commit.time().seconds(),
            file_paths,
            body,
        ])?;
        pending += 1;
        if pending % COMMIT_BATCH == 0 {
            conn.execute_batch("COMMIT; BEGIN")?;
        }
    }
    set_meta(&conn, "repo_path", repo_path)?;
    set_meta(&conn, "last_used", &now_secs().to_string())?;
    set_meta(&conn, "complete", "1")?;
    conn.execute_batch("COMMIT")?;
    Ok(())
}

pub fn ensure_index(repo_path: &str) -> Result<(), AppError> {
    let dir = default_index_dir()?;
    ensure_index_at(&dir, repo_path)?;
    let keep = db_path_for(&dir, &Repository::open(repo_path)?);
    enforce_cap_at(&dir, MAX_TOTAL_INDEX_BYTES, &keep)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct IndexUsage {
    pub key: String,
    pub repo_path: Option<String>,
    pub size_bytes: u64,
    pub last_used: i64,
}

fn file_len(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

fn db_files(index_dir: &Path, key: &str) -> [PathBuf; 3] {
    [
        index_dir.join(format!("{key}.db")),
        index_dir.join(format!("{key}.db-wal")),
        index_dir.join(format!("{key}.db-shm")),
    ]
}

pub fn list_usage_at(index_dir: &Path) -> Result<Vec<IndexUsage>, AppError> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(index_dir) else { return Ok(out) };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("db") {
            continue;
        }
        let Some(key) = path.file_stem().and_then(|s| s.to_str()).map(str::to_string) else { continue };
        let size_bytes = db_files(index_dir, &key).iter().map(|p| file_len(p)).sum();
        let meta = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok();
        let repo_path = meta.as_ref().and_then(|c| get_meta(c, "repo_path"));
        let last_used = meta
            .as_ref()
            .and_then(|c| get_meta(c, "last_used"))
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        out.push(IndexUsage { key, repo_path, size_bytes, last_used });
    }
    out.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    Ok(out)
}

fn valid_key(key: &str) -> bool {
    key.len() == 16 && key.chars().all(|c| c.is_ascii_hexdigit())
}

fn delete_key(index_dir: &Path, key: &str) {
    for p in db_files(index_dir, key) {
        let _ = std::fs::remove_file(p);
    }
}

/// Deletes one repo's index (by key) or, with `None`, every index.
pub fn clear_at(index_dir: &Path, key: Option<&str>) -> Result<(), AppError> {
    match key {
        Some(k) => {
            if !valid_key(k) {
                return Err(AppError::Operation(format!("invalid index key: {k}")));
            }
            delete_key(index_dir, k);
        }
        None => {
            for usage in list_usage_at(index_dir)? {
                delete_key(index_dir, &usage.key);
            }
        }
    }
    Ok(())
}

/// Evicts least recently used indexes until the total fits `max_bytes`, never
/// touching `keep`.
pub fn enforce_cap_at(index_dir: &Path, max_bytes: u64, keep: &Path) -> Result<(), AppError> {
    let mut usages = list_usage_at(index_dir)?;
    let mut total: u64 = usages.iter().map(|u| u.size_bytes).sum();
    usages.sort_by_key(|u| u.last_used);
    for usage in usages {
        if total <= max_bytes {
            break;
        }
        if index_dir.join(format!("{}.db", usage.key)) == keep {
            continue;
        }
        delete_key(index_dir, &usage.key);
        total = total.saturating_sub(usage.size_bytes);
    }
    Ok(())
}

/// Drops the index of a removed repo unless another registered repo (e.g. a
/// sibling worktree) still uses it.
pub fn remove_for_repo_at(index_dir: &Path, repo_path: &str, remaining: &[String]) -> Result<(), AppError> {
    let key_of = |p: &str| Repository::open(p).ok().map(|r| index_key(&r));
    let in_use: HashSet<String> = remaining.iter().filter_map(|p| key_of(p)).collect();
    let target = match key_of(repo_path) {
        Some(k) => Some(k),
        None => list_usage_at(index_dir)?
            .into_iter()
            .find(|u| u.repo_path.as_deref() == Some(repo_path))
            .map(|u| u.key),
    };
    if let Some(key) = target {
        if !in_use.contains(&key) {
            delete_key(index_dir, &key);
        }
    }
    Ok(())
}

pub fn list_usage() -> Result<Vec<IndexUsage>, AppError> {
    list_usage_at(&default_index_dir()?)
}

pub fn clear(key: Option<&str>) -> Result<(), AppError> {
    clear_at(&default_index_dir()?, key)
}

pub fn remove_for_repo(repo_path: &str, remaining: &[String]) -> Result<(), AppError> {
    remove_for_repo_at(&default_index_dir()?, repo_path, remaining)
}

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
    commit_id: Option<&str>,
    file_path: Option<&str>,
) -> Result<Vec<SearchHit>, AppError> {
    let repo = Repository::open(repo_path)?;
    let db_path = db_path_for(index_dir, &repo);
    let ready = db_path.exists()
        && Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .ok()
            .and_then(|c| get_meta(&c, "complete"))
            .is_some();
    if ready {
        // The index is shared by every branch and worktree of the repo, so keep
        // only commits reachable from this checkout's HEAD.
        let mut walk = repo.revwalk()?;
        walk.push_head()?;
        let reachable: HashSet<String> = walk.filter_map(|o| o.ok()).map(|o| o.to_string()).collect();
        let hits = search_indexed(&db_path, query, author, since, until, commit_id, file_path)?;
        Ok(hits.into_iter().filter(|h| reachable.contains(&h.oid)).collect())
    } else {
        search_live(repo_path, query, author, since, until, commit_id, file_path)
    }
}

pub fn search_commits(
    repo_path: &str,
    query: &str,
    author: Option<&str>,
    since: Option<i64>,
    until: Option<i64>,
    commit_id: Option<&str>,
    file_path: Option<&str>,
) -> Result<Vec<SearchHit>, AppError> {
    search_commits_at(
        &default_index_dir()?, repo_path, query, author, since, until, commit_id, file_path,
    )
}

/// Escapes `%`, `_` and `\` so `query` is matched as a literal LIKE pattern
/// rather than a wildcard expression.
fn escape_like(query: &str) -> String {
    let mut out = String::with_capacity(query.len());
    for c in query.chars() {
        if matches!(c, '\\' | '%' | '_') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Slices a `[...]`-bracketed excerpt of `haystack` around the first
/// case-insensitive occurrence of `needle`, char-indexed to stay clear of
/// UTF-8 boundary panics.
fn build_snippet(haystack: &str, needle: &str, context: usize) -> String {
    let chars: Vec<char> = haystack.chars().collect();
    let haystack_lower: Vec<char> = haystack.to_lowercase().chars().collect();
    let needle_lower: Vec<char> = needle.to_lowercase().chars().collect();

    let pos = if needle_lower.is_empty() || needle_lower.len() > haystack_lower.len() {
        None
    } else {
        haystack_lower.windows(needle_lower.len()).position(|w| w == needle_lower.as_slice())
    };

    match pos {
        Some(idx) => {
            let match_len = needle_lower.len().min(chars.len() - idx);
            let start = idx.saturating_sub(context);
            let end = (idx + match_len + context).min(chars.len());
            let before: String = chars[start..idx].iter().collect();
            let matched: String = chars[idx..idx + match_len].iter().collect();
            let after: String = chars[idx + match_len..end].iter().collect();
            format!(
                "{}{before}[{matched}]{after}{}",
                if start > 0 { "..." } else { "" },
                if end < chars.len() { "..." } else { "" }
            )
        }
        None => chars.iter().take(context * 4).collect(),
    }
}

/// Code being searched is full of characters that make a tokenized full-text
/// query lossy (`!`, `||`, `(`, `-`...), so this does an exact, literal LIKE
/// substring match on the stored changed lines instead.
fn search_indexed(
    db_path: &Path,
    query: &str,
    author: Option<&str>,
    since: Option<i64>,
    until: Option<i64>,
    commit_id: Option<&str>,
    file_path: Option<&str>,
) -> Result<Vec<SearchHit>, AppError> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let trimmed = query.trim();
    let has_query = !trimmed.is_empty();

    let mut sql = String::from("SELECT oid, summary, author, timestamp, body FROM commits");
    let mut bound: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    let mut clauses: Vec<String> = Vec::new();

    if has_query {
        let i = bound.len() + 1;
        clauses.push(format!("(summary LIKE ?{i} ESCAPE '\\' OR body LIKE ?{i} ESCAPE '\\')"));
        bound.push(Box::new(format!("%{}%", escape_like(trimmed))));
    }
    if let Some(a) = author {
        clauses.push(format!("author LIKE ?{}", bound.len() + 1));
        bound.push(Box::new(format!("%{}%", a)));
    }
    if let Some(s) = since {
        clauses.push(format!("timestamp >= ?{}", bound.len() + 1));
        bound.push(Box::new(s));
    }
    if let Some(u) = until {
        clauses.push(format!("timestamp <= ?{}", bound.len() + 1));
        bound.push(Box::new(u));
    }
    if let Some(c) = commit_id {
        clauses.push(format!("oid LIKE ?{} ESCAPE '\\'", bound.len() + 1));
        bound.push(Box::new(format!("{}%", escape_like(c))));
    }
    if let Some(p) = file_path {
        clauses.push(format!("file_paths LIKE ?{} ESCAPE '\\'", bound.len() + 1));
        bound.push(Box::new(format!("%{}%", escape_like(p))));
    }
    if !clauses.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&clauses.join(" AND "));
    }
    sql.push_str(" ORDER BY timestamp DESC");

    let mut stmt = conn.prepare(&sql)?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = bound.iter().map(|b| b.as_ref()).collect();
    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, String>(4)?,
        ))
    })?;
    let mut out = Vec::new();
    for r in rows {
        let (oid, summary, author, timestamp, body) = r?;
        let snippet = if !has_query {
            summary.clone()
        } else if summary.to_lowercase().contains(&trimmed.to_lowercase()) {
            build_snippet(&summary, trimmed, 40)
        } else {
            build_snippet(&body, trimmed, 40)
        };
        out.push(SearchHit { oid, summary, author, timestamp, snippet });
    }
    Ok(out)
}

/// Used when no index exists yet for a repo. Only searches commit
/// messages (not diff content) and does simple case-insensitive
/// substring matching — a deliberately smaller
/// feature set than the indexed path, acceptable for the rare case where
/// a search happens before the background index finishes.
fn search_live(
    repo_path: &str,
    query: &str,
    author: Option<&str>,
    since: Option<i64>,
    until: Option<i64>,
    commit_id: Option<&str>,
    file_path: Option<&str>,
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
        let oid_string = oid.to_string();

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
        if let Some(c) = commit_id {
            if !oid_string.starts_with(c) {
                continue;
            }
        }
        if let Some(p) = file_path {
            let (_, file_paths) = commit_index_text(&repo, &commit)?;
            if !file_paths.split('\n').any(|f| f == p) {
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

        let db_path = index_db_path(index_dir.path(), repo_dir.path().to_str().unwrap()).unwrap();
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM commits", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn ensure_index_stores_changed_lines_for_content_search() {
        let (repo_dir, _repo) = init_repo_with_commits();
        let index_dir = TempDir::new().unwrap();

        ensure_index_at(index_dir.path(), repo_dir.path().to_str().unwrap()).unwrap();

        let db_path = index_db_path(index_dir.path(), repo_dir.path().to_str().unwrap()).unwrap();
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        let body: String = conn
            .query_row(
                "SELECT body FROM commits WHERE summary = 'second commit'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(body.contains("two"), "body was: {body}");
    }

    #[test]
    fn search_finds_commit_by_message() {
        let (repo_dir, _repo) = init_repo_with_commits();
        let index_dir = TempDir::new().unwrap();
        let repo_path = repo_dir.path().to_str().unwrap();
        ensure_index_at(index_dir.path(), repo_path).unwrap();

        let hits = search_commits_at(index_dir.path(), repo_path, "second", None, None, None, None, None).unwrap();
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
        let hits = search_commits_at(index_dir.path(), repo_path, "two", None, None, None, None, None).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].summary, "second commit");
    }

    #[test]
    fn search_filters_by_author() {
        let (repo_dir, _repo) = init_repo_with_commits();
        let index_dir = TempDir::new().unwrap();
        let repo_path = repo_dir.path().to_str().unwrap();
        ensure_index_at(index_dir.path(), repo_path).unwrap();

        let matching = search_commits_at(index_dir.path(), repo_path, "commit", Some("Test User"), None, None, None, None).unwrap();
        assert_eq!(matching.len(), 2);

        let none = search_commits_at(index_dir.path(), repo_path, "commit", Some("Nobody"), None, None, None, None).unwrap();
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

        let all = search_commits_at(index_dir.path(), repo_path, "commit", None, None, None, None, None).unwrap();
        assert_eq!(all.len(), 2);

        let only_new = search_commits_at(index_dir.path(), repo_path, "commit", None, Some(1_500_000_000), None, None, None).unwrap();
        assert_eq!(only_new.len(), 1);
        assert_eq!(only_new[0].summary, "new commit");

        let only_old = search_commits_at(index_dir.path(), repo_path, "commit", None, None, Some(1_500_000_000), None, None).unwrap();
        assert_eq!(only_old.len(), 1);
        assert_eq!(only_old[0].summary, "old commit");
    }

    #[test]
    fn search_with_fts5_special_characters_does_not_error() {
        let (repo_dir, _repo) = init_repo_with_commits();
        let index_dir = TempDir::new().unwrap();
        let repo_path = repo_dir.path().to_str().unwrap();
        ensure_index_at(index_dir.path(), repo_path).unwrap();

        let hits =
            search_commits_at(index_dir.path(), repo_path, "!projectId ||", None, None, None, None, None).unwrap();
        assert!(hits.is_empty());
    }

    #[test]
    fn search_matches_literal_punctuation_not_just_the_bare_word() {
        let (repo_dir, _repo) = init_repo_with_commits();
        let index_dir = TempDir::new().unwrap();
        let repo_path = repo_dir.path().to_str().unwrap();
        std::fs::write(repo_dir.path().join("a.txt"), "if (!projectId || !name) throw x;").unwrap();
        let repo = git2::Repository::open(repo_path).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("a.txt")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = git2::Signature::now("Test User", "test@example.com").unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "add guard clause", &tree, &[&parent]).unwrap();
        ensure_index_at(index_dir.path(), repo_path).unwrap();

        let literal_hits =
            search_commits_at(index_dir.path(), repo_path, "!projectId ||", None, None, None, None, None).unwrap();
        assert_eq!(literal_hits.len(), 1);
        assert!(literal_hits[0].snippet.contains("!projectId ||"), "snippet was: {}", literal_hits[0].snippet);

        let bare_word_hits =
            search_commits_at(index_dir.path(), repo_path, "totallyabsentterm", None, None, None, None, None).unwrap();
        assert!(bare_word_hits.is_empty());
    }

    #[test]
    fn search_with_empty_query_returns_all_within_filters() {
        let (repo_dir, _repo) = init_repo_with_commits();
        let index_dir = TempDir::new().unwrap();
        let repo_path = repo_dir.path().to_str().unwrap();
        ensure_index_at(index_dir.path(), repo_path).unwrap();

        let hits = search_commits_at(index_dir.path(), repo_path, "  ", None, None, None, None, None).unwrap();
        assert_eq!(hits.len(), 2);
    }

    #[test]
    fn ensure_index_stores_file_paths_for_path_search() {
        let (repo_dir, _repo) = init_repo_with_commits();
        let index_dir = TempDir::new().unwrap();

        ensure_index_at(index_dir.path(), repo_dir.path().to_str().unwrap()).unwrap();

        let db_path = index_db_path(index_dir.path(), repo_dir.path().to_str().unwrap()).unwrap();
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        let file_paths: String = conn
            .query_row(
                "SELECT file_paths FROM commits WHERE summary = 'first commit'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(file_paths.contains("a.txt"), "file_paths was: {file_paths}");
    }

    #[test]
    fn search_filters_by_file_path() {
        let dir = TempDir::new().unwrap();
        let mut opts = git2::RepositoryInitOptions::new();
        opts.initial_head("main");
        let repo = Repository::init_opts(dir.path(), &opts).unwrap();
        let sig = git2::Signature::now("Test User", "test@example.com").unwrap();

        std::fs::write(dir.path().join("a.txt"), "one").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("a.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "touch a", &tree, &[]).unwrap();

        std::fs::write(dir.path().join("b.txt"), "two").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("b.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "touch b", &tree, &[&parent]).unwrap();

        let index_dir = TempDir::new().unwrap();
        let repo_path = dir.path().to_str().unwrap();
        ensure_index_at(index_dir.path(), repo_path).unwrap();

        let hits = search_commits_at(
            index_dir.path(), repo_path, "", None, None, None, None, Some("b.txt"),
        ).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].summary, "touch b");
    }

    #[test]
    fn search_filters_by_commit_id_prefix() {
        let (repo_dir, repo) = init_repo_with_commits();
        let index_dir = TempDir::new().unwrap();
        let repo_path = repo_dir.path().to_str().unwrap();
        ensure_index_at(index_dir.path(), repo_path).unwrap();

        let head_oid = repo.head().unwrap().target().unwrap().to_string();
        let prefix = &head_oid[0..8];

        let hits = search_commits_at(
            index_dir.path(), repo_path, "", None, None, None, Some(prefix), None,
        ).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].oid, head_oid);
    }

    #[test]
    fn falls_back_to_live_search_when_no_index_exists() {
        let (repo_dir, _repo) = init_repo_with_commits();
        let index_dir = TempDir::new().unwrap();
        let repo_path = repo_dir.path().to_str().unwrap();
        // Deliberately do not call ensure_index_at — no .db file exists yet.

        let hits = search_commits_at(index_dir.path(), repo_path, "second", None, None, None, None, None).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].summary, "second commit");
    }

    fn commit_files(repo: &Repository, files: &[(&str, &str)], msg: &str) {
        let workdir = repo.workdir().unwrap().to_path_buf();
        let mut index = repo.index().unwrap();
        for (name, content) in files {
            if let Some(parent) = Path::new(name).parent() {
                std::fs::create_dir_all(workdir.join(parent)).unwrap();
            }
            std::fs::write(workdir.join(name), content).unwrap();
            index.add_path(Path::new(name)).unwrap();
        }
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = git2::Signature::now("Test User", "test@example.com").unwrap();
        let parents: Vec<git2::Commit> = repo.head().ok().and_then(|h| h.peel_to_commit().ok()).into_iter().collect();
        let refs: Vec<&git2::Commit> = parents.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &refs).unwrap();
    }

    fn body_of(index_dir: &Path, repo_path: &str, summary: &str) -> String {
        let conn = rusqlite::Connection::open(index_db_path(index_dir, repo_path).unwrap()).unwrap();
        conn.query_row("SELECT body FROM commits WHERE summary = ?1", [summary], |r| r.get(0)).unwrap()
    }

    #[test]
    fn index_keeps_changed_lines_only_not_context() {
        let (repo_dir, repo) = init_repo_with_commits();
        let repo_path = repo_dir.path().to_str().unwrap();
        commit_files(&repo, &[("ctx.txt", "alpha\nbeta\ngamma\ndelta\nepsilon\n")], "add ctx");
        commit_files(&repo, &[("ctx.txt", "alpha\nbeta\nGAMMA-NEW\ndelta\nepsilon\n")], "edit ctx");
        let index_dir = TempDir::new().unwrap();
        ensure_index_at(index_dir.path(), repo_path).unwrap();

        let body = body_of(index_dir.path(), repo_path, "edit ctx");
        assert!(body.contains("GAMMA-NEW") && body.contains("gamma"), "body was: {body}");
        assert!(!body.contains("alpha") && !body.contains("epsilon"), "context leaked: {body}");
        assert!(!body.contains("@@") && !body.contains("diff --git"), "headers leaked: {body}");
    }

    #[test]
    fn index_skips_generated_files_but_still_lists_their_paths() {
        let (repo_dir, repo) = init_repo_with_commits();
        let repo_path = repo_dir.path().to_str().unwrap();
        commit_files(
            &repo,
            &[("yarn.lock", "uniquelockstring\n"), ("App.xcodeproj/project.pbxproj", "uniquepbxstring\n"), ("src.txt", "realcode\n")],
            "add deps",
        );
        let index_dir = TempDir::new().unwrap();
        ensure_index_at(index_dir.path(), repo_path).unwrap();

        let none = search_commits_at(index_dir.path(), repo_path, "uniquelockstring", None, None, None, None, None).unwrap();
        assert!(none.is_empty());
        let none = search_commits_at(index_dir.path(), repo_path, "uniquepbxstring", None, None, None, None, None).unwrap();
        assert!(none.is_empty());
        let real = search_commits_at(index_dir.path(), repo_path, "realcode", None, None, None, None, None).unwrap();
        assert_eq!(real.len(), 1);
        let by_path = search_commits_at(index_dir.path(), repo_path, "", None, None, None, None, Some("yarn.lock")).unwrap();
        assert_eq!(by_path.len(), 1);
    }

    #[test]
    fn index_caps_text_per_file_and_commit() {
        let (repo_dir, repo) = init_repo_with_commits();
        let repo_path = repo_dir.path().to_str().unwrap();
        let big = "x".repeat(300) + "\n";
        let content = big.repeat(1000);
        let files: Vec<(String, &str)> = (0..20).map(|i| (format!("big{i}.txt"), content.as_str())).collect();
        let refs: Vec<(&str, &str)> = files.iter().map(|(n, c)| (n.as_str(), *c)).collect();
        commit_files(&repo, &refs, "huge");
        let index_dir = TempDir::new().unwrap();
        ensure_index_at(index_dir.path(), repo_path).unwrap();

        let body = body_of(index_dir.path(), repo_path, "huge");
        assert!(body.len() <= MAX_COMMIT_BODY_BYTES + 1024, "body len {}", body.len());
        assert!(!body.is_empty());
    }

    #[test]
    fn second_run_indexes_only_new_commits() {
        let (repo_dir, repo) = init_repo_with_commits();
        let repo_path = repo_dir.path().to_str().unwrap();
        let index_dir = TempDir::new().unwrap();
        ensure_index_at(index_dir.path(), repo_path).unwrap();

        // Tamper with an existing row: an incremental run must leave it alone.
        let db = index_db_path(index_dir.path(), repo_path).unwrap();
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute("UPDATE commits SET body = 'sentinel' WHERE summary = 'first commit'", []).unwrap();
        drop(conn);

        commit_files(&repo, &[("n.txt", "brandnew\n")], "third commit");
        ensure_index_at(index_dir.path(), repo_path).unwrap();

        let conn = rusqlite::Connection::open(&db).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM commits", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 3);
        assert_eq!(body_of(index_dir.path(), repo_path, "first commit"), "sentinel");
        let hits = search_commits_at(index_dir.path(), repo_path, "brandnew", None, None, None, None, None).unwrap();
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn worktrees_of_one_repo_share_a_single_index() {
        let (repo_dir, repo) = init_repo_with_commits();
        let wt_parent = TempDir::new().unwrap();
        let wt_path = wt_parent.path().join("wt");
        repo.worktree("wt", &wt_path, None).unwrap();
        let index_dir = TempDir::new().unwrap();

        ensure_index_at(index_dir.path(), repo_dir.path().to_str().unwrap()).unwrap();
        ensure_index_at(index_dir.path(), wt_path.to_str().unwrap()).unwrap();

        let dbs = list_usage_at(index_dir.path()).unwrap();
        assert_eq!(dbs.len(), 1, "expected one shared index, got {dbs:?}");
    }

    #[test]
    fn search_hides_commits_not_reachable_from_head() {
        let (repo_dir, repo) = init_repo_with_commits();
        let wt_parent = TempDir::new().unwrap();
        let wt_path = wt_parent.path().join("wt");
        repo.worktree("wt", &wt_path, None).unwrap();
        let wt_repo = Repository::open(&wt_path).unwrap();
        commit_files(&wt_repo, &[("only_wt.txt", "wtonlyline\n")], "wt only commit");
        let index_dir = TempDir::new().unwrap();
        ensure_index_at(index_dir.path(), wt_path.to_str().unwrap()).unwrap();
        ensure_index_at(index_dir.path(), repo_dir.path().to_str().unwrap()).unwrap();

        let from_wt = search_commits_at(index_dir.path(), wt_path.to_str().unwrap(), "wtonlyline", None, None, None, None, None).unwrap();
        assert_eq!(from_wt.len(), 1);
        let from_main = search_commits_at(index_dir.path(), repo_dir.path().to_str().unwrap(), "wtonlyline", None, None, None, None, None).unwrap();
        assert!(from_main.is_empty());
    }

    #[test]
    fn incomplete_index_falls_back_to_live_search() {
        let (repo_dir, _repo) = init_repo_with_commits();
        let index_dir = TempDir::new().unwrap();
        let repo_path = repo_dir.path().to_str().unwrap();
        std::fs::create_dir_all(index_dir.path()).unwrap();
        let db = index_db_path(index_dir.path(), repo_path).unwrap();
        init_schema(&rusqlite::Connection::open(&db).unwrap()).unwrap(); // no rows, never marked complete

        let hits = search_commits_at(index_dir.path(), repo_path, "second", None, None, None, None, None).unwrap();
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn old_schema_version_is_rebuilt() {
        let (repo_dir, _repo) = init_repo_with_commits();
        let index_dir = TempDir::new().unwrap();
        let repo_path = repo_dir.path().to_str().unwrap();
        ensure_index_at(index_dir.path(), repo_path).unwrap();
        let db = index_db_path(index_dir.path(), repo_path).unwrap();
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute("UPDATE meta SET value = '1' WHERE key = 'schema_version'", []).unwrap();
        conn.execute("UPDATE commits SET body = 'stale'", []).unwrap();
        drop(conn);

        ensure_index_at(index_dir.path(), repo_path).unwrap();
        assert!(body_of(index_dir.path(), repo_path, "second commit").contains("two"));
    }

    #[test]
    fn usage_lists_size_and_repo_and_clear_removes() {
        let (repo_dir, _repo) = init_repo_with_commits();
        let index_dir = TempDir::new().unwrap();
        let repo_path = repo_dir.path().to_str().unwrap();
        ensure_index_at(index_dir.path(), repo_path).unwrap();

        let usage = list_usage_at(index_dir.path()).unwrap();
        assert_eq!(usage.len(), 1);
        assert_eq!(usage[0].repo_path.as_deref(), Some(repo_path));
        assert!(usage[0].size_bytes > 0);
        assert!(usage[0].last_used > 0);

        assert!(clear_at(index_dir.path(), Some("../etc")).is_err());
        clear_at(index_dir.path(), Some(&usage[0].key)).unwrap();
        assert!(list_usage_at(index_dir.path()).unwrap().is_empty());

        ensure_index_at(index_dir.path(), repo_path).unwrap();
        clear_at(index_dir.path(), None).unwrap();
        assert!(list_usage_at(index_dir.path()).unwrap().is_empty());
    }

    #[test]
    fn cap_evicts_least_recently_used_but_keeps_current() {
        let index_dir = TempDir::new().unwrap();
        let mut keys = Vec::new();
        for (i, last_used) in [100, 200, 300].iter().enumerate() {
            let key = format!("{:016x}", i + 1);
            let conn = rusqlite::Connection::open(index_dir.path().join(format!("{key}.db"))).unwrap();
            init_schema(&conn).unwrap();
            set_meta(&conn, "last_used", &last_used.to_string()).unwrap();
            conn.execute("INSERT INTO commits VALUES ('o', 's', 'a', 1, '', ?1)", ["x".repeat(50_000)]).unwrap();
            keys.push(key);
        }
        let keep = index_dir.path().join(format!("{}.db", keys[0])); // oldest, but current
        enforce_cap_at(index_dir.path(), 1, &keep).unwrap();

        let left: Vec<String> = list_usage_at(index_dir.path()).unwrap().into_iter().map(|u| u.key).collect();
        assert_eq!(left, vec![keys[0].clone()]);
    }

    #[test]
    fn removing_a_repo_keeps_index_while_a_sibling_worktree_remains() {
        let (repo_dir, repo) = init_repo_with_commits();
        let wt_parent = TempDir::new().unwrap();
        let wt_path = wt_parent.path().join("wt");
        repo.worktree("wt", &wt_path, None).unwrap();
        let index_dir = TempDir::new().unwrap();
        let main = repo_dir.path().to_str().unwrap().to_string();
        let wt = wt_path.to_str().unwrap().to_string();
        ensure_index_at(index_dir.path(), &main).unwrap();

        remove_for_repo_at(index_dir.path(), &main, &[wt.clone()]).unwrap();
        assert_eq!(list_usage_at(index_dir.path()).unwrap().len(), 1);

        remove_for_repo_at(index_dir.path(), &wt, &[]).unwrap();
        assert!(list_usage_at(index_dir.path()).unwrap().is_empty());
    }

    #[test]
    fn legacy_index_dir_is_removed() {
        let data = TempDir::new().unwrap();
        std::fs::create_dir_all(data.path().join("index")).unwrap();
        std::fs::write(data.path().join("index").join("old.db"), "x").unwrap();
        std::fs::write(data.path().join("workspace.db"), "keep").unwrap();

        remove_legacy_index(data.path());
        assert!(!data.path().join("index").exists());
        assert!(data.path().join("workspace.db").exists());
    }
}

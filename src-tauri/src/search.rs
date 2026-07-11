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
/// UTF-8 boundary panics. Mirrors the old FTS5 `snippet()` look without
/// relying on FTS5 (which can't do exact substring matches — see the
/// `search_indexed` comment on why this searches literally instead).
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

/// Code being searched is full of characters FTS5's MATCH treats as query
/// syntax (`!`, `||`, `(`, `-`...), so a code snippet can't be handed to
/// MATCH as-is or as a quoted phrase — FTS5's tokenizer strips punctuation
/// from phrases too, turning "!projectId ||" into a match on the bare word
/// "projectId" anywhere. Plain LIKE on the stored text does an exact,
/// literal substring match instead, at the cost of not using the FTS index
/// (acceptable for a per-repo local db — see other v1-simplification notes
/// in this file).
fn search_indexed(
    db_path: &Path,
    query: &str,
    author: Option<&str>,
    since: Option<i64>,
    until: Option<i64>,
) -> Result<Vec<SearchHit>, AppError> {
    let conn = Connection::open(db_path)?;
    let trimmed = query.trim();
    let has_query = !trimmed.is_empty();

    let mut sql = String::from("SELECT oid, summary, author, timestamp, diff_text FROM commits_fts");
    let mut bound: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    let mut clauses: Vec<String> = Vec::new();

    if has_query {
        let i = bound.len() + 1;
        clauses.push(format!("(summary LIKE ?{i} ESCAPE '\\' OR diff_text LIKE ?{i} ESCAPE '\\')"));
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
        let (oid, summary, author, timestamp, diff_text) = r?;
        let snippet = if !has_query {
            summary.clone()
        } else if summary.to_lowercase().contains(&trimmed.to_lowercase()) {
            build_snippet(&summary, trimmed, 40)
        } else {
            build_snippet(&diff_text, trimmed, 40)
        };
        out.push(SearchHit { oid, summary, author, timestamp, snippet });
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

    #[test]
    fn search_with_fts5_special_characters_does_not_error() {
        let (repo_dir, _repo) = init_repo_with_commits();
        let index_dir = TempDir::new().unwrap();
        let repo_path = repo_dir.path().to_str().unwrap();
        ensure_index_at(index_dir.path(), repo_path).unwrap();

        let hits =
            search_commits_at(index_dir.path(), repo_path, "!projectId ||", None, None, None).unwrap();
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
            search_commits_at(index_dir.path(), repo_path, "!projectId ||", None, None, None).unwrap();
        assert_eq!(literal_hits.len(), 1);
        assert!(literal_hits[0].snippet.contains("!projectId ||"), "snippet was: {}", literal_hits[0].snippet);

        let bare_word_hits =
            search_commits_at(index_dir.path(), repo_path, "totallyabsentterm", None, None, None).unwrap();
        assert!(bare_word_hits.is_empty());
    }

    #[test]
    fn search_with_empty_query_returns_all_within_filters() {
        let (repo_dir, _repo) = init_repo_with_commits();
        let index_dir = TempDir::new().unwrap();
        let repo_path = repo_dir.path().to_str().unwrap();
        ensure_index_at(index_dir.path(), repo_path).unwrap();

        let hits = search_commits_at(index_dir.path(), repo_path, "  ", None, None, None).unwrap();
        assert_eq!(hits.len(), 2);
    }

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
}

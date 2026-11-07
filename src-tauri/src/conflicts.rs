use crate::error::AppError;
use git2::{Repository, RepositoryState};
use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictedFile {
    pub path: String,
    /// Human-readable kind, e.g. "both modified" or "deleted by us".
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictState {
    pub files: Vec<ConflictedFile>,
    pub in_progress: bool,
    /// "merge" or "rebase" when an operation is in progress.
    pub operation: Option<String>,
}

fn conflict_status(has_ancestor: bool, has_ours: bool, has_theirs: bool) -> &'static str {
    match (has_ancestor, has_ours, has_theirs) {
        (false, true, true) => "both added",
        (true, true, true) => "both modified",
        (true, false, true) => "deleted by us",
        (true, true, false) => "deleted by them",
        (true, false, false) => "both deleted",
        (false, true, false) => "added by us",
        (false, false, true) => "added by them",
        (false, false, false) => "unmerged",
    }
}

fn operation_of(repo: &Repository) -> Option<&'static str> {
    match repo.state() {
        RepositoryState::Merge => Some("merge"),
        RepositoryState::Rebase
        | RepositoryState::RebaseInteractive
        | RepositoryState::RebaseMerge => Some("rebase"),
        _ => None,
    }
}

fn conflicted_files(repo: &Repository) -> Result<Vec<ConflictedFile>, AppError> {
    let index = repo.index()?;
    if !index.has_conflicts() {
        return Ok(vec![]);
    }
    let mut files = Vec::new();
    for conflict in index.conflicts()? {
        let conflict = conflict?;
        let entry = conflict
            .our
            .as_ref()
            .or(conflict.their.as_ref())
            .or(conflict.ancestor.as_ref());
        let Some(entry) = entry else { continue };
        files.push(ConflictedFile {
            path: String::from_utf8_lossy(&entry.path).to_string(),
            status: conflict_status(
                conflict.ancestor.is_some(),
                conflict.our.is_some(),
                conflict.their.is_some(),
            )
            .to_string(),
        });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

pub fn list_conflicts(repo_path: &str) -> Result<ConflictState, AppError> {
    let repo = Repository::open(repo_path)?;
    let operation = operation_of(&repo);
    Ok(ConflictState {
        files: conflicted_files(&repo)?,
        in_progress: operation.is_some(),
        operation: operation.map(String::from),
    })
}

/// Rejects anything that is not a plain repo-relative path (absolute paths,
/// `..`, prefixes), so a file name can never escape the working directory.
pub fn validate_relative_path(file: &str) -> Result<PathBuf, AppError> {
    if file.is_empty() || file.contains('\0') {
        return Err(AppError::Operation("invalid file path".into()));
    }
    let path = Path::new(file);
    if path.is_absolute() {
        return Err(AppError::Operation("file path must be relative to the repo".into()));
    }
    for c in path.components() {
        match c {
            Component::Normal(_) | Component::CurDir => {}
            _ => return Err(AppError::Operation("file path must stay inside the repo".into())),
        }
    }
    Ok(path.to_path_buf())
}

/// Resolves `file` to an absolute path inside the repo's working directory.
/// The file must be conflicted or tracked in the index.
fn resolve_file(repo: &Repository, file: &str) -> Result<PathBuf, AppError> {
    let rel = validate_relative_path(file)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::Operation("repository has no working directory".into()))?;
    let index = repo.index()?;
    let known = index.get_path(&rel, 0).is_some()
        || conflicted_files(repo)?.iter().any(|f| Path::new(&f.path) == rel);
    if !known {
        return Err(AppError::Operation(format!("{file} is not a tracked or conflicted file")));
    }
    let full = workdir.join(&rel);
    // Guard against symlinks that point outside the repo.
    if let (Ok(canon), Ok(root)) = (full.canonicalize(), workdir.canonicalize()) {
        if !canon.starts_with(&root) {
            return Err(AppError::Operation("file path must stay inside the repo".into()));
        }
    }
    Ok(full)
}

pub fn mark_file_resolved(repo_path: &str, file: &str) -> Result<(), AppError> {
    let repo = Repository::open(repo_path)?;
    let full = resolve_file(&repo, file)?;
    let rel = validate_relative_path(file)?;
    let mut index = repo.index()?;
    if full.exists() {
        index.add_path(&rel)?;
    } else {
        // Resolved by deleting the file.
        for stage in 1..=3 {
            let _ = index.remove(&rel, stage);
        }
        let _ = index.remove_path(&rel);
    }
    index.write()?;
    Ok(())
}

pub fn abort(repo_path: &str) -> Result<(), AppError> {
    let repo = Repository::open(repo_path)?;
    match operation_of(&repo) {
        Some("merge") => {
            let head = repo.head()?.peel(git2::ObjectType::Commit)?;
            repo.reset(&head, git2::ResetType::Hard, None)?;
            repo.cleanup_state()?;
            Ok(())
        }
        Some(_) => {
            let mut rebase = repo.open_rebase(None)?;
            rebase.abort()?;
            Ok(())
        }
        None => Err(AppError::Operation("no merge or rebase in progress".into())),
    }
}

/// Splits `$VISUAL`/`$EDITOR` style strings into program + args without
/// involving a shell.
fn split_editor(cmd: &str) -> Option<(String, Vec<String>)> {
    let mut parts = cmd.split_whitespace().map(String::from);
    let program = parts.next()?;
    Some((program, parts.collect()))
}

fn editor_from_env() -> Option<(String, Vec<String>)> {
    ["VISUAL", "EDITOR"]
        .iter()
        .filter_map(|k| std::env::var(k).ok())
        .find_map(|v| split_editor(&v))
}

fn default_opener(path: &Path) -> Result<Command, AppError> {
    #[cfg(target_os = "macos")]
    {
        let mut c = Command::new("open");
        c.arg("-t").arg(path);
        Ok(c)
    }
    #[cfg(target_os = "windows")]
    {
        // cmd re-parses its arguments, so refuse metacharacters outright.
        let s = path.to_string_lossy();
        if s.chars().any(|ch| "&|<>^%\"".contains(ch)) {
            return Err(AppError::Operation("file path contains unsupported characters".into()));
        }
        let mut c = Command::new("cmd");
        c.args(["/C", "start", ""]).arg(path);
        Ok(c)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let mut c = Command::new("xdg-open");
        c.arg(path);
        Ok(c)
    }
}

pub fn open_file_in_editor(repo_path: &str, file: &str) -> Result<(), AppError> {
    let repo = Repository::open(repo_path)?;
    let full = resolve_file(&repo, file)?;
    let mut cmd = match editor_from_env() {
        Some((program, args)) => {
            let mut c = Command::new(program);
            c.args(args).arg(&full);
            c
        }
        None => default_opener(&full)?,
    };
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| AppError::Operation(format!("could not launch editor: {e}")))?;
    Ok(())
}

async fn blocking<T, F>(f: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
    T: Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(f).await {
        Ok(inner) => inner,
        Err(e) => Err(AppError::Operation(format!("task join error: {e}"))),
    }
}

#[tauri::command]
pub async fn list_conflicted_files(repo_path: String) -> Result<ConflictState, AppError> {
    blocking(move || list_conflicts(&repo_path)).await
}

#[tauri::command]
pub async fn open_in_editor(repo_path: String, file: String) -> Result<(), AppError> {
    blocking(move || open_file_in_editor(&repo_path, &file)).await
}

#[tauri::command]
pub async fn abort_merge(repo_path: String) -> Result<(), AppError> {
    blocking(move || abort(&repo_path)).await
}

#[tauri::command]
pub async fn mark_resolved(repo_path: String, file: String) -> Result<(), AppError> {
    blocking(move || mark_file_resolved(&repo_path, &file)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::init_repo_with_commits;
    use git2::Signature;

    /// main has a.txt = "two"; feature gets a.txt = "three" on top of the
    /// first commit, then feature is merged into main, leaving a conflict.
    fn conflicted_repo() -> (tempfile::TempDir, Repository) {
        let (dir, repo) = init_repo_with_commits();
        let sig = Signature::now("Test User", "test@example.com").unwrap();
        let mut idx = repo.index().unwrap();
        let blob = repo.blob(b"three").unwrap();
        let entry = git2::IndexEntry {
            ctime: git2::IndexTime::new(0, 0),
            mtime: git2::IndexTime::new(0, 0),
            dev: 0,
            ino: 0,
            mode: 0o100644,
            uid: 0,
            gid: 0,
            file_size: 5,
            id: blob,
            flags: 0,
            flags_extended: 0,
            path: b"a.txt".to_vec(),
        };
        let feature_commit = repo
            .find_branch("feature", git2::BranchType::Local)
            .unwrap()
            .get()
            .peel_to_commit()
            .unwrap();
        let mut feature_idx = git2::Index::new().unwrap();
        feature_idx.add(&entry).unwrap();
        let tree = repo.find_tree(feature_idx.write_tree_to(&repo).unwrap()).unwrap();
        let tip = repo
            .commit(Some("refs/heads/feature"), &sig, &sig, "feature edit", &tree, &[&feature_commit])
            .unwrap();
        drop(feature_commit);
        drop(tree);
        idx.read(true).unwrap();
        let annotated = repo.find_annotated_commit(tip).unwrap();
        repo.merge(&[&annotated], None, None).unwrap();
        drop(annotated);
        (dir, repo)
    }

    #[test]
    fn clean_repo_has_no_conflicts_and_nothing_in_progress() {
        let (dir, _repo) = init_repo_with_commits();
        let state = list_conflicts(dir.path().to_str().unwrap()).unwrap();
        assert!(state.files.is_empty());
        assert!(!state.in_progress);
        assert_eq!(state.operation, None);
    }

    #[test]
    fn lists_conflicted_files_during_a_merge() {
        let (dir, _repo) = conflicted_repo();
        let state = list_conflicts(dir.path().to_str().unwrap()).unwrap();
        assert!(state.in_progress);
        assert_eq!(state.operation.as_deref(), Some("merge"));
        assert_eq!(
            state.files,
            vec![ConflictedFile { path: "a.txt".into(), status: "both modified".into() }]
        );
    }

    #[test]
    fn mark_resolved_stages_the_file_and_clears_the_conflict() {
        let (dir, _repo) = conflicted_repo();
        let path = dir.path().to_str().unwrap();
        std::fs::write(dir.path().join("a.txt"), "resolved").unwrap();
        mark_file_resolved(path, "a.txt").unwrap();
        let state = list_conflicts(path).unwrap();
        assert!(state.files.is_empty());
        assert!(state.in_progress);
    }

    #[test]
    fn abort_restores_the_pre_merge_state() {
        let (dir, _repo) = conflicted_repo();
        let path = dir.path().to_str().unwrap();
        abort(path).unwrap();
        let state = list_conflicts(path).unwrap();
        assert!(state.files.is_empty());
        assert!(!state.in_progress);
        assert_eq!(std::fs::read_to_string(dir.path().join("a.txt")).unwrap(), "two");
    }

    #[test]
    fn abort_errors_when_nothing_is_in_progress() {
        let (dir, _repo) = init_repo_with_commits();
        assert!(abort(dir.path().to_str().unwrap()).is_err());
    }

    #[test]
    fn validate_relative_path_accepts_plain_paths() {
        assert!(validate_relative_path("a.txt").is_ok());
        assert!(validate_relative_path("src/deep/b.rs").is_ok());
    }

    #[test]
    fn validate_relative_path_rejects_escapes() {
        assert!(validate_relative_path("").is_err());
        assert!(validate_relative_path("../secret").is_err());
        assert!(validate_relative_path("a/../../secret").is_err());
        assert!(validate_relative_path("/etc/passwd").is_err());
        assert!(validate_relative_path("a\0b").is_err());
    }

    #[test]
    fn resolve_file_rejects_untracked_and_escaping_paths() {
        let (dir, repo) = init_repo_with_commits();
        std::fs::write(dir.path().join("untracked.txt"), "x").unwrap();
        assert!(resolve_file(&repo, "a.txt").is_ok());
        assert!(resolve_file(&repo, "untracked.txt").is_err());
        assert!(resolve_file(&repo, "../outside").is_err());
    }

    #[test]
    fn split_editor_separates_program_and_args_without_a_shell() {
        assert_eq!(
            split_editor("code --wait"),
            Some(("code".to_string(), vec!["--wait".to_string()]))
        );
        assert_eq!(split_editor("   "), None);
    }
}

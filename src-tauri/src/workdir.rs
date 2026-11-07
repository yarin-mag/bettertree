use crate::diff::FileDiff;
use crate::error::AppError;
use git2::{Delta, DiffOptions, Repository, Status, StatusOptions};
use serde::Serialize;
use std::path::Path;

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

/// Diffs a single working-copy file: HEAD-vs-index when `staged`, index-vs-workdir
/// otherwise. Sibling to `get_status`'s v1 simplification — doesn't distinguish a
/// staged delete from a workdir delete, both fall through the unstaged branch.
pub fn get_working_diff(repo_path: &str, file_path: &str, staged: bool) -> Result<FileDiff, AppError> {
    let repo = Repository::open(repo_path)?;
    let mut opts = DiffOptions::new();
    opts.pathspec(file_path);
    opts.include_untracked(true);
    opts.recurse_untracked_dirs(true);

    let index = repo.index()?;
    let diff = if staged {
        let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        repo.diff_tree_to_index(head_tree.as_ref(), Some(&index), Some(&mut opts))?
    } else {
        repo.diff_index_to_workdir(Some(&index), Some(&mut opts))?
    };

    let mut file: Option<FileDiff> = None;
    diff.foreach(
        &mut |delta, _progress| {
            let path = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let status = match delta.status() {
                Delta::Added | Delta::Untracked => "added",
                Delta::Deleted => "deleted",
                Delta::Renamed => "renamed",
                _ => "modified",
            }
            .to_string();
            file = Some(FileDiff {
                path,
                status,
                patch: String::new(),
                old_content: None,
                new_content: None,
                insertions: 0,
                deletions: 0,
                is_binary: false,
            });
            true
        },
        None,
        None,
        None,
    )?;

    let mut file = file.ok_or_else(|| AppError::Operation(format!("no changes found for {file_path}")))?;

    let mut patch = String::new();
    let mut insertions = 0usize;
    let mut deletions = 0usize;
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let origin = line.origin();
        if let Ok(s) = std::str::from_utf8(line.content()) {
            if matches!(origin, '+' | '-' | ' ') {
                patch.push(origin);
            }
            patch.push_str(s);
        }
        match origin {
            '+' => insertions += 1,
            '-' => deletions += 1,
            _ => {}
        }
        true
    })?;
    file.patch = patch;
    file.insertions = insertions;
    file.deletions = deletions;

    file.old_content = if staged {
        repo.head()
            .ok()
            .and_then(|h| h.peel_to_tree().ok())
            .and_then(|t| t.get_path(Path::new(file_path)).ok())
            .and_then(|entry| repo.find_blob(entry.id()).ok())
            .and_then(|blob| std::str::from_utf8(blob.content()).ok().map(|s| s.to_string()))
    } else {
        index
            .get_path(Path::new(file_path), 0)
            .and_then(|entry| repo.find_blob(entry.id).ok())
            .and_then(|blob| std::str::from_utf8(blob.content()).ok().map(|s| s.to_string()))
    };
    file.new_content = if staged {
        index
            .get_path(Path::new(file_path), 0)
            .and_then(|entry| repo.find_blob(entry.id).ok())
            .and_then(|blob| std::str::from_utf8(blob.content()).ok().map(|s| s.to_string()))
    } else {
        std::fs::read_to_string(Path::new(repo_path).join(file_path)).ok()
    };

    Ok(file)
}

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

    #[test]
    fn get_working_diff_unstaged_compares_index_to_workdir() {
        let (dir, _repo) = init_repo_with_commits();
        std::fs::write(dir.path().join("a.txt"), "three").unwrap();
        let repo_path = dir.path().to_str().unwrap();

        let diff = get_working_diff(repo_path, "a.txt", false).unwrap();

        assert_eq!(diff.status, "modified");
        assert_eq!(diff.old_content.as_deref(), Some("two"));
        assert_eq!(diff.new_content.as_deref(), Some("three"));
        assert!(diff.patch.contains("-two"));
        assert!(diff.patch.contains("+three"));
    }

    #[test]
    fn get_working_diff_staged_compares_head_to_index() {
        let (dir, repo) = init_repo_with_commits();
        std::fs::write(dir.path().join("a.txt"), "three").unwrap();
        let repo_path = dir.path().to_str().unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("a.txt")).unwrap();
        index.write().unwrap();

        let diff = get_working_diff(repo_path, "a.txt", true).unwrap();

        assert_eq!(diff.status, "modified");
        assert_eq!(diff.old_content.as_deref(), Some("two"));
        assert_eq!(diff.new_content.as_deref(), Some("three"));
    }

    #[test]
    fn get_working_diff_untracked_file_shows_as_added() {
        let (dir, _repo) = init_repo_with_commits();
        std::fs::write(dir.path().join("new.txt"), "hello").unwrap();
        let repo_path = dir.path().to_str().unwrap();

        let diff = get_working_diff(repo_path, "new.txt", false).unwrap();

        assert_eq!(diff.status, "added");
        assert_eq!(diff.old_content, None);
        assert_eq!(diff.new_content.as_deref(), Some("hello"));
    }
}

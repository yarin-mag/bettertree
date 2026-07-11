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

use crate::error::AppError;
use git2::{Delta, Repository};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLineInfo {
    pub kind: String,
    pub content: String,
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrFileDiff {
    pub path: String,
    pub status: String,
    pub lines: Vec<DiffLineInfo>,
    pub insertions: usize,
    pub deletions: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrDiff {
    pub base_oid: String,
    pub head_oid: String,
    pub files: Vec<PrFileDiff>,
}

/// Resolves a PR's locally-fetched head commit (`fetch_pr_ref` must have run
/// already — it always has, since opening a PR's detail view calls it before
/// anything else). Shared by `diff_pr` and the review-comment-posting command,
/// which needs the head SHA as GitHub's `commit_id` parameter.
pub fn resolve_pr_head_oid(repo_path: &str, number: u64) -> Result<String, AppError> {
    let repo = Repository::open(repo_path)?;
    let head_ref_name = format!("refs/remotes/origin/pr/{number}");
    let commit = repo
        .revparse_single(&head_ref_name)
        .map_err(|_| AppError::Operation(format!("PR #{number}'s head ref isn't fetched locally yet")))?
        .peel_to_commit()?;
    Ok(commit.id().to_string())
}

fn resolve_base_commit<'repo>(repo: &'repo Repository, base_ref_name: &str) -> Result<git2::Commit<'repo>, AppError> {
    let remote_ref = format!("refs/remotes/origin/{base_ref_name}");
    if let Ok(obj) = repo.revparse_single(&remote_ref) {
        return Ok(obj.peel_to_commit()?);
    }
    let obj = repo.revparse_single(base_ref_name).map_err(|_| {
        AppError::Operation(format!("could not resolve base branch '{base_ref_name}' locally"))
    })?;
    Ok(obj.peel_to_commit()?)
}

/// Diffs a PR's head against the merge-base of its base branch (a three-dot
/// diff, same semantics GitHub's own "Files changed" tab uses) — this is
/// what excludes unrelated commits the base branch has picked up since the
/// PR forked, showing only what the PR itself changed.
pub fn diff_pr(repo_path: &str, number: u64, base_ref_name: &str) -> Result<PrDiff, AppError> {
    let repo = Repository::open(repo_path)?;

    let head_ref_name = format!("refs/remotes/origin/pr/{number}");
    let head_commit = repo
        .revparse_single(&head_ref_name)
        .map_err(|_| AppError::Operation(format!("PR #{number}'s head ref isn't fetched locally yet")))?
        .peel_to_commit()?;

    let base_commit = resolve_base_commit(&repo, base_ref_name)?;
    let merge_base_oid = repo.merge_base(base_commit.id(), head_commit.id())?;
    let merge_base_commit = repo.find_commit(merge_base_oid)?;

    let old_tree = merge_base_commit.tree()?;
    let new_tree = head_commit.tree()?;
    let diff = repo.diff_tree_to_tree(Some(&old_tree), Some(&new_tree), None)?;

    let mut files: Vec<PrFileDiff> = Vec::new();
    let mut index_by_path: HashMap<String, usize> = HashMap::new();
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
            index_by_path.insert(path.clone(), files.len());
            files.push(PrFileDiff { path, status, lines: Vec::new(), insertions: 0, deletions: 0 });
            true
        },
        None,
        None,
        None,
    )?;

    diff.print(git2::DiffFormat::Patch, |delta, _hunk, line| {
        if !matches!(line.origin(), '+' | '-' | ' ') {
            return true;
        }
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        if let Some(&idx) = index_by_path.get(&path) {
            let kind = match line.origin() {
                '+' => "add",
                '-' => "del",
                _ => "context",
            };
            match kind {
                "add" => files[idx].insertions += 1,
                "del" => files[idx].deletions += 1,
                _ => {}
            }
            files[idx].lines.push(DiffLineInfo {
                kind: kind.to_string(),
                content: String::from_utf8_lossy(line.content()).trim_end_matches('\n').to_string(),
                old_line: line.old_lineno(),
                new_line: line.new_lineno(),
            });
        }
        true
    })?;

    Ok(PrDiff { base_oid: merge_base_oid.to_string(), head_oid: head_commit.id().to_string(), files })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::init_repo_with_commits;
    use git2::Signature;

    fn make_pr_head(repo: &Repository, dir: &std::path::Path, number: u64) -> (git2::Oid, git2::Oid) {
        let sig = Signature::now("Test User", "test@example.com").unwrap();
        let feature_branch = repo.find_branch("feature", git2::BranchType::Local).unwrap();
        let base_of_pr = feature_branch.get().peel_to_commit().unwrap();

        std::fs::write(dir.join("a.txt"), "one-pr-change").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("a.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let pr_head_oid = repo
            .commit(None, &sig, &sig, "pr change", &tree, &[&base_of_pr])
            .unwrap();
        repo.reference(
            &format!("refs/remotes/origin/pr/{number}"),
            pr_head_oid,
            true,
            "test pr head",
        )
        .unwrap();
        (base_of_pr.id(), pr_head_oid)
    }

    #[test]
    fn diff_pr_diffs_against_the_merge_base_not_the_base_branch_tip() {
        let (dir, repo) = init_repo_with_commits();
        let (merge_base_oid, pr_head_oid) = make_pr_head(&repo, dir.path(), 7);

        let result = diff_pr(dir.path().to_str().unwrap(), 7, "main").unwrap();

        assert_eq!(result.base_oid, merge_base_oid.to_string());
        assert_eq!(result.head_oid, pr_head_oid.to_string());
        assert_eq!(result.files.len(), 1);
        assert_eq!(result.files[0].path, "a.txt");

        let added: Vec<_> = result.files[0].lines.iter().filter(|l| l.kind == "add").collect();
        assert!(added.iter().any(|l| l.content == "one-pr-change"));
        assert!(!result.files[0].lines.iter().any(|l| l.content == "two"));
    }

    #[test]
    fn diff_pr_line_numbers_are_populated() {
        let (dir, repo) = init_repo_with_commits();
        make_pr_head(&repo, dir.path(), 7);

        let result = diff_pr(dir.path().to_str().unwrap(), 7, "main").unwrap();

        let added_line = result.files[0].lines.iter().find(|l| l.kind == "add").unwrap();
        assert_eq!(added_line.new_line, Some(1));
        assert_eq!(added_line.old_line, None);
    }

    #[test]
    fn diff_pr_errors_when_head_ref_not_fetched_locally() {
        let (dir, _repo) = init_repo_with_commits();

        let result = diff_pr(dir.path().to_str().unwrap(), 999, "main");

        assert!(result.is_err());
    }

    #[test]
    fn diff_pr_errors_when_base_branch_does_not_resolve() {
        let (dir, repo) = init_repo_with_commits();
        make_pr_head(&repo, dir.path(), 7);

        let result = diff_pr(dir.path().to_str().unwrap(), 7, "no-such-branch");

        assert!(result.is_err());
    }

    #[test]
    fn resolve_pr_head_oid_returns_the_fetched_heads_sha() {
        let (dir, repo) = init_repo_with_commits();
        let (_merge_base, pr_head_oid) = make_pr_head(&repo, dir.path(), 7);

        let oid = resolve_pr_head_oid(dir.path().to_str().unwrap(), 7).unwrap();

        assert_eq!(oid, pr_head_oid.to_string());
    }

    #[test]
    fn resolve_pr_head_oid_errors_when_not_fetched() {
        let (dir, _repo) = init_repo_with_commits();

        let result = resolve_pr_head_oid(dir.path().to_str().unwrap(), 999);

        assert!(result.is_err());
    }
}

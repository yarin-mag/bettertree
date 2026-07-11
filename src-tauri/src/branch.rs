use crate::error::AppError;
use crate::workdir;
use git2::build::CheckoutBuilder;
use git2::Repository;

pub fn switch_branch(repo_path: &str, branch_name: &str, is_remote: bool) -> Result<(), AppError> {
    let status = workdir::get_status(repo_path)?;
    if !status.is_empty() {
        return Err(AppError::Operation(
            "cannot switch branches with uncommitted changes".into(),
        ));
    }

    let repo = Repository::open(repo_path)?;

    let local_branch_name = if is_remote {
        branch_name.splitn(2, '/').nth(1).unwrap_or(branch_name).to_string()
    } else {
        branch_name.to_string()
    };
    let local_ref_name = format!("refs/heads/{local_branch_name}");

    if is_remote && repo.find_reference(&local_ref_name).is_err() {
        let remote_branch = repo.find_branch(branch_name, git2::BranchType::Remote)?;
        let remote_commit = remote_branch.get().peel_to_commit()?;
        let mut new_branch = repo.branch(&local_branch_name, &remote_commit, false)?;
        new_branch.set_upstream(Some(branch_name))?;
    }

    let obj = repo.revparse_single(&local_ref_name)?;
    repo.checkout_tree(&obj, Some(&mut CheckoutBuilder::new()))?;
    repo.set_head(&local_ref_name)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote;
    use crate::test_support::{init_repo_with_commits, init_repo_with_remote};

    #[test]
    fn switches_to_an_existing_local_branch() {
        let (dir, repo) = init_repo_with_commits();
        let repo_path = dir.path().to_str().unwrap();

        switch_branch(repo_path, "feature", false).unwrap();

        assert_eq!(repo.head().unwrap().shorthand().unwrap(), "feature");
    }

    #[test]
    fn blocks_switch_when_working_tree_is_dirty() {
        let (dir, _repo) = init_repo_with_commits();
        let repo_path = dir.path().to_str().unwrap();
        std::fs::write(dir.path().join("a.txt"), "modified but not staged").unwrap();

        let result = switch_branch(repo_path, "feature", false);

        assert!(result.is_err());
    }

    #[test]
    fn remote_branch_with_no_local_counterpart_creates_and_tracks_one() {
        let (local_dir, _bare_dir, local_repo) = init_repo_with_remote();
        let repo_path = local_dir.path().to_str().unwrap();

        // Push local "feature" to the remote under a different name, then
        // fetch, so refs/remotes/origin/other-branch exists with no local
        // "other-branch" counterpart.
        let feature_branch = local_repo.find_branch("feature", git2::BranchType::Local).unwrap();
        let feature_oid = feature_branch.get().target().unwrap();
        let mut remote_conn = local_repo.find_remote("origin").unwrap();
        let refspec = format!("{}:refs/heads/other-branch", feature_branch.get().name().unwrap());
        remote_conn.push(&[&refspec], None).unwrap();
        remote::fetch(repo_path, "origin").unwrap();

        switch_branch(repo_path, "origin/other-branch", true).unwrap();

        assert_eq!(local_repo.head().unwrap().shorthand().unwrap(), "other-branch");
        assert_eq!(local_repo.head().unwrap().target().unwrap(), feature_oid);
        let new_branch = local_repo.find_branch("other-branch", git2::BranchType::Local).unwrap();
        assert_eq!(new_branch.upstream().unwrap().name().unwrap().unwrap(), "origin/other-branch");
    }

    #[test]
    fn remote_branch_with_existing_local_counterpart_just_switches() {
        let (local_dir, _bare_dir, local_repo) = init_repo_with_remote();
        let repo_path = local_dir.path().to_str().unwrap();
        remote::push(repo_path, "origin").unwrap();
        remote::fetch(repo_path, "origin").unwrap();

        switch_branch(repo_path, "origin/main", true).unwrap();

        assert_eq!(local_repo.head().unwrap().shorthand().unwrap(), "main");
    }
}

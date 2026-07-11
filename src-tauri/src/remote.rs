use crate::error::AppError;
use git2::{Cred, FetchOptions, RemoteCallbacks, Repository};

fn make_callbacks<'a>() -> RemoteCallbacks<'a> {
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(|url, username_from_url, allowed_types| {
        if allowed_types.is_ssh_key() {
            if let Some(username) = username_from_url {
                if let Ok(cred) = Cred::ssh_key_from_agent(username) {
                    return Ok(cred);
                }
            }
        }
        if allowed_types.is_user_pass_plaintext() || allowed_types.is_default() {
            if let Ok(config) = git2::Config::open_default() {
                if let Ok(cred) = Cred::credential_helper(&config, url, username_from_url) {
                    return Ok(cred);
                }
            }
        }
        Err(git2::Error::from_str("no credentials available"))
    });
    callbacks
}

pub fn fetch(repo_path: &str, remote_name: &str) -> Result<(), AppError> {
    let repo = Repository::open(repo_path)?;
    let mut remote = repo.find_remote(remote_name)?;
    let mut opts = FetchOptions::new();
    opts.remote_callbacks(make_callbacks());
    remote.fetch(&[] as &[&str], Some(&mut opts), None)?;
    Ok(())
}

pub fn push(repo_path: &str, remote_name: &str) -> Result<(), AppError> {
    let repo = Repository::open(repo_path)?;
    let mut remote = repo.find_remote(remote_name)?;
    let head_ref = repo.head()?;
    let branch_name = head_ref
        .name()
        .ok_or_else(|| AppError::Operation("HEAD is not a branch".into()))?
        .to_string();
    let refspec = format!("{branch_name}:{branch_name}");
    let mut opts = git2::PushOptions::new();
    opts.remote_callbacks(make_callbacks());
    remote.push(&[refspec.as_str()], Some(&mut opts))?;
    Ok(())
}

pub fn pull(repo_path: &str, remote_name: &str) -> Result<(), AppError> {
    fetch(repo_path, remote_name)?;
    let repo = Repository::open(repo_path)?;
    let head_ref = repo.head()?;
    let branch_name = head_ref
        .shorthand()
        .ok_or_else(|| AppError::Operation("HEAD is not a branch".into()))?
        .to_string();
    let head_ref_name = head_ref
        .name()
        .ok_or_else(|| AppError::Operation("HEAD is not a branch".into()))?
        .to_string();

    let upstream_ref_name = format!("refs/remotes/{remote_name}/{branch_name}");
    let upstream_oid = repo.refname_to_id(&upstream_ref_name)?;
    let upstream_commit = repo.find_annotated_commit(upstream_oid)?;

    let (merge_analysis, _) = repo.merge_analysis(&[&upstream_commit])?;
    if merge_analysis.is_up_to_date() {
        return Ok(());
    }
    if !merge_analysis.is_fast_forward() {
        return Err(AppError::Operation(
            "pull requires a merge; only fast-forward pulls are supported in this version".into(),
        ));
    }

    let mut branch_ref = repo.find_reference(&head_ref_name)?;
    branch_ref.set_target(upstream_oid, "fast-forward pull")?;
    repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::init_repo_with_remote;

    #[test]
    fn fetch_populates_remote_tracking_ref_after_a_push() {
        let (local_dir, bare_dir, local_repo) = init_repo_with_remote();
        let repo_path = local_dir.path().to_str().unwrap();

        // Push directly via git2 (not our own push(), which Task 6 adds)
        // to get content onto the remote for fetch to retrieve.
        let mut remote = local_repo.find_remote("origin").unwrap();
        remote.push(&["refs/heads/main:refs/heads/main"], None).unwrap();

        fetch(repo_path, "origin").unwrap();

        let local_head = local_repo.head().unwrap().target().unwrap();
        let remote_tracking = local_repo.refname_to_id("refs/remotes/origin/main").unwrap();
        assert_eq!(remote_tracking, local_head);

        let bare_repo = git2::Repository::open_bare(bare_dir.path()).unwrap();
        let bare_main = bare_repo.refname_to_id("refs/heads/main").unwrap();
        assert_eq!(bare_main, local_head);
    }

    #[test]
    fn push_updates_the_remote_branch() {
        let (local_dir, bare_dir, local_repo) = init_repo_with_remote();
        let repo_path = local_dir.path().to_str().unwrap();

        push(repo_path, "origin").unwrap();

        let bare_repo = git2::Repository::open_bare(bare_dir.path()).unwrap();
        let bare_main = bare_repo.refname_to_id("refs/heads/main").unwrap();
        let local_head = local_repo.head().unwrap().target().unwrap();
        assert_eq!(bare_main, local_head);
    }

    #[test]
    fn pull_fast_forwards_when_remote_is_ahead() {
        let (local_dir, _bare_dir, local_repo) = init_repo_with_remote();
        let repo_path = local_dir.path().to_str().unwrap();
        push(repo_path, "origin").unwrap();

        // Build a commit ahead of HEAD under a throwaway ref, then push it
        // to the bare remote's main branch directly — simulating another
        // contributor's push without needing a second clone.
        let sig = git2::Signature::now("Test User", "test@example.com").unwrap();
        let head_commit = local_repo.head().unwrap().peel_to_commit().unwrap();
        let tree = head_commit.tree().unwrap();
        let ahead_oid = local_repo
            .commit(Some("refs/tmp/ahead"), &sig, &sig, "third commit", &tree, &[&head_commit])
            .unwrap();

        let mut remote = local_repo.find_remote("origin").unwrap();
        remote.push(&["refs/tmp/ahead:refs/heads/main"], None).unwrap();

        pull(repo_path, "origin").unwrap();

        let local_head = local_repo.head().unwrap().target().unwrap();
        assert_eq!(local_head, ahead_oid);
    }

    #[test]
    fn pull_is_a_no_op_when_already_up_to_date() {
        let (local_dir, _bare_dir, _local_repo) = init_repo_with_remote();
        let repo_path = local_dir.path().to_str().unwrap();
        push(repo_path, "origin").unwrap();

        pull(repo_path, "origin").unwrap();
    }
}

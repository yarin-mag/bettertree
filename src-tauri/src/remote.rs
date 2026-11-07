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

/// Fetches a GitHub pull request's head commit into a local tracking ref
/// (`refs/remotes/<remote_name>/pr/<number>`) so it can be diffed/viewed
/// locally even if the PR branch was never fetched before.
pub fn fetch_pr_ref(repo_path: &str, remote_name: &str, number: u64) -> Result<(), AppError> {
    let repo = Repository::open(repo_path)?;
    let mut remote = repo.find_remote(remote_name)?;
    let mut opts = FetchOptions::new();
    opts.remote_callbacks(make_callbacks());
    let refspec = crate::github::pr_fetch_refspec(remote_name, number);
    remote.fetch(&[refspec.as_str()], Some(&mut opts), None)?;
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
        return merge_upstream(&repo, &upstream_commit, remote_name, &branch_name);
    }

    let mut branch_ref = repo.find_reference(&head_ref_name)?;
    branch_ref.set_target(upstream_oid, "fast-forward pull")?;
    repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))?;
    Ok(())
}

/// Message of the error returned when a pull leaves the repo mid-merge with
/// conflicts; the frontend matches on "merge conflicts" to offer the panel.
pub const PULL_CONFLICT_MESSAGE: &str = "Pull produced merge conflicts";

/// Non-fast-forward pull: merges the upstream commit into HEAD. On conflicts
/// the repo is left mid-merge (MERGE_HEAD set) so the user can resolve them.
fn merge_upstream(
    repo: &Repository,
    upstream_commit: &git2::AnnotatedCommit,
    remote_name: &str,
    branch_name: &str,
) -> Result<(), AppError> {
    repo.merge(&[upstream_commit], None, Some(git2::build::CheckoutBuilder::new().safe()))?;
    let mut index = repo.index()?;
    if index.has_conflicts() {
        return Err(AppError::Operation(PULL_CONFLICT_MESSAGE.into()));
    }
    let sig = repo.signature()?;
    let tree = repo.find_tree(index.write_tree()?)?;
    let head_commit = repo.head()?.peel_to_commit()?;
    let upstream = repo.find_commit(upstream_commit.id())?;
    repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        &format!("Merge remote-tracking branch '{remote_name}/{branch_name}'"),
        &tree,
        &[&head_commit, &upstream],
    )?;
    repo.cleanup_state()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::init_repo_with_remote;

    #[test]
    fn fetch_pr_ref_creates_a_local_tracking_ref_for_the_pr_head() {
        let (local_dir, _bare_dir, local_repo) = init_repo_with_remote();
        let repo_path = local_dir.path().to_str().unwrap();

        // Simulate GitHub's server-side "refs/pull/7/head" by pushing the
        // local repo's current HEAD to that ref name on the bare remote.
        let mut remote = local_repo.find_remote("origin").unwrap();
        remote
            .push(&["refs/heads/main:refs/pull/7/head"], None)
            .unwrap();
        let expected_oid = local_repo.head().unwrap().target().unwrap();

        fetch_pr_ref(repo_path, "origin", 7).unwrap();

        let tracking_ref_oid = local_repo
            .refname_to_id("refs/remotes/origin/pr/7")
            .unwrap();
        assert_eq!(tracking_ref_oid, expected_oid);
    }

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

    /// Commits a tree containing only a.txt = `content` on top of `parent`,
    /// updating `refname` (HEAD, or a throwaway ref to push from).
    fn commit_a_txt(repo: &Repository, refname: &str, content: &str, parent: &git2::Commit) -> git2::Oid {
        let sig = git2::Signature::now("Test User", "test@example.com").unwrap();
        let blob = repo.blob(content.as_bytes()).unwrap();
        let mut tb = repo.treebuilder(None).unwrap();
        tb.insert("a.txt", blob, 0o100644).unwrap();
        let tree = repo.find_tree(tb.write().unwrap()).unwrap();
        repo.commit(Some(refname), &sig, &sig, "edit a.txt", &tree, &[parent]).unwrap()
    }

    #[test]
    fn pull_merges_diverged_branches_without_conflicts() {
        let (local_dir, _bare_dir, local_repo) = init_repo_with_remote();
        let repo_path = local_dir.path().to_str().unwrap();
        push(repo_path, "origin").unwrap();
        let base = local_repo.head().unwrap().peel_to_commit().unwrap();

        // Remote adds an unrelated commit (same tree + b.txt is overkill; an
        // identical-tree commit merges cleanly), local adds its own.
        let sig = git2::Signature::now("Test User", "test@example.com").unwrap();
        let remote_oid = local_repo
            .commit(Some("refs/tmp/ahead"), &sig, &sig, "remote", &base.tree().unwrap(), &[&base])
            .unwrap();
        local_repo
            .find_remote("origin")
            .unwrap()
            .push(&["refs/tmp/ahead:refs/heads/main"], None)
            .unwrap();
        commit_a_txt(&local_repo, "HEAD", "local edit", &base);
        local_repo
            .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();

        pull(repo_path, "origin").unwrap();

        let head = local_repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.parent_count(), 2);
        assert_eq!(head.parent_id(1).unwrap(), remote_oid);
        assert_eq!(local_repo.state(), git2::RepositoryState::Clean);
    }

    #[test]
    fn pull_reports_conflicts_and_leaves_the_repo_mid_merge() {
        let (local_dir, _bare_dir, local_repo) = init_repo_with_remote();
        let repo_path = local_dir.path().to_str().unwrap();
        push(repo_path, "origin").unwrap();
        let base = local_repo.head().unwrap().peel_to_commit().unwrap();

        commit_a_txt(&local_repo, "refs/tmp/ahead", "remote edit", &base);
        local_repo
            .find_remote("origin")
            .unwrap()
            .push(&["refs/tmp/ahead:refs/heads/main"], None)
            .unwrap();
        commit_a_txt(&local_repo, "HEAD", "local edit", &base);
        local_repo
            .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();

        let err = pull(repo_path, "origin").unwrap_err();
        assert!(err.to_string().contains("merge conflicts"));
        assert_eq!(local_repo.state(), git2::RepositoryState::Merge);
        assert!(Repository::open(repo_path).unwrap().index().unwrap().has_conflicts());
    }
}

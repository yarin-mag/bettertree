use crate::error::AppError;
use crate::workdir;
use git2::build::CheckoutBuilder;
use git2::Repository;
use serde::Serialize;

/// Returns the `refs/heads/...` name for `branch_name`, first creating a local
/// branch that tracks it when it only exists on the remote.
fn ensure_local_branch(repo: &Repository, branch_name: &str, is_remote: bool) -> Result<String, AppError> {
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
    Ok(local_ref_name)
}

/// `refs/heads/<name>` for a branch the user picked; a remote branch maps to the
/// local branch of the same name without the remote prefix.
fn local_ref_for(branch_name: &str, is_remote: bool) -> String {
    let local = if is_remote {
        branch_name.splitn(2, '/').nth(1).unwrap_or(branch_name)
    } else {
        branch_name
    };
    format!("refs/heads/{local}")
}

/// Refuses a branch another worktree (the main one or a linked one) already has
/// checked out, like `git switch` does. libgit2 only notices this when it moves
/// HEAD, after the files have already been rewritten, which leaves the working
/// tree half-switched; so this must run before anything is touched.
///
/// Each worktree's HEAD file is read directly, so a worktree whose folder was
/// deleted without `git worktree prune` still counts, as it does for git.
fn ensure_not_checked_out_elsewhere(repo: &Repository, ref_name: &str) -> Result<(), AppError> {
    let branch = ref_name.strip_prefix("refs/heads/").unwrap_or(ref_name);
    let head_ref = |head_file: &std::path::Path| -> Option<String> {
        let text = std::fs::read_to_string(head_file).ok()?;
        text.trim().strip_prefix("ref: ").map(|r| r.trim().to_string())
    };
    let here = std::fs::canonicalize(repo.path()).ok();
    // A linked worktree's git dir has a `commondir` file pointing at the shared one.
    let common = match std::fs::read_to_string(repo.path().join("commondir")) {
        Ok(rel) => {
            let joined = repo.path().join(rel.trim());
            std::fs::canonicalize(&joined).unwrap_or(joined)
        }
        Err(_) => repo.path().to_path_buf(),
    };

    let blocked = |dir: &std::path::Path| -> AppError {
        let gone = !dir.exists();
        let shown = dir.display();
        AppError::Operation(if gone {
            format!(
                "'{branch}' is already checked out in a worktree whose folder is gone ({shown}). Run `git worktree prune` to release it."
            )
        } else {
            format!("'{branch}' is already checked out in another worktree: {shown}")
        })
    };

    // The main working copy, unless the repository is bare or it is this one.
    let common_is_bare = Repository::open(&common).map(|r| r.is_bare()).unwrap_or(true);
    if !common_is_bare && std::fs::canonicalize(&common).ok() != here {
        if head_ref(&common.join("HEAD")).as_deref() == Some(ref_name) {
            let workdir = common.parent().unwrap_or(&common).to_path_buf();
            return Err(blocked(&workdir));
        }
    }

    // Linked worktrees.
    if let Ok(entries) = std::fs::read_dir(common.join("worktrees")) {
        for entry in entries.flatten() {
            let admin = entry.path();
            if std::fs::canonicalize(&admin).ok() == here {
                continue;
            }
            if head_ref(&admin.join("HEAD")).as_deref() == Some(ref_name) {
                let dir = std::fs::read_to_string(admin.join("gitdir"))
                    .ok()
                    .map(|g| std::path::PathBuf::from(g.trim()))
                    .and_then(|git_file| git_file.parent().map(|p| p.to_path_buf()))
                    .unwrap_or(admin);
                return Err(blocked(&dir));
            }
        }
    }
    Ok(())
}

pub fn switch_branch(repo_path: &str, branch_name: &str, is_remote: bool) -> Result<(), AppError> {
    // Before the dirty check: stashing cannot help with a branch that is occupied elsewhere.
    ensure_not_checked_out_elsewhere(&Repository::open(repo_path)?, &local_ref_for(branch_name, is_remote))?;
    let status = workdir::get_status(repo_path)?;
    if !status.is_empty() {
        return Err(AppError::DirtyWorkdir(
            "cannot switch branches with uncommitted changes".into(),
        ));
    }

    let repo = Repository::open(repo_path)?;
    let local_ref_name = ensure_local_branch(&repo, branch_name, is_remote)?;

    let obj = repo.revparse_single(&local_ref_name)?;
    repo.checkout_tree(&obj, Some(&mut CheckoutBuilder::new()))?;
    repo.set_head(&local_ref_name)?;
    Ok(())
}

pub fn checkout_tag(repo_path: &str, tag_name: &str) -> Result<(), AppError> {
    let status = workdir::get_status(repo_path)?;
    if !status.is_empty() {
        return Err(AppError::DirtyWorkdir(
            "cannot checkout a tag with uncommitted changes".into(),
        ));
    }

    let repo = Repository::open(repo_path)?;
    let obj = repo.revparse_single(&format!("refs/tags/{tag_name}"))?;
    let commit = obj.peel(git2::ObjectType::Commit)?;
    repo.checkout_tree(&commit, Some(&mut CheckoutBuilder::new()))?;
    repo.set_head_detached(commit.id())?;
    Ok(())
}

pub fn create_branch(repo_path: &str, branch_name: &str, oid: &str) -> Result<(), AppError> {
    let name = branch_name.trim();
    if name.is_empty() {
        return Err(AppError::Operation("branch name cannot be empty".into()));
    }
    if !git2::Branch::name_is_valid(name)? {
        return Err(AppError::Operation(format!("invalid branch name: {name}")));
    }
    let repo = Repository::open(repo_path)?;
    let commit = repo.find_commit(git2::Oid::from_str(oid)?)?;
    repo.branch(name, &commit, false).map_err(|e| {
        if e.code() == git2::ErrorCode::Exists {
            AppError::Operation(format!("branch '{name}' already exists"))
        } else {
            AppError::Git(e)
        }
    })?;
    Ok(())
}

/// Applies `oid` on top of HEAD as a new commit, keeping the original author.
/// Returns the new commit's oid. Conflicts abort without touching the repo.
pub fn cherry_pick(repo_path: &str, oid: &str) -> Result<String, AppError> {
    let status = workdir::get_status(repo_path)?;
    if !status.is_empty() {
        return Err(AppError::Operation(
            "cannot cherry-pick with uncommitted changes".into(),
        ));
    }

    let repo = Repository::open(repo_path)?;
    if repo.head_detached()? {
        return Err(AppError::Operation("cannot cherry-pick onto a detached HEAD".into()));
    }
    let commit = repo.find_commit(git2::Oid::from_str(oid)?)?;
    let head = repo.head()?.peel_to_commit()?;
    let mainline = if commit.parent_count() > 1 { 1 } else { 0 };

    let mut index = repo.cherrypick_commit(&commit, &head, mainline, None)?;
    if index.has_conflicts() {
        return Err(AppError::Operation(format!(
            "cherry-pick of {} has conflicts; resolve it manually with git",
            &oid[..oid.len().min(7)]
        )));
    }
    let tree = repo.find_tree(index.write_tree_to(&repo)?)?;
    if tree.id() == head.tree_id() {
        return Err(AppError::Operation("cherry-pick would produce an empty commit".into()));
    }
    let committer = repo.signature()?;
    let new_oid = repo.commit(
        Some("HEAD"),
        &commit.author(),
        &committer,
        commit.message().unwrap_or(""),
        &tree,
        &[&head],
    )?;
    repo.checkout_head(Some(CheckoutBuilder::new().force()))?;
    Ok(new_oid.to_string())
}

/// Stashes all uncommitted changes, untracked files included.
pub fn stash_changes(repo_path: &str, message: &str) -> Result<(), AppError> {
    let mut repo = Repository::open(repo_path)?;
    let sig = repo.signature()?;
    repo.stash_save(&sig, message, Some(git2::StashFlags::INCLUDE_UNTRACKED))?;
    Ok(())
}

/// Re-applies and drops the most recent stash.
pub fn stash_pop(repo_path: &str) -> Result<(), AppError> {
    let mut repo = Repository::open(repo_path)?;
    repo.stash_pop(0, None)?;
    Ok(())
}

/// Throws away every uncommitted change, untracked files included.
pub fn discard_changes(repo_path: &str) -> Result<(), AppError> {
    let repo = Repository::open(repo_path)?;
    let head = repo.head()?.peel(git2::ObjectType::Commit)?;
    repo.reset(&head, git2::ResetType::Hard, None)?;
    // A hard reset leaves untracked files behind; sweep them separately.
    repo.checkout_head(Some(CheckoutBuilder::new().force().remove_untracked(true)))?;
    Ok(())
}

/// Checks `branch_name` out in a new worktree at `path`, leaving this one alone.
pub fn add_worktree(
    repo_path: &str,
    branch_name: &str,
    is_remote: bool,
    path: &str,
) -> Result<(), AppError> {
    let target = std::path::Path::new(path);
    if target.exists() {
        return Err(AppError::Operation(format!("{path} already exists")));
    }
    let name = target
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::Operation(format!("invalid worktree path: {path}")))?;

    let repo = Repository::open(repo_path)?;
    ensure_not_checked_out_elsewhere(&repo, &local_ref_for(branch_name, is_remote))?;
    let ref_name = ensure_local_branch(&repo, branch_name, is_remote)?;
    let reference = repo.find_reference(&ref_name)?;
    let mut opts = git2::WorktreeAddOptions::new();
    opts.reference(Some(&reference));
    repo.worktree(name, target, Some(&opts))?;
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AheadBehind {
    pub ahead: u32,
    pub behind: u32,
    pub upstream: String,
}

/// How far the current branch has diverged from its upstream. `None` for a
/// detached or unborn HEAD, or a branch without a configured upstream.
pub fn get_ahead_behind(repo_path: &str) -> Result<Option<AheadBehind>, AppError> {
    let repo = Repository::open(repo_path)?;
    if repo.head_detached()? {
        return Ok(None);
    }
    let head = match repo.head() {
        Ok(h) => h,
        Err(e) if e.code() == git2::ErrorCode::UnbornBranch || e.code() == git2::ErrorCode::NotFound => {
            return Ok(None)
        }
        Err(e) => return Err(e.into()),
    };
    if !head.is_branch() {
        return Ok(None);
    }
    let branch = git2::Branch::wrap(head);
    let upstream = match branch.upstream() {
        Ok(u) => u,
        Err(e) if e.code() == git2::ErrorCode::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let (local_oid, upstream_oid) = match (branch.get().target(), upstream.get().target()) {
        (Some(l), Some(u)) => (l, u),
        _ => return Ok(None),
    };
    let (ahead, behind) = repo.graph_ahead_behind(local_oid, upstream_oid)?;
    let name = upstream.name()?.unwrap_or_default().to_string();
    Ok(Some(AheadBehind { ahead: ahead as u32, behind: behind as u32, upstream: name }))
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

    #[test]
    fn checks_out_a_lightweight_tag_detached() {
        let (dir, repo) = init_repo_with_commits();
        let repo_path = dir.path().to_str().unwrap();
        let head_oid = repo.head().unwrap().target().unwrap();
        let commit_obj = repo.find_object(head_oid, None).unwrap();
        repo.tag_lightweight("v1.0", &commit_obj, false).unwrap();

        checkout_tag(repo_path, "v1.0").unwrap();

        assert!(repo.head_detached().unwrap());
        assert_eq!(repo.head().unwrap().target().unwrap(), head_oid);
    }

    #[test]
    fn checks_out_an_annotated_tag_detached() {
        let (dir, repo) = init_repo_with_commits();
        let repo_path = dir.path().to_str().unwrap();
        let head_oid = repo.head().unwrap().target().unwrap();
        let commit_obj = repo.find_object(head_oid, None).unwrap();
        let sig = repo.signature().unwrap();
        repo.tag("v2.0", &commit_obj, &sig, "release v2.0", false).unwrap();

        checkout_tag(repo_path, "v2.0").unwrap();

        assert!(repo.head_detached().unwrap());
        assert_eq!(repo.head().unwrap().target().unwrap(), head_oid);
    }

    #[test]
    fn blocks_tag_checkout_when_working_tree_is_dirty() {
        let (dir, repo) = init_repo_with_commits();
        let repo_path = dir.path().to_str().unwrap();
        let head_oid = repo.head().unwrap().target().unwrap();
        let commit_obj = repo.find_object(head_oid, None).unwrap();
        repo.tag_lightweight("v1.0", &commit_obj, false).unwrap();
        std::fs::write(dir.path().join("a.txt"), "modified but not staged").unwrap();

        let result = checkout_tag(repo_path, "v1.0");

        assert!(result.is_err());
    }

    fn make_dirty(dir: &std::path::Path) {
        std::fs::write(dir.join("a.txt"), "modified but not staged").unwrap();
        std::fs::write(dir.join("untracked.txt"), "new").unwrap();
    }

    #[test]
    fn dirty_switch_and_tag_checkout_return_a_coded_error() {
        let (dir, repo) = init_repo_with_commits();
        let repo_path = dir.path().to_str().unwrap();
        let head = repo.head().unwrap().target().unwrap();
        repo.tag_lightweight("v1.0", &repo.find_object(head, None).unwrap(), false).unwrap();
        make_dirty(dir.path());

        let e1 = switch_branch(repo_path, "feature", false).unwrap_err();
        let e2 = checkout_tag(repo_path, "v1.0").unwrap_err();

        assert!(matches!(e1, AppError::DirtyWorkdir(_)));
        assert!(matches!(e2, AppError::DirtyWorkdir(_)));
        let json = serde_json::to_value(&e1).unwrap();
        assert_eq!(json["code"], "dirty_workdir");
        assert_eq!(json["message"], "cannot switch branches with uncommitted changes");
    }

    #[test]
    fn other_errors_still_serialize_as_plain_strings() {
        let json = serde_json::to_value(AppError::Operation("nope".into())).unwrap();
        assert_eq!(json, serde_json::json!("nope"));
    }

    #[test]
    fn stash_cleans_the_tree_including_untracked_and_pop_restores_it() {
        let (dir, _repo) = init_repo_with_commits();
        let repo_path = dir.path().to_str().unwrap();
        make_dirty(dir.path());

        stash_changes(repo_path, "bettertree: auto-stash before switching to feature").unwrap();

        assert!(workdir::get_status(repo_path).unwrap().is_empty());
        assert!(!dir.path().join("untracked.txt").exists());
        switch_branch(repo_path, "feature", false).unwrap();
        switch_branch(repo_path, "main", false).unwrap();

        stash_pop(repo_path).unwrap();

        assert_eq!(std::fs::read_to_string(dir.path().join("a.txt")).unwrap(), "modified but not staged");
        assert!(dir.path().join("untracked.txt").exists());
    }

    #[test]
    fn discard_reverts_tracked_and_removes_untracked() {
        let (dir, _repo) = init_repo_with_commits();
        let repo_path = dir.path().to_str().unwrap();
        make_dirty(dir.path());

        discard_changes(repo_path).unwrap();

        assert!(workdir::get_status(repo_path).unwrap().is_empty());
        assert_eq!(std::fs::read_to_string(dir.path().join("a.txt")).unwrap(), "two");
        assert!(!dir.path().join("untracked.txt").exists());
    }

    #[test]
    fn worktree_checks_the_branch_out_elsewhere_and_leaves_changes_alone() {
        let (dir, _repo) = init_repo_with_commits();
        let repo_path = dir.path().to_str().unwrap();
        make_dirty(dir.path());
        let wt_parent = tempfile::TempDir::new().unwrap();
        let wt_path = wt_parent.path().join("wt-feature");

        add_worktree(repo_path, "feature", false, wt_path.to_str().unwrap()).unwrap();

        assert_eq!(std::fs::read_to_string(wt_path.join("a.txt")).unwrap(), "one");
        let wt_repo = Repository::open(&wt_path).unwrap();
        assert_eq!(wt_repo.head().unwrap().shorthand().unwrap(), "feature");
        assert_eq!(std::fs::read_to_string(dir.path().join("a.txt")).unwrap(), "modified but not staged");
    }

    #[test]
    fn worktree_rejects_an_existing_path() {
        let (dir, _repo) = init_repo_with_commits();
        let repo_path = dir.path().to_str().unwrap();
        let wt_parent = tempfile::TempDir::new().unwrap();

        assert!(add_worktree(repo_path, "feature", false, wt_parent.path().to_str().unwrap()).is_err());
    }

    #[test]
    fn creates_a_branch_at_a_commit() {
        let (dir, repo) = init_repo_with_commits();
        let repo_path = dir.path().to_str().unwrap();
        let first = repo.find_branch("feature", git2::BranchType::Local).unwrap().get().target().unwrap();

        create_branch(repo_path, "topic", &first.to_string()).unwrap();

        let topic = repo.find_branch("topic", git2::BranchType::Local).unwrap();
        assert_eq!(topic.get().target().unwrap(), first);
    }

    #[test]
    fn create_branch_rejects_duplicate_and_invalid_names() {
        let (dir, repo) = init_repo_with_commits();
        let repo_path = dir.path().to_str().unwrap();
        let head = repo.head().unwrap().target().unwrap().to_string();

        assert!(create_branch(repo_path, "feature", &head).is_err());
        assert!(create_branch(repo_path, "bad name", &head).is_err());
        assert!(create_branch(repo_path, "  ", &head).is_err());
    }

    #[test]
    fn cherry_picks_a_commit_onto_head() {
        let (dir, repo) = init_repo_with_commits();
        let repo_path = dir.path().to_str().unwrap();
        let second = repo.find_branch("main", git2::BranchType::Local).unwrap().get().peel_to_commit().unwrap();
        // "feature" sits at the first commit; pick main's tip onto it.
        switch_branch(repo_path, "feature", false).unwrap();

        let new_oid = cherry_pick(repo_path, &second.id().to_string()).unwrap();

        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.id().to_string(), new_oid);
        assert_ne!(head.id(), second.id());
        assert_eq!(head.message().unwrap(), "second commit");
        assert_eq!(std::fs::read_to_string(dir.path().join("a.txt")).unwrap(), "two");
    }

    #[test]
    fn cherry_pick_conflict_returns_clear_error_and_leaves_repo_clean() {
        let (dir, repo) = init_repo_with_commits();
        let repo_path = dir.path().to_str().unwrap();
        let sig = git2::Signature::now("Test User", "test@example.com").unwrap();
        // "feature" (at first commit, a.txt="one") gets a divergent edit to a.txt.
        switch_branch(repo_path, "feature", false).unwrap();
        std::fs::write(dir.path().join("a.txt"), "conflicting").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("a.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "conflicting", &tree, &[&parent]).unwrap();
        let main_tip = repo.find_branch("main", git2::BranchType::Local).unwrap().get().target().unwrap();
        let before = repo.head().unwrap().target().unwrap();

        let err = cherry_pick(repo_path, &main_tip.to_string()).unwrap_err();

        assert!(err.to_string().contains("conflict"));
        assert_eq!(repo.head().unwrap().target().unwrap(), before);
        assert!(workdir::get_status(repo_path).unwrap().is_empty());
    }

    #[test]
    fn cherry_pick_blocked_when_dirty() {
        let (dir, repo) = init_repo_with_commits();
        let repo_path = dir.path().to_str().unwrap();
        let feature = repo.find_branch("feature", git2::BranchType::Local).unwrap().get().target().unwrap();
        std::fs::write(dir.path().join("a.txt"), "dirty").unwrap();

        assert!(cherry_pick(repo_path, &feature.to_string()).is_err());
    }

    fn commit_on_head(repo: &Repository, dir: &std::path::Path, file: &str, msg: &str) {
        let sig = git2::Signature::now("Test User", "test@example.com").unwrap();
        std::fs::write(dir.join(file), msg).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(file)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &[&parent]).unwrap();
    }

    /// Pushes main to origin, fetches, and tracks origin/main.
    fn track_origin_main(repo: &Repository, path: &str) {
        let mut remote_conn = repo.find_remote("origin").unwrap();
        remote_conn.push(&["refs/heads/main:refs/heads/main"], None).unwrap();
        remote::fetch(path, "origin").unwrap();
        repo.find_branch("main", git2::BranchType::Local)
            .unwrap()
            .set_upstream(Some("origin/main"))
            .unwrap();
    }

    #[test]
    fn ahead_behind_is_zero_when_in_sync() {
        let (dir, _bare, repo) = init_repo_with_remote();
        let path = dir.path().to_str().unwrap();
        track_origin_main(&repo, path);
        let r = get_ahead_behind(path).unwrap().unwrap();
        assert_eq!(r, AheadBehind { ahead: 0, behind: 0, upstream: "origin/main".into() });
    }

    #[test]
    fn ahead_only() {
        let (dir, _bare, repo) = init_repo_with_remote();
        let path = dir.path().to_str().unwrap();
        track_origin_main(&repo, path);
        commit_on_head(&repo, dir.path(), "c.txt", "local one");
        commit_on_head(&repo, dir.path(), "d.txt", "local two");
        let r = get_ahead_behind(path).unwrap().unwrap();
        assert_eq!((r.ahead, r.behind), (2, 0));
    }

    #[test]
    fn behind_only() {
        let (dir, _bare, repo) = init_repo_with_remote();
        let path = dir.path().to_str().unwrap();
        track_origin_main(&repo, path);
        let parent = repo.head().unwrap().peel_to_commit().unwrap().parent(0).unwrap();
        repo.reset(parent.as_object(), git2::ResetType::Hard, None).unwrap();
        let r = get_ahead_behind(path).unwrap().unwrap();
        assert_eq!((r.ahead, r.behind), (0, 1));
    }

    #[test]
    fn ahead_and_behind() {
        let (dir, _bare, repo) = init_repo_with_remote();
        let path = dir.path().to_str().unwrap();
        track_origin_main(&repo, path);
        let parent = repo.head().unwrap().peel_to_commit().unwrap().parent(0).unwrap();
        repo.reset(parent.as_object(), git2::ResetType::Hard, None).unwrap();
        commit_on_head(&repo, dir.path(), "c.txt", "diverged");
        let r = get_ahead_behind(path).unwrap().unwrap();
        assert_eq!((r.ahead, r.behind), (1, 1));
    }

    #[test]
    fn no_upstream_is_none() {
        let (dir, _bare, _repo) = init_repo_with_remote();
        assert_eq!(get_ahead_behind(dir.path().to_str().unwrap()).unwrap(), None);
    }

    #[test]
    fn detached_head_is_none() {
        let (dir, _bare, repo) = init_repo_with_remote();
        let path = dir.path().to_str().unwrap();
        track_origin_main(&repo, path);
        let oid = repo.head().unwrap().target().unwrap();
        repo.set_head_detached(oid).unwrap();
        assert_eq!(get_ahead_behind(path).unwrap(), None);
    }

    #[test]
    fn unborn_head_is_none() {
        let dir = tempfile::TempDir::new().unwrap();
        Repository::init(dir.path()).unwrap();
        assert_eq!(get_ahead_behind(dir.path().to_str().unwrap()).unwrap(), None);
    }

    /// Mirrors a real setup: a bare repo with linked worktrees, one of them the repo opened in the app.
    fn bare_with_worktree() -> (tempfile::TempDir, std::path::PathBuf, Repository) {
        let (src_dir, _src) = init_repo_with_commits();
        let root = tempfile::TempDir::new().unwrap();
        let bare_path = root.path().join("client.git");
        let bare = git2::build::RepoBuilder::new()
            .bare(true)
            .clone(src_dir.path().to_str().unwrap(), &bare_path)
            .unwrap();
        // the clone only has main as a local branch; make feature local too
        let feature_commit = bare
            .find_branch("origin/feature", git2::BranchType::Remote)
            .ok()
            .map(|b| b.get().peel_to_commit().unwrap());
        if let Some(c) = &feature_commit {
            bare.branch("feature", c, false).unwrap();
        }
        drop(feature_commit);
        let wt_path = root.path().join("staging");
        {
            let main_ref = bare.find_reference("refs/heads/main").unwrap();
            let mut opts = git2::WorktreeAddOptions::new();
            opts.reference(Some(&main_ref));
            bare.worktree("staging", &wt_path, Some(&opts)).unwrap();
        }
        (root, wt_path, bare)
    }

    /// A bare repo with one linked worktree ("staging", on main) -- the layout of a
    /// bare-clone-plus-worktrees setup.
    #[test]
    fn stash_then_switch_works_inside_a_linked_worktree_of_a_bare_repo() {
        let (_root, wt, _bare) = bare_with_worktree();
        let path = wt.to_str().unwrap();
        std::fs::write(wt.join("a.txt"), "modified").unwrap();
        std::fs::write(wt.join("new.txt"), "untracked").unwrap();

        stash_changes(path, "bettertree: test").unwrap();
        assert!(workdir::get_status(path).unwrap().is_empty());
        switch_branch(path, "feature", false).unwrap();
        stash_pop(path).unwrap();
    }

    fn occupy_feature_in_another_worktree(root: &tempfile::TempDir, bare: &Repository) -> std::path::PathBuf {
        let other = root.path().join("other-wt");
        let f = bare.find_reference("refs/heads/feature").unwrap();
        let mut opts = git2::WorktreeAddOptions::new();
        opts.reference(Some(&f));
        bare.worktree("other", &other, Some(&opts)).unwrap();
        other
    }

    #[test]
    fn switch_refuses_a_branch_checked_out_in_another_worktree_and_leaves_the_tree_untouched() {
        let (root, wt, bare) = bare_with_worktree();
        let other = occupy_feature_in_another_worktree(&root, &bare);
        let path = wt.to_str().unwrap();

        let err = switch_branch(path, "feature", false).unwrap_err();

        match &err {
            AppError::Operation(m) => {
                assert!(m.contains("already checked out"), "message was: {m}");
                assert!(m.contains("feature"), "message was: {m}");
                assert!(m.contains("other-wt"), "should name the worktree, was: {m}");
            }
            other => panic!("expected an Operation error, got {other:?}"),
        }
        let repo = Repository::open(&wt).unwrap();
        assert_eq!(repo.head().unwrap().shorthand(), Some("main"));
        assert_eq!(std::fs::read_to_string(wt.join("a.txt")).unwrap(), "two");
        assert!(workdir::get_status(path).unwrap().is_empty());
        let _ = other;
    }

    #[test]
    fn the_occupied_check_comes_before_the_dirty_check() {
        let (root, wt, bare) = bare_with_worktree();
        occupy_feature_in_another_worktree(&root, &bare);
        std::fs::write(wt.join("a.txt"), "dirty").unwrap();

        let err = switch_branch(wt.to_str().unwrap(), "feature", false).unwrap_err();

        assert!(matches!(err, AppError::Operation(_)), "got {err:?}");
    }

    #[test]
    fn switch_refuses_the_branch_checked_out_in_the_main_worktree() {
        let (dir, _repo) = init_repo_with_commits(); // main worktree is on main
        let root = tempfile::TempDir::new().unwrap();
        let wt = root.path().join("wt");
        add_worktree(dir.path().to_str().unwrap(), "feature", false, wt.to_str().unwrap()).unwrap();

        let err = switch_branch(wt.to_str().unwrap(), "main", false).unwrap_err();

        assert!(matches!(&err, AppError::Operation(m) if m.contains("already checked out")), "got {err:?}");
    }

    #[test]
    fn a_missing_but_still_registered_worktree_still_blocks_the_branch() {
        let (root, wt, bare) = bare_with_worktree();
        let other = occupy_feature_in_another_worktree(&root, &bare);
        std::fs::remove_dir_all(&other).unwrap(); // deleted without `git worktree prune`

        let err = switch_branch(wt.to_str().unwrap(), "feature", false).unwrap_err();

        assert!(matches!(&err, AppError::Operation(m) if m.contains("already checked out") && m.contains("prune")), "got {err:?}");
        assert_eq!(std::fs::read_to_string(wt.join("a.txt")).unwrap(), "two");
    }

    #[test]
    fn switching_to_the_branch_you_are_already_on_is_not_blocked() {
        let (_root, wt, _bare) = bare_with_worktree();
        switch_branch(wt.to_str().unwrap(), "main", false).unwrap();
    }

    #[test]
    fn a_new_worktree_for_an_occupied_branch_gets_the_same_clear_error() {
        let (root, wt, bare) = bare_with_worktree();
        occupy_feature_in_another_worktree(&root, &bare);
        let target = root.path().join("third");

        let err = add_worktree(wt.to_str().unwrap(), "feature", false, target.to_str().unwrap()).unwrap_err();

        assert!(matches!(&err, AppError::Operation(m) if m.contains("already checked out")), "got {err:?}");
        assert!(!target.exists());
    }
}

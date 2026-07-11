#![cfg(test)]

use git2::{Repository, RepositoryInitOptions, Signature};
use std::path::Path;
use tempfile::TempDir;

/// Builds a repo with two commits on "main" and a "feature" branch
/// pointing at the first commit.
pub fn init_repo_with_commits() -> (TempDir, Repository) {
    let dir = TempDir::new().unwrap();
    let mut opts = RepositoryInitOptions::new();
    opts.initial_head("main");
    let repo = Repository::init_opts(dir.path(), &opts).unwrap();
    let sig = Signature::now("Test User", "test@example.com").unwrap();

    let commit1 = {
        std::fs::write(dir.path().join("a.txt"), "one").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("a.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "first commit", &tree, &[])
            .unwrap()
    };

    {
        std::fs::write(dir.path().join("a.txt"), "two").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("a.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let parent = repo.find_commit(commit1).unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "second commit", &tree, &[&parent])
            .unwrap();
    }

    {
        let parent = repo.find_commit(commit1).unwrap();
        repo.branch("feature", &parent, false).unwrap();
    }

    (dir, repo)
}

/// Builds on init_repo_with_commits by adding a commit on "feature" and
/// merging it into "main", producing a commit with two parents.
pub fn init_repo_with_commits_and_merge() -> (TempDir, Repository) {
    let (dir, repo) = init_repo_with_commits();
    let sig = Signature::now("Test User", "test@example.com").unwrap();

    let feature_tip_oid = {
        let feature_branch = repo.find_branch("feature", git2::BranchType::Local).unwrap();
        let feature_commit = feature_branch.get().peel_to_commit().unwrap();

        std::fs::write(dir.path().join("b.txt"), "feature work").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("b.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        repo.commit(
            Some("refs/heads/feature"),
            &sig,
            &sig,
            "feature commit",
            &tree,
            &[&feature_commit],
        )
        .unwrap()
    };

    {
        let main_tip = repo.head().unwrap().peel_to_commit().unwrap();
        let feature_tip = repo.find_commit(feature_tip_oid).unwrap();
        // Re-stage a.txt (from main) alongside b.txt (from feature) to
        // simulate a clean merge tree without needing a real merge/checkout.
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("a.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            "merge feature",
            &tree,
            &[&main_tip, &feature_tip],
        )
        .unwrap();
    }

    (dir, repo)
}

/// A local repo with two commits (from init_repo_with_commits) plus a
/// bare "remote" repo registered as its "origin", with nothing pushed
/// yet — the starting point for fetch/pull/push tests.
pub fn init_repo_with_remote() -> (TempDir, TempDir, Repository) {
    let (local_dir, local_repo) = init_repo_with_commits();
    let bare_dir = TempDir::new().unwrap();
    Repository::init_bare(bare_dir.path()).unwrap();
    local_repo
        .remote("origin", bare_dir.path().to_str().unwrap())
        .unwrap();
    (local_dir, bare_dir, local_repo)
}

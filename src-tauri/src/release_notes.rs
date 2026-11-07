use crate::error::AppError;
use git2::{Repository, Sort};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNoteCommit {
    pub oid: String,
    pub subject: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseTag {
    pub name: String,
    pub oid: String,
    pub timestamp: i64,
}

/// Newest tag matching the glob `pattern` (all tags when empty) that is HEAD or
/// an ancestor of HEAD. Annotated tags are dated by tagger, lightweight tags
/// by their commit; ties go to the greater name.
pub fn latest_release_tag(repo_path: &str, pattern: &str) -> Result<Option<ReleaseTag>, AppError> {
    let repo = Repository::open(repo_path)?;
    let head = match repo.head() {
        Ok(h) => match h.peel_to_commit() {
            Ok(c) => c.id(),
            Err(_) => return Ok(None),
        },
        Err(e) if e.code() == git2::ErrorCode::UnbornBranch || e.code() == git2::ErrorCode::NotFound => {
            return Ok(None)
        }
        Err(e) => return Err(e.into()),
    };

    let pattern = pattern.trim();
    let names = repo.tag_names(if pattern.is_empty() { None } else { Some(pattern) })?;
    let mut best: Option<ReleaseTag> = None;
    for name in names.iter().flatten() {
        let Ok(obj) = repo.revparse_single(&format!("refs/tags/{name}")) else { continue };
        let Ok(commit) = obj.peel_to_commit() else { continue };
        let reachable =
            commit.id() == head || repo.graph_descendant_of(head, commit.id()).unwrap_or(false);
        if !reachable {
            continue;
        }
        let timestamp = match obj.as_tag().and_then(|t| t.tagger()) {
            Some(sig) => sig.when().seconds(),
            None => commit.time().seconds(),
        };
        let better = match &best {
            None => true,
            Some(b) => (timestamp, name) > (b.timestamp, b.name.as_str()),
        };
        if better {
            best = Some(ReleaseTag { name: name.to_string(), oid: commit.id().to_string(), timestamp });
        }
    }
    Ok(best)
}

/// Non-merge commits reachable from `to` but not from `from`, oldest first.
pub fn release_notes_commits(
    repo_path: &str,
    from: &str,
    to: &str,
) -> Result<Vec<ReleaseNoteCommit>, AppError> {
    let repo = Repository::open(repo_path)?;
    let from_oid = repo.revparse_single(from)?.peel_to_commit()?.id();
    let to_oid = repo.revparse_single(to)?.peel_to_commit()?.id();

    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::REVERSE)?;
    walk.push(to_oid)?;
    walk.hide(from_oid)?;

    let mut out = Vec::new();
    for oid in walk {
        let commit = repo.find_commit(oid?)?;
        if commit.parent_count() > 1 {
            continue;
        }
        out.push(ReleaseNoteCommit {
            oid: commit.id().to_string(),
            subject: commit.summary().unwrap_or_default().to_string(),
            timestamp: commit.time().seconds(),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{init_repo_with_commits, init_repo_with_commits_and_merge};
    use git2::Repository;

    fn commit_on_head(repo: &Repository, dir: &std::path::Path, file: &str, msg: &str) -> String {
        let sig = git2::Signature::now("Test User", "test@example.com").unwrap();
        std::fs::write(dir.join(file), msg).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(file)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &[&parent]).unwrap().to_string()
    }

    fn subjects(v: &[ReleaseNoteCommit]) -> Vec<&str> {
        v.iter().map(|c| c.subject.as_str()).collect()
    }

    #[test]
    fn lists_commits_after_from_up_to_and_including_to_oldest_first() {
        let (dir, repo) = init_repo_with_commits();
        let path = dir.path().to_str().unwrap();
        let from = repo.head().unwrap().target().unwrap().to_string(); // "second commit"
        commit_on_head(&repo, dir.path(), "c.txt", "third");
        let to = commit_on_head(&repo, dir.path(), "d.txt", "fourth");

        let got = release_notes_commits(path, &from, &to).unwrap();

        assert_eq!(subjects(&got), vec!["third", "fourth"]);
        assert_eq!(got[1].oid, to);
    }

    #[test]
    fn excludes_the_from_commit_itself() {
        let (dir, repo) = init_repo_with_commits();
        let path = dir.path().to_str().unwrap();
        let head = repo.head().unwrap().target().unwrap().to_string();

        assert!(release_notes_commits(path, &head, &head).unwrap().is_empty());
    }

    #[test]
    fn skips_merge_commits_but_keeps_merged_work() {
        let (dir, repo) = init_repo_with_commits_and_merge();
        let path = dir.path().to_str().unwrap();
        let first = repo.head().unwrap().peel_to_commit().unwrap().parent(0).unwrap().parent(0).unwrap();
        let to = repo.head().unwrap().target().unwrap().to_string();

        let got = release_notes_commits(path, &first.id().to_string(), &to).unwrap();

        let mut s = subjects(&got);
        s.sort();
        assert_eq!(s, vec!["feature commit", "second commit"]);
    }

    #[test]
    fn rejects_an_unknown_ref() {
        let (dir, repo) = init_repo_with_commits();
        let path = dir.path().to_str().unwrap();
        let head = repo.head().unwrap().target().unwrap().to_string();

        assert!(release_notes_commits(path, "deadbeef", &head).is_err());
    }

    fn sig_at(secs: i64) -> git2::Signature<'static> {
        git2::Signature::new("T", "t@example.com", &git2::Time::new(secs, 0)).unwrap()
    }

    fn annotated(repo: &Repository, name: &str, target: git2::Oid, secs: i64) {
        let obj = repo.find_object(target, None).unwrap();
        repo.tag(name, &obj, &sig_at(secs), "release", false).unwrap();
    }

    fn lightweight(repo: &Repository, name: &str, target: git2::Oid) {
        let obj = repo.find_object(target, None).unwrap();
        repo.tag_lightweight(name, &obj, false).unwrap();
    }

    fn commit_on_head_at(repo: &Repository, dir: &std::path::Path, file: &str, msg: &str, secs: i64) -> git2::Oid {
        std::fs::write(dir.join(file), msg).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(file)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        let sig = sig_at(secs);
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &[&parent]).unwrap()
    }

    fn first_commit(repo: &Repository) -> git2::Oid {
        repo.head().unwrap().peel_to_commit().unwrap().parent(0).unwrap().id()
    }

    fn name_of(t: Option<ReleaseTag>) -> Option<String> {
        t.map(|t| t.name)
    }

    #[test]
    fn picks_the_newest_matching_tag_by_tagger_date() {
        let (dir, repo) = init_repo_with_commits();
        let first = first_commit(&repo);
        annotated(&repo, "rel-1", first, 1000);
        annotated(&repo, "rel-2", first, 2000);
        let got = latest_release_tag(dir.path().to_str().unwrap(), "").unwrap().unwrap();
        assert_eq!(got.name, "rel-2");
        assert_eq!(got.oid, first.to_string());
        assert_eq!(got.timestamp, 2000);
    }

    #[test]
    fn the_pattern_filters_and_empty_means_any() {
        let (dir, repo) = init_repo_with_commits();
        let first = first_commit(&repo);
        annotated(&repo, "beta-1", first, 3000);
        annotated(&repo, "rel-1", first, 2000);
        let path = dir.path().to_str().unwrap();
        assert_eq!(name_of(latest_release_tag(path, "rel-*").unwrap()), Some("rel-1".into()));
        assert_eq!(name_of(latest_release_tag(path, "").unwrap()), Some("beta-1".into()));
        assert_eq!(name_of(latest_release_tag(path, "  ").unwrap()), Some("beta-1".into()));
    }

    #[test]
    fn matches_tag_names_that_contain_slashes() {
        let (dir, repo) = init_repo_with_commits();
        annotated(&repo, "archive/0.95", first_commit(&repo), 1000);
        annotated(&repo, "other", first_commit(&repo), 2000);
        let path = dir.path().to_str().unwrap();
        assert_eq!(name_of(latest_release_tag(path, "archive/*").unwrap()), Some("archive/0.95".into()));
    }

    #[test]
    fn ignores_tags_on_commits_that_are_not_in_heads_history() {
        let (dir, repo) = init_repo_with_commits();
        let first = repo.find_commit(first_commit(&repo)).unwrap();
        // a commit on no branch, not an ancestor of HEAD
        let tree = first.tree().unwrap();
        let stray = repo
            .commit(None, &sig_at(9999), &sig_at(9999), "stray", &tree, &[&first])
            .unwrap();
        annotated(&repo, "stray-tag", stray, 9999);
        annotated(&repo, "real", first.id(), 1000);
        let path = dir.path().to_str().unwrap();
        assert_eq!(name_of(latest_release_tag(path, "").unwrap()), Some("real".into()));
    }

    #[test]
    fn a_tag_on_head_itself_counts() {
        let (dir, repo) = init_repo_with_commits();
        let head = repo.head().unwrap().target().unwrap();
        annotated(&repo, "at-head", head, 1000);
        let got = latest_release_tag(dir.path().to_str().unwrap(), "").unwrap().unwrap();
        assert_eq!((got.name.as_str(), got.oid), ("at-head", head.to_string()));
    }

    #[test]
    fn lightweight_tags_are_dated_by_their_commit() {
        let (dir, repo) = init_repo_with_commits();
        let a = commit_on_head_at(&repo, dir.path(), "a.txt", "a", 100);
        let b = commit_on_head_at(&repo, dir.path(), "b.txt", "b", 200);
        lightweight(&repo, "lw-a", a);
        lightweight(&repo, "lw-b", b);
        let got = latest_release_tag(dir.path().to_str().unwrap(), "lw-*").unwrap().unwrap();
        assert_eq!((got.name.as_str(), got.timestamp), ("lw-b", 200));
    }

    #[test]
    fn equal_dates_go_to_the_greater_name() {
        let (dir, repo) = init_repo_with_commits();
        let first = first_commit(&repo);
        annotated(&repo, "v1", first, 1000);
        annotated(&repo, "v2", first, 1000);
        assert_eq!(name_of(latest_release_tag(dir.path().to_str().unwrap(), "").unwrap()), Some("v2".into()));
    }

    #[test]
    fn a_tag_that_does_not_point_at_a_commit_is_skipped() {
        let (dir, repo) = init_repo_with_commits();
        let tree_id = repo.head().unwrap().peel_to_commit().unwrap().tree_id();
        let tree_obj = repo.find_object(tree_id, None).unwrap();
        repo.tag("tree-tag", &tree_obj, &sig_at(9000), "not a commit", false).unwrap();
        annotated(&repo, "real", first_commit(&repo), 1000);
        assert_eq!(name_of(latest_release_tag(dir.path().to_str().unwrap(), "").unwrap()), Some("real".into()));
    }

    #[test]
    fn none_without_matches_and_for_an_unborn_head() {
        let (dir, _repo) = init_repo_with_commits();
        assert_eq!(latest_release_tag(dir.path().to_str().unwrap(), "").unwrap(), None);

        let empty = tempfile::TempDir::new().unwrap();
        Repository::init(empty.path()).unwrap();
        assert_eq!(latest_release_tag(empty.path().to_str().unwrap(), "").unwrap(), None);
    }

    #[test]
    fn works_on_a_detached_head() {
        let (dir, repo) = init_repo_with_commits();
        let first = first_commit(&repo);
        annotated(&repo, "rel-1", first, 1000);
        repo.set_head_detached(repo.head().unwrap().target().unwrap()).unwrap();
        assert_eq!(name_of(latest_release_tag(dir.path().to_str().unwrap(), "").unwrap()), Some("rel-1".into()));
    }
}

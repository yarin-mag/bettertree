use crate::error::AppError;
use crate::graph::{build_graph_commits, GraphCommit};
use git2::{Repository, Sort};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub oid: String,
    pub summary: String,
    pub author: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareResult {
    pub base_oid: String,
    pub compare_oid: String,
    pub merge_base_oid: Option<String>,
    pub only_in_base: Vec<CommitSummary>,
    pub only_in_compare: Vec<CommitSummary>,
    pub graph: Vec<GraphCommit>,
}

fn resolve_ref<'repo>(repo: &'repo Repository, ref_name: &str) -> Result<git2::Commit<'repo>, AppError> {
    let obj = repo
        .revparse_single(ref_name)
        .map_err(|_| AppError::Operation(format!("ref '{ref_name}' not found")))?;
    Ok(obj.peel_to_commit()?)
}

fn walk_summaries(
    repo: &Repository,
    tip: git2::Oid,
    hide: Option<git2::Oid>,
) -> Result<Vec<CommitSummary>, AppError> {
    let mut revwalk = repo.revwalk()?;
    revwalk.push(tip)?;
    if let Some(h) = hide {
        revwalk.hide(h)?;
    }
    revwalk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;

    let mut out = Vec::new();
    for oid_result in revwalk {
        let oid = oid_result?;
        let commit = repo.find_commit(oid)?;
        out.push(CommitSummary {
            oid: oid.to_string(),
            summary: commit.summary().unwrap_or("").to_string(),
            author: commit.author().name().unwrap_or("").to_string(),
            timestamp: commit.time().seconds(),
        });
    }
    Ok(out)
}

pub fn compare_refs(repo_path: &str, base_ref: &str, compare_ref: &str) -> Result<CompareResult, AppError> {
    let repo = Repository::open(repo_path)?;
    let base_commit = resolve_ref(&repo, base_ref)?;
    let compare_commit = resolve_ref(&repo, compare_ref)?;
    let base_oid = base_commit.id();
    let compare_oid = compare_commit.id();

    // `.ok()`, not `?` — two refs with unrelated histories are a legitimate
    // repo state (not an error): we just don't hide anything below, so each
    // side's full reachable history comes back instead of a bounded diff.
    let merge_base_oid = repo.merge_base(base_oid, compare_oid).ok();

    let only_in_base = walk_summaries(&repo, base_oid, merge_base_oid)?;
    let only_in_compare = walk_summaries(&repo, compare_oid, merge_base_oid)?;

    let mut combined_revwalk = repo.revwalk()?;
    combined_revwalk.push(base_oid)?;
    combined_revwalk.push(compare_oid)?;
    if let Some(mb) = merge_base_oid {
        combined_revwalk.hide(mb)?;
    }
    combined_revwalk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
    let graph = build_graph_commits(&repo, combined_revwalk)?;

    Ok(CompareResult {
        base_oid: base_oid.to_string(),
        compare_oid: compare_oid.to_string(),
        merge_base_oid: merge_base_oid.map(|o| o.to_string()),
        only_in_base,
        only_in_compare,
        graph,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::init_repo_with_commits;
    use git2::Signature;

    /// Adds one commit onto the existing "feature" branch (which
    /// `init_repo_with_commits` points at the shared root, one commit
    /// behind "main") so both branches have exactly one unique commit.
    fn add_feature_commit(repo: &Repository, dir: &std::path::Path) -> git2::Oid {
        let sig = Signature::now("Test User", "test@example.com").unwrap();
        let feature_branch = repo.find_branch("feature", git2::BranchType::Local).unwrap();
        let parent = feature_branch.get().peel_to_commit().unwrap();

        std::fs::write(dir.join("c.txt"), "feature-only").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("c.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let oid = repo
            .commit(
                Some("refs/heads/feature"),
                &sig,
                &sig,
                "feature commit",
                &tree,
                &[&parent],
            )
            .unwrap();
        oid
    }

    #[test]
    fn compare_refs_finds_commits_unique_to_each_side() {
        let (dir, repo) = init_repo_with_commits();
        add_feature_commit(&repo, dir.path());

        let result = compare_refs(dir.path().to_str().unwrap(), "main", "feature").unwrap();

        assert_eq!(result.only_in_base.len(), 1);
        assert_eq!(result.only_in_base[0].summary, "second commit");
        assert_eq!(result.only_in_compare.len(), 1);
        assert_eq!(result.only_in_compare[0].summary, "feature commit");
    }

    #[test]
    fn compare_refs_returns_empty_both_ways_for_identical_refs() {
        let (dir, _repo) = init_repo_with_commits();

        let result = compare_refs(dir.path().to_str().unwrap(), "main", "main").unwrap();

        assert!(result.only_in_base.is_empty());
        assert!(result.only_in_compare.is_empty());
        assert_eq!(result.merge_base_oid, Some(result.base_oid.clone()));
    }

    #[test]
    fn compare_refs_handles_unrelated_histories_without_panicking() {
        let (dir, repo) = init_repo_with_commits();
        let sig = Signature::now("Test User", "test@example.com").unwrap();

        // An orphan commit (no parents) on its own ref — shares no history
        // with "main" at all.
        std::fs::write(dir.path().join("orphan.txt"), "orphan").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("orphan.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let orphan_oid = repo.commit(None, &sig, &sig, "orphan root", &tree, &[]).unwrap();
        repo.reference("refs/heads/orphan", orphan_oid, true, "test orphan branch")
            .unwrap();

        let result = compare_refs(dir.path().to_str().unwrap(), "main", "orphan").unwrap();

        assert_eq!(result.merge_base_oid, None);
        // No common ancestor to hide anything at, so each side's full
        // reachable history comes back.
        assert_eq!(result.only_in_base.len(), 2); // "second commit", "first commit"
        assert_eq!(result.only_in_compare.len(), 1); // "orphan root"
    }

    #[test]
    fn compare_refs_errors_when_a_ref_does_not_resolve() {
        let (dir, _repo) = init_repo_with_commits();

        let result = compare_refs(dir.path().to_str().unwrap(), "main", "no-such-branch");

        assert!(result.is_err());
    }

    #[test]
    fn compare_refs_graph_field_covers_both_sides_with_distinct_lanes() {
        let (dir, repo) = init_repo_with_commits();
        add_feature_commit(&repo, dir.path());

        let result = compare_refs(dir.path().to_str().unwrap(), "main", "feature").unwrap();

        assert_eq!(result.graph.len(), 2);
        let summaries: Vec<&str> = result.graph.iter().map(|c| c.summary.as_str()).collect();
        assert!(summaries.contains(&"second commit"));
        assert!(summaries.contains(&"feature commit"));
        let lanes: std::collections::HashSet<usize> = result.graph.iter().map(|c| c.lane).collect();
        assert_eq!(lanes.len(), 2, "the two divergent commits must sit in different lanes");
    }
}

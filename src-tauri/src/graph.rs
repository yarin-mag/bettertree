use crate::error::AppError;
use git2::{Repository, Sort};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub parent_oid: String,
    pub parent_lane: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCommit {
    pub oid: String,
    pub summary: String,
    pub author: String,
    pub timestamp: i64,
    pub lane: usize,
    pub edges: Vec<GraphEdge>,
    pub active_lanes: Vec<bool>,
}

pub fn get_commit_graph(repo_path: &str, limit: usize) -> Result<Vec<GraphCommit>, AppError> {
    let repo = Repository::open(repo_path)?;
    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;

    // lanes[i] holds the oid this lane is waiting to see next, or None if free.
    let mut lanes: Vec<Option<String>> = Vec::new();
    let mut out = Vec::new();

    for oid_result in revwalk.take(limit) {
        let oid = oid_result?;
        let commit = repo.find_commit(oid)?;
        let oid_str = oid.to_string();

        let lane = match lanes
            .iter()
            .position(|slot| slot.as_deref() == Some(oid_str.as_str()))
        {
            Some(idx) => idx,
            None => match lanes.iter().position(|slot| slot.is_none()) {
                Some(idx) => idx,
                None => {
                    lanes.push(None);
                    lanes.len() - 1
                }
            },
        };

        let parent_count = commit.parent_count();
        let mut edges = Vec::new();

        if parent_count == 0 {
            lanes[lane] = None;
        } else {
            for i in 0..parent_count {
                let parent_oid = commit.parent_id(i)?.to_string();
                if i == 0 {
                    lanes[lane] = Some(parent_oid.clone());
                    edges.push(GraphEdge {
                        parent_oid,
                        parent_lane: lane,
                    });
                } else {
                    let parent_lane = match lanes
                        .iter()
                        .position(|slot| slot.as_deref() == Some(parent_oid.as_str()))
                    {
                        Some(idx) => idx,
                        None => match lanes.iter().position(|slot| slot.is_none()) {
                            Some(idx) => {
                                lanes[idx] = Some(parent_oid.clone());
                                idx
                            }
                            None => {
                                lanes.push(Some(parent_oid.clone()));
                                lanes.len() - 1
                            }
                        },
                    };
                    edges.push(GraphEdge {
                        parent_oid,
                        parent_lane,
                    });
                }
            }
        }

        let active_lanes: Vec<bool> = lanes.iter().map(|slot| slot.is_some()).collect();

        let author = commit.author();
        out.push(GraphCommit {
            oid: oid_str,
            summary: commit.summary().unwrap_or("").to_string(),
            author: author.name().unwrap_or("").to_string(),
            timestamp: commit.time().seconds(),
            lane,
            edges,
            active_lanes,
        });
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{init_repo_with_commits, init_repo_with_commits_and_merge};

    #[test]
    fn graph_edge_serializes_with_camel_case_keys() {
        let edge = GraphEdge { parent_oid: "abc".into(), parent_lane: 2 };
        let json = serde_json::to_string(&edge).unwrap();
        assert!(json.contains("\"parentOid\""), "json was: {json}");
        assert!(json.contains("\"parentLane\""), "json was: {json}");
    }

    #[test]
    fn graph_commit_serializes_with_camel_case_keys() {
        let commit = GraphCommit {
            oid: "abc".into(),
            summary: "test".into(),
            author: "Test".into(),
            timestamp: 0,
            lane: 0,
            edges: vec![],
            active_lanes: vec![true],
        };
        let json = serde_json::to_string(&commit).unwrap();
        assert!(json.contains("\"activeLanes\""), "json was: {json}");
    }

    #[test]
    fn linear_history_stays_in_single_lane() {
        let (dir, _repo) = init_repo_with_commits();
        let graph = get_commit_graph(dir.path().to_str().unwrap(), 10).unwrap();
        assert_eq!(graph.len(), 2);
        assert!(graph.iter().all(|c| c.lane == 0));
        assert_eq!(graph[0].summary, "second commit");
        assert_eq!(graph[1].summary, "first commit");
        // "second commit" has a parent, so lane 0 stays occupied afterward.
        assert_eq!(graph[0].active_lanes, vec![true]);
        // "first commit" is the root — it clears its own lane.
        assert_eq!(graph[1].active_lanes, vec![false]);
    }

    #[test]
    fn merge_commit_has_two_parent_edges() {
        let (dir, _repo) = init_repo_with_commits_and_merge();
        let graph = get_commit_graph(dir.path().to_str().unwrap(), 10).unwrap();
        let merge_commit = graph
            .iter()
            .find(|c| c.summary == "merge feature")
            .expect("merge commit present");
        assert_eq!(merge_commit.edges.len(), 2);
        // Both parents get their own lane, both occupied after this row.
        assert_eq!(merge_commit.active_lanes, vec![true, true]);
    }

    #[test]
    fn active_lanes_reflects_pass_through_lanes_in_a_branch_and_merge_history() {
        let (dir, _repo) = init_repo_with_commits_and_merge();
        let graph = get_commit_graph(dir.path().to_str().unwrap(), 10).unwrap();

        let feature_commit_row = graph
            .iter()
            .find(|c| c.summary == "feature commit")
            .expect("feature commit present");

        // main's lane (0) is still active here even though this row's own
        // commit sits on lane 1 — proves pass-through data is exposed, not
        // just the current commit's own lane.
        assert!(feature_commit_row.active_lanes[0]);
        assert!(feature_commit_row.active_lanes[1]);
    }

    #[test]
    fn respects_limit() {
        let (dir, _repo) = init_repo_with_commits();
        let graph = get_commit_graph(dir.path().to_str().unwrap(), 1).unwrap();
        assert_eq!(graph.len(), 1);
    }
}

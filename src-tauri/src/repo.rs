use crate::error::AppError;
use git2::{BranchType, Repository};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub is_remote: bool,
    pub is_head: bool,
    pub target_oid: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagInfo {
    pub name: String,
    pub target_oid: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchListResult {
    pub branches: Vec<BranchInfo>,
    pub head_detached: bool,
    pub head_oid: Option<String>,
}

pub fn list_branches(repo_path: &str) -> Result<BranchListResult, AppError> {
    let repo = Repository::open(repo_path)?;
    let head_ref = repo.head().ok();
    let head_name = head_ref
        .as_ref()
        .and_then(|h| h.shorthand())
        .map(|s| s.to_string());
    let head_detached = repo.head_detached().unwrap_or(false);
    let head_oid = head_ref.as_ref().and_then(|h| h.target()).map(|o| o.to_string());

    let mut branches = Vec::new();
    for branch_result in repo.branches(None)? {
        let (branch, branch_type) = branch_result?;
        let name = branch.name()?.unwrap_or("").to_string();
        let is_remote = branch_type == BranchType::Remote;
        let target_oid = branch
            .get()
            .target()
            .map(|o| o.to_string())
            .unwrap_or_default();
        let is_head = !is_remote && head_name.as_deref() == Some(name.as_str());
        branches.push(BranchInfo {
            name,
            is_remote,
            is_head,
            target_oid,
        });
    }
    Ok(BranchListResult {
        branches,
        head_detached,
        head_oid,
    })
}

pub fn list_tags(repo_path: &str) -> Result<Vec<TagInfo>, AppError> {
    let repo = Repository::open(repo_path)?;
    let mut out = Vec::new();
    repo.tag_foreach(|oid, name_bytes| {
        let name = String::from_utf8_lossy(name_bytes)
            .trim_start_matches("refs/tags/")
            .to_string();
        out.push(TagInfo {
            name,
            target_oid: oid.to_string(),
        });
        true
    })?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::init_repo_with_commits;

    #[test]
    fn branch_info_serializes_with_camel_case_keys() {
        let info = BranchInfo {
            name: "main".into(),
            is_remote: false,
            is_head: true,
            target_oid: "abc".into(),
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"isRemote\""), "json was: {json}");
        assert!(json.contains("\"isHead\""), "json was: {json}");
        assert!(json.contains("\"targetOid\""), "json was: {json}");
    }

    #[test]
    fn lists_local_and_remote_branches_with_head_flag() {
        let (dir, _repo) = init_repo_with_commits();
        let result = list_branches(dir.path().to_str().unwrap()).unwrap();
        let names: Vec<&str> = result.branches.iter().map(|b| b.name.as_str()).collect();
        assert!(names.contains(&"main"));
        assert!(names.contains(&"feature"));

        let head_branch = result.branches.iter().find(|b| b.is_head).unwrap();
        assert_eq!(head_branch.name, "main");
        assert!(!head_branch.is_remote);
        assert!(!result.head_detached);
    }

    #[test]
    fn reports_detached_head_with_no_branch_marked_as_head() {
        let (dir, repo) = init_repo_with_commits();
        let repo_path = dir.path().to_str().unwrap();
        let head_oid = repo.head().unwrap().target().unwrap();
        repo.set_head_detached(head_oid).unwrap();

        let result = list_branches(repo_path).unwrap();

        assert!(result.head_detached);
        assert_eq!(result.head_oid, Some(head_oid.to_string()));
        assert!(result.branches.iter().all(|b| !b.is_head));
    }

    #[test]
    fn lists_tags() {
        let (dir, repo) = init_repo_with_commits();
        let head_oid = repo.head().unwrap().target().unwrap();
        repo.tag_lightweight("v1.0", &repo.find_object(head_oid, None).unwrap(), false)
            .unwrap();

        let tags = list_tags(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].name, "v1.0");
    }
}

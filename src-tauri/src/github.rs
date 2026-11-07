use crate::error::AppError;
use serde::Deserialize;

/// Abstraction over invoking the `gh` CLI, so callers can be tested without
/// shelling out to a real `gh` binary.
pub trait GhRunner {
    /// Runs `gh <args>`, returning stdout on success (exit code 0).
    fn run(&self, args: &[&str]) -> Result<String, AppError>;
}

/// Real `GhRunner` that shells out to the `gh` binary on PATH.
pub struct SystemGhRunner;

impl GhRunner for SystemGhRunner {
    fn run(&self, args: &[&str]) -> Result<String, AppError> {
        let output = std::process::Command::new("gh")
            .args(args)
            .output()
            .map_err(|e| AppError::Operation(format!("failed to run gh: {e}")))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Operation(format!(
                "gh {} failed: {}",
                args.join(" "),
                stderr.trim()
            )));
        }
        String::from_utf8(output.stdout)
            .map_err(|e| AppError::Operation(format!("gh output was not utf8: {e}")))
    }
}

/// Returns the current `gh` auth token, or an error if `gh` is missing or
/// the user isn't logged in.
pub fn auth_token(runner: &dyn GhRunner) -> Result<String, AppError> {
    let output = runner.run(&["auth", "token"])?;
    Ok(output.trim().to_string())
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
struct GhAuthorJson {
    login: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
struct GhLabelJson {
    name: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
struct GhCheckJson {
    #[serde(default)]
    conclusion: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    state: Option<String>,
}

/// Classifies a single check run / status context as "failure", "pending" or
/// "success" from its `{conclusion, status}` (CheckRun) or `{state}`
/// (StatusContext) fields.
pub(crate) fn check_state(
    conclusion: Option<&str>,
    status: Option<&str>,
    state: Option<&str>,
) -> &'static str {
    let resolved = conclusion
        .map(str::to_string)
        .or_else(|| match status {
            Some("COMPLETED") | None => None,
            Some(_) => Some("PENDING".to_string()),
        })
        .or_else(|| state.map(str::to_string))
        .unwrap_or_else(|| "PENDING".to_string())
        .to_uppercase();
    match resolved.as_str() {
        "FAILURE" | "CANCELLED" | "TIMED_OUT" | "ACTION_REQUIRED" | "ERROR" | "STARTUP_FAILURE" => "failure",
        "SUCCESS" | "NEUTRAL" | "SKIPPED" => "success",
        _ => "pending",
    }
}

/// Collapses a PR's individual check runs / status contexts (as `gh`
/// reports them — a mix of `{status, conclusion}` CheckRun objects and
/// `{state}` StatusContext objects) into a single overall rollup, the way
/// GitHub's UI does. `None` means the PR has no checks at all.
fn compute_status_rollup(checks: &[GhCheckJson]) -> Option<String> {
    if checks.is_empty() {
        return None;
    }
    let mut has_failure = false;
    let mut has_pending = false;
    for check in checks {
        match check_state(check.conclusion.as_deref(), check.status.as_deref(), check.state.as_deref()) {
            "failure" => has_failure = true,
            "pending" => has_pending = true,
            _ => {}
        }
    }
    Some(if has_failure {
        "failure".to_string()
    } else if has_pending {
        "pending".to_string()
    } else {
        "success".to_string()
    })
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
struct GhPullRequestJson {
    number: u64,
    title: String,
    author: GhAuthorJson,
    #[serde(rename = "headRefName")]
    head_ref_name: String,
    #[serde(rename = "baseRefName")]
    base_ref_name: String,
    state: String,
    #[serde(rename = "isDraft")]
    is_draft: bool,
    labels: Vec<GhLabelJson>,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    url: String,
    #[serde(default, rename = "statusCheckRollup")]
    status_check_rollup: Vec<GhCheckJson>,
    #[serde(default, rename = "reviewDecision")]
    review_decision: Option<String>,
}

/// A pull request as surfaced to the frontend.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    pub author: String,
    pub head_ref_name: String,
    pub base_ref_name: String,
    pub state: String,
    pub is_draft: bool,
    pub labels: Vec<String>,
    pub updated_at: String,
    pub url: String,
    /// Overall CI status ("success" | "pending" | "failure"), or `None` if
    /// the PR has no checks at all.
    pub status_check_rollup: Option<String>,
    /// GitHub's review-decision string (e.g. "APPROVED",
    /// "CHANGES_REQUESTED", "REVIEW_REQUIRED"), or `None` if unreviewed.
    pub review_decision: Option<String>,
}

impl From<GhPullRequestJson> for PullRequest {
    fn from(json: GhPullRequestJson) -> Self {
        PullRequest {
            number: json.number,
            title: json.title,
            author: json.author.login,
            head_ref_name: json.head_ref_name,
            base_ref_name: json.base_ref_name,
            state: json.state,
            is_draft: json.is_draft,
            labels: json.labels.into_iter().map(|l| l.name).collect(),
            updated_at: json.updated_at,
            url: json.url,
            status_check_rollup: compute_status_rollup(&json.status_check_rollup),
            review_decision: json.review_decision,
        }
    }
}

const PR_LIST_JSON_FIELDS: &str =
    "number,title,author,headRefName,baseRefName,state,isDraft,labels,updatedAt,url,statusCheckRollup,reviewDecision";

/// `gh pr list --search` silently defaults to `--state open` whenever the
/// query has no `is:`/`state:` qualifier of its own. The frontend's State
/// filter writes a `state:all` sentinel (not a real GitHub search qualifier)
/// to ask for every state; this strips that sentinel out of the search
/// string and reports whether `--state all` should be passed separately.
fn extract_state_all(query: &str) -> (String, bool) {
    let mut found = false;
    let remaining: Vec<&str> = query
        .split_whitespace()
        .filter(|token| {
            if *token == "state:all" {
                found = true;
                false
            } else {
                true
            }
        })
        .collect();
    (remaining.join(" "), found)
}

/// Lists/searches pull requests in `owner/repo` matching the given GitHub
/// search-qualifier query string (e.g. "is:open author:foo base:main").
pub fn list_pull_requests(
    runner: &dyn GhRunner,
    owner: &str,
    repo: &str,
    query: &str,
) -> Result<Vec<PullRequest>, AppError> {
    let repo_arg = format!("{owner}/{repo}");
    let (search_query, state_all) = extract_state_all(query);
    let mut args = vec!["pr", "list", "--repo", repo_arg.as_str(), "--search", search_query.as_str()];
    if state_all {
        args.push("--state");
        args.push("all");
    }
    args.push("--json");
    args.push(PR_LIST_JSON_FIELDS);
    let output = runner.run(&args)?;
    let parsed: Vec<GhPullRequestJson> = serde_json::from_str(&output)
        .map_err(|e| AppError::Operation(format!("failed to parse gh pr list output: {e}")))?;
    Ok(parsed.into_iter().map(PullRequest::from).collect())
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
struct GhCommitJson {
    oid: String,
    #[serde(rename = "messageHeadline")]
    message_headline: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
struct GhPullRequestDetailJson {
    #[serde(flatten)]
    pr: GhPullRequestJson,
    commits: Vec<GhCommitJson>,
    body: String,
}

/// A single commit belonging to a pull request.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestCommit {
    pub oid: String,
    pub message_headline: String,
}

/// A pull request plus its commit list, as returned by `gh pr view`.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestDetail {
    pub pull_request: PullRequest,
    pub commits: Vec<PullRequestCommit>,
    pub body: String,
}

const PR_VIEW_JSON_FIELDS: &str =
    "number,title,author,headRefName,baseRefName,state,isDraft,labels,updatedAt,url,statusCheckRollup,reviewDecision,commits,body";

/// Fetches a single pull request's details and commit list.
pub fn pr_detail(
    runner: &dyn GhRunner,
    owner: &str,
    repo: &str,
    number: u64,
) -> Result<PullRequestDetail, AppError> {
    let repo_arg = format!("{owner}/{repo}");
    let number_arg = number.to_string();
    let output = runner.run(&[
        "pr",
        "view",
        &number_arg,
        "--repo",
        &repo_arg,
        "--json",
        PR_VIEW_JSON_FIELDS,
    ])?;
    let parsed: GhPullRequestDetailJson = serde_json::from_str(&output)
        .map_err(|e| AppError::Operation(format!("failed to parse gh pr view output: {e}")))?;
    Ok(PullRequestDetail {
        pull_request: PullRequest::from(parsed.pr),
        commits: parsed
            .commits
            .into_iter()
            .map(|c| PullRequestCommit {
                oid: c.oid,
                message_headline: c.message_headline,
            })
            .collect(),
        body: parsed.body,
    })
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
struct GhCommentUserJson {
    login: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
struct GhCommentJson {
    id: u64,
    user: GhCommentUserJson,
    body: String,
    created_at: String,
    html_url: String,
}

/// A single comment on a pull request's Conversation tab.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrComment {
    pub id: u64,
    pub author: String,
    pub body: String,
    pub created_at: String,
    pub url: String,
}

impl From<GhCommentJson> for PrComment {
    fn from(json: GhCommentJson) -> Self {
        PrComment {
            id: json.id,
            author: json.user.login,
            body: json.body,
            created_at: json.created_at,
            url: json.html_url,
        }
    }
}

/// Lists a pull request's top-level (Conversation-tab) comments.
pub fn list_pr_comments(
    runner: &dyn GhRunner,
    owner: &str,
    repo: &str,
    number: u64,
) -> Result<Vec<PrComment>, AppError> {
    let endpoint = format!("repos/{owner}/{repo}/issues/{number}/comments");
    let output = runner.run(&["api", &endpoint, "--paginate"])?;
    let parsed: Vec<GhCommentJson> = serde_json::from_str(&output)
        .map_err(|e| AppError::Operation(format!("failed to parse gh pr comments output: {e}")))?;
    Ok(parsed.into_iter().map(PrComment::from).collect())
}

/// Posts a new top-level comment on a pull request, returning the created comment.
pub fn add_pr_comment(
    runner: &dyn GhRunner,
    owner: &str,
    repo: &str,
    number: u64,
    body: &str,
) -> Result<PrComment, AppError> {
    let endpoint = format!("repos/{owner}/{repo}/issues/{number}/comments");
    let body_arg = format!("body={body}");
    let output = runner.run(&["api", &endpoint, "-X", "POST", "-f", &body_arg])?;
    let parsed: GhCommentJson = serde_json::from_str(&output)
        .map_err(|e| AppError::Operation(format!("failed to parse gh add pr comment output: {e}")))?;
    Ok(PrComment::from(parsed))
}

#[derive(Debug, Clone, Deserialize)]
struct GhReviewCommentJson {
    id: u64,
    user: GhCommentUserJson,
    body: String,
    created_at: String,
    path: String,
    line: Option<u32>,
    original_line: Option<u32>,
    side: String,
    html_url: String,
}

/// A single GitHub-style review comment, anchored to a specific line of a
/// specific file's diff.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrReviewComment {
    pub id: u64,
    pub author: String,
    pub body: String,
    pub created_at: String,
    pub path: String,
    pub line: u32,
    pub side: String,
    pub url: String,
}

/// Lists a pull request's inline review comments (Files-changed-tab).
/// Comments whose diff position has gone stale enough that GitHub reports
/// neither `line` nor `original_line` are dropped — they can't be anchored
/// to a line in the current diff anyway.
pub fn list_pr_review_comments(
    runner: &dyn GhRunner,
    owner: &str,
    repo: &str,
    number: u64,
) -> Result<Vec<PrReviewComment>, AppError> {
    let endpoint = format!("repos/{owner}/{repo}/pulls/{number}/comments");
    let output = runner.run(&["api", &endpoint, "--paginate"])?;
    let parsed: Vec<GhReviewCommentJson> = serde_json::from_str(&output)
        .map_err(|e| AppError::Operation(format!("failed to parse gh pr review comments output: {e}")))?;
    Ok(parsed
        .into_iter()
        .filter_map(|json| {
            let line = json.line.or(json.original_line)?;
            Some(PrReviewComment {
                id: json.id,
                author: json.user.login,
                body: json.body,
                created_at: json.created_at,
                path: json.path,
                line,
                side: json.side,
                url: json.html_url,
            })
        })
        .collect())
}

/// Posts a new review comment anchored to a single line. `commit_id` must be
/// the PR's current head SHA (resolved by the caller via
/// `pr_diff::resolve_pr_head_oid`, not passed in from the frontend).
#[allow(clippy::too_many_arguments)]
pub fn add_pr_review_comment(
    runner: &dyn GhRunner,
    owner: &str,
    repo: &str,
    number: u64,
    commit_id: &str,
    path: &str,
    line: u32,
    side: &str,
    body: &str,
) -> Result<PrReviewComment, AppError> {
    let endpoint = format!("repos/{owner}/{repo}/pulls/{number}/comments");
    let body_arg = format!("body={body}");
    let commit_arg = format!("commit_id={commit_id}");
    let path_arg = format!("path={path}");
    let line_arg = format!("line={line}");
    let side_arg = format!("side={side}");
    let output = runner.run(&[
        "api", &endpoint, "-X", "POST",
        "-f", &body_arg,
        "-f", &commit_arg,
        "-f", &path_arg,
        "-F", &line_arg,
        "-f", &side_arg,
    ])?;
    let parsed: GhReviewCommentJson = serde_json::from_str(&output)
        .map_err(|e| AppError::Operation(format!("failed to parse gh add review comment output: {e}")))?;
    let line = parsed.line.or(parsed.original_line).unwrap_or(line);
    Ok(PrReviewComment {
        id: parsed.id,
        author: parsed.user.login,
        body: parsed.body,
        created_at: parsed.created_at,
        path: parsed.path,
        line,
        side: parsed.side,
        url: parsed.html_url,
    })
}

/// Resolves the local repo's origin remote to a github.com (owner, repo),
/// erroring with a user-facing message if origin isn't a GitHub remote.
pub fn resolve_owner_repo(repo_path: &str) -> Result<(String, String), AppError> {
    origin_owner_repo(repo_path)?.ok_or_else(|| {
        AppError::Operation(
            "origin remote is not a GitHub repository — PR features are unavailable".into(),
        )
    })
}

/// The refspec that fetches a PR's head commit into a local tracking ref
/// (`refs/remotes/<remote_name>/pr/<number>`), the way GitHub exposes PR
/// heads under `refs/pull/<number>/head` server-side.
pub fn pr_fetch_refspec(remote_name: &str, number: u64) -> String {
    format!("pull/{number}/head:refs/remotes/{remote_name}/pr/{number}")
}

/// Whether GitHub-backed features (PR search/list) are usable for this repo
/// right now, and why not if not.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubStatus {
    pub available: bool,
    pub owner: Option<String>,
    pub repo: Option<String>,
    pub reason: Option<String>,
}

/// Checks whether the repo's origin is a GitHub remote and `gh` is
/// authenticated, combining both into a single status the frontend can use
/// to enable/disable PR features and show why.
pub fn github_status(runner: &dyn GhRunner, repo_path: &str) -> GithubStatus {
    let (owner, repo) = match resolve_owner_repo(repo_path) {
        Ok(pair) => pair,
        Err(e) => {
            return GithubStatus {
                available: false,
                owner: None,
                repo: None,
                reason: Some(e.to_string()),
            }
        }
    };
    match auth_token(runner) {
        Ok(_) => GithubStatus {
            available: true,
            owner: Some(owner),
            repo: Some(repo),
            reason: None,
        },
        Err(e) => GithubStatus {
            available: false,
            owner: Some(owner),
            repo: Some(repo),
            reason: Some(e.to_string()),
        },
    }
}

/// Lists every branch on the GitHub repo (not just ones fetched locally),
/// so base-branch filtering can offer any real target branch.
pub fn list_branches(runner: &dyn GhRunner, owner: &str, repo: &str) -> Result<Vec<String>, AppError> {
    let endpoint = format!("repos/{owner}/{repo}/branches");
    let output = runner.run(&["api", &endpoint, "--paginate", "--jq", ".[].name"])?;
    Ok(output.lines().map(str::trim).filter(|l| !l.is_empty()).map(String::from).collect())
}

#[derive(Debug, Clone, serde::Serialize, Deserialize, PartialEq)]
pub struct CommitPullRequest {
    pub number: u64,
    pub title: String,
    pub url: String,
}

/// Lists the pull requests that contain the given commit (GitHub's
/// "commits/{sha}/pulls" endpoint), oldest first.
pub fn list_commit_pull_requests(
    runner: &dyn GhRunner,
    owner: &str,
    repo: &str,
    oid: &str,
) -> Result<Vec<CommitPullRequest>, AppError> {
    let endpoint = format!("repos/{owner}/{repo}/commits/{oid}/pulls");
    let output = runner.run(&[
        "api",
        &endpoint,
        "--jq",
        "[.[] | {number, title, url: .html_url}]",
    ])?;
    let mut prs: Vec<CommitPullRequest> = serde_json::from_str(output.trim())
        .map_err(|e| AppError::Operation(format!("failed to parse pull requests: {e}")))?;
    prs.sort_by_key(|pr| pr.number);
    Ok(prs)
}

/// Lists users who can be assigned issues/PRs in the repo — used as a
/// stand-in "possible people" list for author/assignee/reviewer filters,
/// since PR authors and reviewers are practically always collaborators too.
pub fn list_assignable_users(runner: &dyn GhRunner, owner: &str, repo: &str) -> Result<Vec<String>, AppError> {
    let endpoint = format!("repos/{owner}/{repo}/assignees");
    let output = runner.run(&["api", &endpoint, "--paginate", "--jq", ".[].login"])?;
    Ok(output.lines().map(str::trim).filter(|l| !l.is_empty()).map(String::from).collect())
}

/// Parses a git remote URL into (owner, repo) if it points at github.com.
/// Supports https, ssh://, and scp-style (git@github.com:owner/repo) forms,
/// with or without a trailing ".git".
pub fn parse_github_owner_repo(url: &str) -> Option<(String, String)> {
    let path = if let Some(rest) = url.strip_prefix("https://github.com/") {
        rest
    } else if let Some(rest) = url.strip_prefix("http://github.com/") {
        rest
    } else if let Some(rest) = url.strip_prefix("ssh://git@github.com/") {
        rest
    } else if let Some(rest) = url.strip_prefix("git@github.com:") {
        rest
    } else {
        return None;
    };

    let path = path.strip_suffix(".git").unwrap_or(path);
    let mut parts = path.splitn(2, '/');
    let owner = parts.next()?;
    let repo = parts.next()?;
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some((owner.to_string(), repo.to_string()))
}

/// Reads the given repo's "origin" remote URL and parses it into
/// (owner, repo) if it points at github.com. Returns Ok(None) when there's
/// no origin remote or it isn't a github.com URL.
pub fn origin_owner_repo(repo_path: &str) -> Result<Option<(String, String)>, crate::error::AppError> {
    let repo = git2::Repository::open(repo_path)?;
    let remote = match repo.find_remote("origin") {
        Ok(remote) => remote,
        Err(_) => return Ok(None),
    };
    let url = match remote.url() {
        Some(url) => url,
        None => return Ok(None),
    };
    Ok(parse_github_owner_repo(url))
}

#[cfg(test)]
mod gh_client_tests {
    use super::*;
    use std::cell::RefCell;

    struct FakeGhRunner {
        response: Result<String, AppError>,
        calls: RefCell<Vec<Vec<String>>>,
    }

    impl FakeGhRunner {
        fn ok(response: &str) -> Self {
            Self {
                response: Ok(response.to_string()),
                calls: RefCell::new(Vec::new()),
            }
        }

        fn err(message: &str) -> Self {
            Self {
                response: Err(AppError::Operation(message.to_string())),
                calls: RefCell::new(Vec::new()),
            }
        }
    }

    impl GhRunner for FakeGhRunner {
        fn run(&self, args: &[&str]) -> Result<String, AppError> {
            self.calls
                .borrow_mut()
                .push(args.iter().map(|s| s.to_string()).collect());
            match &self.response {
                Ok(s) => Ok(s.clone()),
                Err(AppError::Operation(m)) => Err(AppError::Operation(m.clone())),
                Err(_) => unreachable!(),
            }
        }
    }

    #[test]
    fn list_commit_pull_requests_parses_and_sorts_by_number() {
        let runner = FakeGhRunner::ok(
            r#"[{"number":9,"title":"b","url":"https://github.com/a/w/pull/9"},{"number":3,"title":"a","url":"https://github.com/a/w/pull/3"}]"#,
        );
        let prs = list_commit_pull_requests(&runner, "a", "w", "abc").unwrap();
        assert_eq!(prs.iter().map(|p| p.number).collect::<Vec<_>>(), vec![3, 9]);
        assert_eq!(runner.calls.borrow()[0][1], "repos/a/w/commits/abc/pulls");
    }

    #[test]
    fn list_commit_pull_requests_is_empty_for_no_prs() {
        let runner = FakeGhRunner::ok("[]");
        assert!(list_commit_pull_requests(&runner, "a", "w", "abc").unwrap().is_empty());
    }

    const SAMPLE_PR_LIST_JSON: &str = r#"[
        {
            "number": 42,
            "title": "Fix the thing",
            "author": {"login": "yarinmag"},
            "headRefName": "fix-thing",
            "baseRefName": "main",
            "state": "OPEN",
            "isDraft": false,
            "labels": [{"name": "bug"}],
            "updatedAt": "2026-07-10T12:00:00Z",
            "url": "https://github.com/acme/widgets/pull/42"
        }
    ]"#;

    #[test]
    fn auth_token_returns_trimmed_token_on_success() {
        let runner = FakeGhRunner::ok("gho_abc123\n");
        let token = auth_token(&runner).unwrap();
        assert_eq!(token, "gho_abc123");
    }

    #[test]
    fn auth_token_errors_when_gh_not_authenticated() {
        let runner = FakeGhRunner::err("not logged in");
        let result = auth_token(&runner);
        assert!(result.is_err());
    }

    #[test]
    fn list_pull_requests_parses_gh_json_output() {
        let runner = FakeGhRunner::ok(SAMPLE_PR_LIST_JSON);

        let prs = list_pull_requests(&runner, "acme", "widgets", "is:open").unwrap();

        assert_eq!(prs.len(), 1);
        let pr = &prs[0];
        assert_eq!(pr.number, 42);
        assert_eq!(pr.title, "Fix the thing");
        assert_eq!(pr.author, "yarinmag");
        assert_eq!(pr.head_ref_name, "fix-thing");
        assert_eq!(pr.base_ref_name, "main");
        assert_eq!(pr.state, "OPEN");
        assert!(!pr.is_draft);
        assert_eq!(pr.labels, vec!["bug".to_string()]);
        assert_eq!(pr.url, "https://github.com/acme/widgets/pull/42");
        assert_eq!(pr.status_check_rollup, None);
        assert_eq!(pr.review_decision, None);
    }

    #[test]
    fn list_pull_requests_parses_status_checks_and_review_decision() {
        let json = r#"[{
            "number": 42, "title": "Fix the thing", "author": {"login": "yarinmag"},
            "headRefName": "fix-thing", "baseRefName": "main", "state": "OPEN",
            "isDraft": false, "labels": [], "updatedAt": "2026-07-10T12:00:00Z",
            "url": "https://github.com/acme/widgets/pull/42",
            "reviewDecision": "CHANGES_REQUESTED",
            "statusCheckRollup": [
                {"__typename": "CheckRun", "status": "COMPLETED", "conclusion": "SUCCESS"},
                {"__typename": "CheckRun", "status": "IN_PROGRESS", "conclusion": null}
            ]
        }]"#;
        let runner = FakeGhRunner::ok(json);

        let prs = list_pull_requests(&runner, "acme", "widgets", "is:open").unwrap();

        assert_eq!(prs[0].status_check_rollup.as_deref(), Some("pending"));
        assert_eq!(prs[0].review_decision.as_deref(), Some("CHANGES_REQUESTED"));
    }

    #[test]
    fn compute_status_rollup_is_none_for_no_checks() {
        assert_eq!(compute_status_rollup(&[]), None);
    }

    #[test]
    fn compute_status_rollup_is_failure_if_any_check_failed() {
        let checks = vec![
            GhCheckJson { conclusion: Some("SUCCESS".into()), status: Some("COMPLETED".into()), state: None },
            GhCheckJson { conclusion: Some("FAILURE".into()), status: Some("COMPLETED".into()), state: None },
        ];
        assert_eq!(compute_status_rollup(&checks), Some("failure".to_string()));
    }

    #[test]
    fn compute_status_rollup_is_success_when_all_checks_pass() {
        let checks = vec![GhCheckJson {
            conclusion: Some("SUCCESS".into()),
            status: Some("COMPLETED".into()),
            state: None,
        }];
        assert_eq!(compute_status_rollup(&checks), Some("success".to_string()));
    }

    #[test]
    fn compute_status_rollup_handles_legacy_status_context_state_field() {
        let checks = vec![GhCheckJson { conclusion: None, status: None, state: Some("SUCCESS".into()) }];
        assert_eq!(compute_status_rollup(&checks), Some("success".to_string()));
    }

    const SAMPLE_PR_VIEW_JSON: &str = r#"{
        "number": 42,
        "title": "Fix the thing",
        "author": {"login": "yarinmag"},
        "headRefName": "fix-thing",
        "baseRefName": "main",
        "state": "OPEN",
        "isDraft": false,
        "labels": [{"name": "bug"}],
        "updatedAt": "2026-07-10T12:00:00Z",
        "url": "https://github.com/acme/widgets/pull/42",
        "body": "Fixes the race condition in the queue.",
        "commits": [
            {"oid": "abc123", "messageHeadline": "fix the thing"},
            {"oid": "def456", "messageHeadline": "add a test"}
        ]
    }"#;

    #[test]
    fn pr_detail_parses_gh_json_output_including_commits() {
        let runner = FakeGhRunner::ok(SAMPLE_PR_VIEW_JSON);

        let pr = pr_detail(&runner, "acme", "widgets", 42).unwrap();

        assert_eq!(pr.pull_request.number, 42);
        assert_eq!(pr.pull_request.head_ref_name, "fix-thing");
        assert_eq!(pr.commits.len(), 2);
        assert_eq!(pr.commits[0].oid, "abc123");
        assert_eq!(pr.commits[0].message_headline, "fix the thing");
        assert_eq!(pr.commits[1].oid, "def456");
        assert_eq!(pr.body, "Fixes the race condition in the queue.");
    }

    const SAMPLE_PR_COMMENTS_JSON: &str = r#"[
        {
            "id": 111,
            "user": {"login": "avery"},
            "body": "Looks good to me",
            "created_at": "2026-07-20T10:00:00Z",
            "html_url": "https://github.com/acme/widgets/pull/42#issuecomment-111"
        }
    ]"#;

    #[test]
    fn list_pr_comments_parses_gh_api_json_output() {
        let runner = FakeGhRunner::ok(SAMPLE_PR_COMMENTS_JSON);

        let comments = list_pr_comments(&runner, "acme", "widgets", 42).unwrap();

        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].id, 111);
        assert_eq!(comments[0].author, "avery");
        assert_eq!(comments[0].body, "Looks good to me");
        assert_eq!(comments[0].created_at, "2026-07-20T10:00:00Z");
        assert_eq!(
            comments[0].url,
            "https://github.com/acme/widgets/pull/42#issuecomment-111"
        );
    }

    #[test]
    fn list_pr_comments_calls_gh_api_with_paginate_and_repo() {
        let runner = FakeGhRunner::ok(SAMPLE_PR_COMMENTS_JSON);

        list_pr_comments(&runner, "acme", "widgets", 42).unwrap();

        let calls = runner.calls.borrow();
        let args = &calls[0];
        assert_eq!(args[0], "api");
        assert!(args.contains(&"repos/acme/widgets/issues/42/comments".to_string()));
        assert!(args.contains(&"--paginate".to_string()));
    }

    const SAMPLE_ADD_COMMENT_JSON: &str = r#"{
        "id": 222,
        "user": {"login": "yarinmag"},
        "body": "Thanks!",
        "created_at": "2026-07-21T09:00:00Z",
        "html_url": "https://github.com/acme/widgets/pull/42#issuecomment-222"
    }"#;

    #[test]
    fn add_pr_comment_parses_created_comment_json() {
        let runner = FakeGhRunner::ok(SAMPLE_ADD_COMMENT_JSON);

        let comment = add_pr_comment(&runner, "acme", "widgets", 42, "Thanks!").unwrap();

        assert_eq!(comment.id, 222);
        assert_eq!(comment.author, "yarinmag");
        assert_eq!(comment.body, "Thanks!");
        assert_eq!(comment.created_at, "2026-07-21T09:00:00Z");
    }

    #[test]
    fn add_pr_comment_posts_to_the_issues_comments_endpoint_with_the_body() {
        let runner = FakeGhRunner::ok(SAMPLE_ADD_COMMENT_JSON);

        add_pr_comment(&runner, "acme", "widgets", 42, "Thanks!").unwrap();

        let calls = runner.calls.borrow();
        let args = &calls[0];
        assert_eq!(args[0], "api");
        assert!(args.contains(&"repos/acme/widgets/issues/42/comments".to_string()));
        assert!(args.contains(&"-X".to_string()));
        assert!(args.contains(&"POST".to_string()));
        assert!(args.contains(&"body=Thanks!".to_string()));
    }

    const SAMPLE_PR_REVIEW_COMMENTS_JSON: &str = r#"[
        {
            "id": 501,
            "user": {"login": "avery"},
            "body": "why the extra retry?",
            "created_at": "2026-07-21T11:00:00Z",
            "path": "src/common/SimpleQueue.js",
            "line": 116,
            "original_line": 116,
            "side": "RIGHT",
            "html_url": "https://github.com/acme/widgets/pull/42#discussion_r501"
        },
        {
            "id": 502,
            "user": {"login": "priya"},
            "body": "stale comment, position gone",
            "created_at": "2026-07-19T09:00:00Z",
            "path": "src/common/SimpleQueue.js",
            "line": null,
            "original_line": null,
            "side": "RIGHT",
            "html_url": "https://github.com/acme/widgets/pull/42#discussion_r502"
        }
    ]"#;

    #[test]
    fn list_pr_review_comments_parses_and_drops_unanchorable_comments() {
        let runner = FakeGhRunner::ok(SAMPLE_PR_REVIEW_COMMENTS_JSON);

        let comments = list_pr_review_comments(&runner, "acme", "widgets", 42).unwrap();

        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].id, 501);
        assert_eq!(comments[0].author, "avery");
        assert_eq!(comments[0].path, "src/common/SimpleQueue.js");
        assert_eq!(comments[0].line, 116);
        assert_eq!(comments[0].side, "RIGHT");
    }

    #[test]
    fn list_pr_review_comments_calls_gh_api_with_paginate_and_repo() {
        let runner = FakeGhRunner::ok(SAMPLE_PR_REVIEW_COMMENTS_JSON);

        list_pr_review_comments(&runner, "acme", "widgets", 42).unwrap();

        let calls = runner.calls.borrow();
        let args = &calls[0];
        assert_eq!(args[0], "api");
        assert!(args.contains(&"repos/acme/widgets/pulls/42/comments".to_string()));
        assert!(args.contains(&"--paginate".to_string()));
    }

    const SAMPLE_ADD_REVIEW_COMMENT_JSON: &str = r#"{
        "id": 601,
        "user": {"login": "yarinmag"},
        "body": "good catch, fixing",
        "created_at": "2026-07-22T08:00:00Z",
        "path": "src/common/SimpleQueue.js",
        "line": 116,
        "original_line": 116,
        "side": "RIGHT",
        "html_url": "https://github.com/acme/widgets/pull/42#discussion_r601"
    }"#;

    #[test]
    fn add_pr_review_comment_parses_created_comment_json() {
        let runner = FakeGhRunner::ok(SAMPLE_ADD_REVIEW_COMMENT_JSON);

        let comment = add_pr_review_comment(
            &runner, "acme", "widgets", 42, "abc123", "src/common/SimpleQueue.js", 116, "RIGHT", "good catch, fixing",
        )
        .unwrap();

        assert_eq!(comment.id, 601);
        assert_eq!(comment.author, "yarinmag");
        assert_eq!(comment.path, "src/common/SimpleQueue.js");
        assert_eq!(comment.line, 116);
        assert_eq!(comment.side, "RIGHT");
    }

    #[test]
    fn add_pr_review_comment_posts_with_expected_args() {
        let runner = FakeGhRunner::ok(SAMPLE_ADD_REVIEW_COMMENT_JSON);

        add_pr_review_comment(
            &runner, "acme", "widgets", 42, "abc123", "src/common/SimpleQueue.js", 116, "RIGHT", "good catch, fixing",
        )
        .unwrap();

        let calls = runner.calls.borrow();
        let args = &calls[0];
        assert_eq!(args[0], "api");
        assert!(args.contains(&"repos/acme/widgets/pulls/42/comments".to_string()));
        assert!(args.contains(&"-X".to_string()));
        assert!(args.contains(&"POST".to_string()));
        assert!(args.contains(&"body=good catch, fixing".to_string()));
        assert!(args.contains(&"commit_id=abc123".to_string()));
        assert!(args.contains(&"path=src/common/SimpleQueue.js".to_string()));
        assert!(args.contains(&"-F".to_string()));
        assert!(args.contains(&"line=116".to_string()));
        assert!(args.contains(&"side=RIGHT".to_string()));
    }

    #[test]
    fn pr_detail_passes_repo_and_number_to_gh() {
        let runner = FakeGhRunner::ok(SAMPLE_PR_VIEW_JSON);

        pr_detail(&runner, "acme", "widgets", 42).unwrap();

        let calls = runner.calls.borrow();
        let args = &calls[0];
        assert_eq!(args[0], "pr");
        assert_eq!(args[1], "view");
        assert_eq!(args[2], "42");
        assert!(args.contains(&"--repo".to_string()));
        assert!(args.contains(&"acme/widgets".to_string()));
    }

    #[test]
    fn github_status_unavailable_when_origin_is_not_github() {
        use crate::test_support::init_repo_with_commits;
        let (dir, repo) = init_repo_with_commits();
        repo.remote("origin", "/tmp/some/bare/repo").unwrap();
        let runner = FakeGhRunner::ok("gho_abc123");

        let status = github_status(&runner, dir.path().to_str().unwrap());

        assert!(!status.available);
        assert!(status.owner.is_none());
        assert!(status.reason.is_some());
    }

    #[test]
    fn github_status_unavailable_when_gh_not_authenticated() {
        use crate::test_support::init_repo_with_commits;
        let (dir, repo) = init_repo_with_commits();
        repo.remote("origin", "https://github.com/acme/widgets.git")
            .unwrap();
        let runner = FakeGhRunner::err("not logged in");

        let status = github_status(&runner, dir.path().to_str().unwrap());

        assert!(!status.available);
        assert_eq!(status.owner.as_deref(), Some("acme"));
        assert!(status.reason.is_some());
    }

    #[test]
    fn github_status_available_when_github_origin_and_authenticated() {
        use crate::test_support::init_repo_with_commits;
        let (dir, repo) = init_repo_with_commits();
        repo.remote("origin", "https://github.com/acme/widgets.git")
            .unwrap();
        let runner = FakeGhRunner::ok("gho_abc123");

        let status = github_status(&runner, dir.path().to_str().unwrap());

        assert!(status.available);
        assert_eq!(status.owner.as_deref(), Some("acme"));
        assert_eq!(status.repo.as_deref(), Some("widgets"));
        assert!(status.reason.is_none());
    }

    #[test]
    fn list_pull_requests_passes_repo_and_search_query_to_gh() {
        let runner = FakeGhRunner::ok(SAMPLE_PR_LIST_JSON);

        list_pull_requests(&runner, "acme", "widgets", "author:yarinmag is:open").unwrap();

        let calls = runner.calls.borrow();
        assert_eq!(calls.len(), 1);
        let args = &calls[0];
        assert_eq!(args[0], "pr");
        assert_eq!(args[1], "list");
        assert!(args.contains(&"--repo".to_string()));
        assert!(args.contains(&"acme/widgets".to_string()));
        assert!(args.contains(&"--search".to_string()));
        assert!(args.contains(&"author:yarinmag is:open".to_string()));
    }

    #[test]
    fn list_pull_requests_does_not_pass_a_state_flag_by_default() {
        let runner = FakeGhRunner::ok(SAMPLE_PR_LIST_JSON);

        list_pull_requests(&runner, "acme", "widgets", "is:open").unwrap();

        let calls = runner.calls.borrow();
        let args = &calls[0];
        assert!(!args.contains(&"--state".to_string()));
    }

    #[test]
    fn list_pull_requests_translates_state_all_sentinel_into_a_state_flag() {
        let runner = FakeGhRunner::ok(SAMPLE_PR_LIST_JSON);

        list_pull_requests(&runner, "acme", "widgets", "base:main state:all").unwrap();

        let calls = runner.calls.borrow();
        let args = &calls[0];
        assert!(args.contains(&"--state".to_string()));
        assert!(args.contains(&"all".to_string()));
        let search_index = args.iter().position(|a| a == "--search").unwrap();
        assert_eq!(args[search_index + 1], "base:main");
    }

    #[test]
    fn list_branches_parses_newline_separated_branch_names() {
        let runner = FakeGhRunner::ok("main\ndevelop\nfeature/foo\n");

        let branches = list_branches(&runner, "acme", "widgets").unwrap();

        assert_eq!(branches, vec!["main", "develop", "feature/foo"]);
    }

    #[test]
    fn list_branches_ignores_blank_lines() {
        let runner = FakeGhRunner::ok("main\n\ndevelop\n");

        let branches = list_branches(&runner, "acme", "widgets").unwrap();

        assert_eq!(branches, vec!["main", "develop"]);
    }

    #[test]
    fn list_branches_calls_gh_api_with_paginate_and_repo() {
        let runner = FakeGhRunner::ok("main\n");

        list_branches(&runner, "acme", "widgets").unwrap();

        let calls = runner.calls.borrow();
        let args = &calls[0];
        assert_eq!(args[0], "api");
        assert!(args.contains(&"repos/acme/widgets/branches".to_string()));
        assert!(args.contains(&"--paginate".to_string()));
    }

    #[test]
    fn list_assignable_users_parses_newline_separated_logins() {
        let runner = FakeGhRunner::ok("alice\nbob\ncarol\n");

        let users = list_assignable_users(&runner, "acme", "widgets").unwrap();

        assert_eq!(users, vec!["alice", "bob", "carol"]);
    }

    #[test]
    fn list_assignable_users_ignores_blank_lines() {
        let runner = FakeGhRunner::ok("alice\n\nbob\n");

        let users = list_assignable_users(&runner, "acme", "widgets").unwrap();

        assert_eq!(users, vec!["alice", "bob"]);
    }

    #[test]
    fn list_assignable_users_calls_gh_api_with_paginate_and_repo() {
        let runner = FakeGhRunner::ok("alice\n");

        list_assignable_users(&runner, "acme", "widgets").unwrap();

        let calls = runner.calls.borrow();
        let args = &calls[0];
        assert_eq!(args[0], "api");
        assert!(args.contains(&"repos/acme/widgets/assignees".to_string()));
        assert!(args.contains(&"--paginate".to_string()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::init_repo_with_commits;

    #[test]
    fn origin_owner_repo_parses_github_origin_remote() {
        let (dir, repo) = init_repo_with_commits();
        repo.remote("origin", "https://github.com/acme/widgets.git")
            .unwrap();

        let result = origin_owner_repo(dir.path().to_str().unwrap()).unwrap();

        assert_eq!(result, Some(("acme".to_string(), "widgets".to_string())));
    }

    #[test]
    fn origin_owner_repo_returns_none_for_non_github_origin() {
        let (dir, repo) = init_repo_with_commits();
        repo.remote("origin", "/tmp/some/bare/repo").unwrap();

        let result = origin_owner_repo(dir.path().to_str().unwrap()).unwrap();

        assert_eq!(result, None);
    }

    #[test]
    fn origin_owner_repo_returns_none_when_no_origin_remote() {
        let (dir, _repo) = init_repo_with_commits();

        let result = origin_owner_repo(dir.path().to_str().unwrap()).unwrap();

        assert_eq!(result, None);
    }

    #[test]
    fn resolve_owner_repo_errors_when_origin_is_not_github() {
        let (dir, repo) = init_repo_with_commits();
        repo.remote("origin", "/tmp/some/bare/repo").unwrap();

        let result = resolve_owner_repo(dir.path().to_str().unwrap());

        assert!(result.is_err());
    }

    #[test]
    fn resolve_owner_repo_returns_owner_and_repo_for_github_origin() {
        let (dir, repo) = init_repo_with_commits();
        repo.remote("origin", "https://github.com/acme/widgets.git")
            .unwrap();

        let (owner, repo_name) = resolve_owner_repo(dir.path().to_str().unwrap()).unwrap();

        assert_eq!(owner, "acme");
        assert_eq!(repo_name, "widgets");
    }

    #[test]
    fn pull_request_serializes_with_camel_case_keys() {
        let pr = PullRequest {
            number: 1,
            title: "t".into(),
            author: "a".into(),
            head_ref_name: "feature".into(),
            base_ref_name: "main".into(),
            state: "OPEN".into(),
            is_draft: false,
            labels: vec![],
            updated_at: "now".into(),
            url: "u".into(),
            status_check_rollup: None,
            review_decision: None,
        };
        let json = serde_json::to_string(&pr).unwrap();
        assert!(json.contains("\"headRefName\""), "json was: {json}");
        assert!(json.contains("\"isDraft\""), "json was: {json}");
    }

    #[test]
    fn pr_fetch_refspec_targets_the_pr_head_and_a_local_tracking_ref() {
        assert_eq!(
            pr_fetch_refspec("origin", 42),
            "pull/42/head:refs/remotes/origin/pr/42"
        );
    }

    #[test]
    fn parses_https_url_with_git_suffix() {
        assert_eq!(
            parse_github_owner_repo("https://github.com/owner/repo.git"),
            Some(("owner".to_string(), "repo".to_string()))
        );
    }

    #[test]
    fn parses_https_url_without_git_suffix() {
        assert_eq!(
            parse_github_owner_repo("https://github.com/owner/repo"),
            Some(("owner".to_string(), "repo".to_string()))
        );
    }

    #[test]
    fn parses_ssh_scp_style_url() {
        assert_eq!(
            parse_github_owner_repo("git@github.com:owner/repo.git"),
            Some(("owner".to_string(), "repo".to_string()))
        );
    }

    #[test]
    fn parses_ssh_url_style() {
        assert_eq!(
            parse_github_owner_repo("ssh://git@github.com/owner/repo.git"),
            Some(("owner".to_string(), "repo".to_string()))
        );
    }

    #[test]
    fn returns_none_for_non_github_remote() {
        assert_eq!(
            parse_github_owner_repo("https://gitlab.com/owner/repo.git"),
            None
        );
    }

    #[test]
    fn returns_none_for_local_path_remote() {
        assert_eq!(parse_github_owner_repo("/tmp/some/bare/repo"), None);
    }
}

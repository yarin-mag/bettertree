use crate::error::AppError;
use crate::github::{check_state, GhRunner};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CiState { Success, Pending, Failure, None }

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowCi { pub workflow_id: u64, pub workflow_name: String, pub state: CiState }

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitCi {
    pub oid: String,
    pub state: CiState,
    pub total: u32,
    pub failed: u32,
    pub pending: u32,
    pub by_workflow: Vec<WorkflowCi>,
}

const STATUS_BATCH: usize = 100;

fn none(oid: &str) -> CommitCi {
    CommitCi { oid: oid.to_string(), state: CiState::None, total: 0, failed: 0, pending: 0, by_workflow: vec![] }
}

pub fn build_status_query(owner: &str, repo: &str, oids: &[String]) -> String {
    let fields = "... on Commit { statusCheckRollup { contexts(first: 100) { totalCount nodes { __typename \
        ... on CheckRun { name status conclusion checkSuite { workflowRun { workflow { databaseId name } } } } \
        ... on StatusContext { context state } } } } }";
    let aliases: String = oids
        .iter()
        .enumerate()
        .map(|(i, oid)| format!("c{i}: object(oid: \"{oid}\") {{ {fields} }}"))
        .collect::<Vec<_>>()
        .join(" ");
    format!("query {{ repository(owner: \"{owner}\", name: \"{repo}\") {{ {aliases} }} }}")
}

#[derive(Deserialize)]
struct Workflow { #[serde(rename = "databaseId")] database_id: u64, name: String }
#[derive(Deserialize)]
struct WorkflowRun { workflow: Option<Workflow> }
#[derive(Deserialize)]
struct CheckSuite { #[serde(rename = "workflowRun")] workflow_run: Option<WorkflowRun> }
#[derive(Deserialize)]
struct Node {
    #[serde(rename = "__typename")] typename: String,
    status: Option<String>,
    conclusion: Option<String>,
    state: Option<String>,
    #[serde(rename = "checkSuite")] check_suite: Option<CheckSuite>,
}
#[derive(Deserialize)]
struct Contexts {
    #[serde(rename = "totalCount", default)] total_count: Option<u32>,
    nodes: Vec<Node>,
}
#[derive(Deserialize)]
struct Rollup { contexts: Contexts }
#[derive(Deserialize)]
struct CommitObj { #[serde(rename = "statusCheckRollup")] rollup: Option<Rollup> }

fn to_state(s: &str) -> CiState {
    match s { "failure" => CiState::Failure, "pending" => CiState::Pending, _ => CiState::Success }
}

pub fn parse_status_response(json: &str, oids: &[String]) -> Result<Vec<CommitCi>, AppError> {
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| AppError::Operation(format!("failed to parse CI status: {e}")))?;
    let repo = &value["data"]["repository"];
    let mut out = Vec::with_capacity(oids.len());
    for (i, oid) in oids.iter().enumerate() {
        let obj = repo.get(format!("c{i}"));
        let commit: Option<CommitObj> = obj.and_then(|v| serde_json::from_value(v.clone()).ok());
        let Some(rollup) = commit.and_then(|c| c.rollup) else { out.push(none(oid)); continue };
        let (mut failed, mut pending) = (0u32, 0u32);
        let mut workflows: BTreeMap<u64, (String, bool, bool)> = BTreeMap::new();
        let fetched = rollup.contexts.nodes.len() as u32;
        let total = rollup.contexts.total_count.unwrap_or(fetched).max(fetched);
        for node in &rollup.contexts.nodes {
            let st = if node.typename == "CheckRun" {
                check_state(node.conclusion.as_deref(), node.status.as_deref(), None)
            } else {
                check_state(None, None, node.state.as_deref())
            };
            if st == "failure" { failed += 1 } else if st == "pending" { pending += 1 }
            let wf = node.check_suite.as_ref().and_then(|s| s.workflow_run.as_ref()).and_then(|r| r.workflow.as_ref());
            if let Some(wf) = wf {
                let e = workflows.entry(wf.database_id).or_insert((wf.name.clone(), false, false));
                if st == "failure" { e.1 = true } else if st == "pending" { e.2 = true }
            }
        }
        // Unseen contexts beyond the first 100 can't be proven green, so don't report success.
        let state = if total == 0 { CiState::None }
            else if failed > 0 { CiState::Failure }
            else if pending > 0 || total > fetched { CiState::Pending }
            else { CiState::Success };
        let by_workflow = workflows
            .into_iter()
            .map(|(id, (name, f, p))| WorkflowCi {
                workflow_id: id,
                workflow_name: name,
                state: to_state(if f { "failure" } else if p { "pending" } else { "success" }),
            })
            .collect();
        out.push(CommitCi { oid: oid.clone(), state, total, failed, pending, by_workflow });
    }
    Ok(out)
}

fn validate_repo_slug(owner: &str, repo: &str) -> Result<(), AppError> {
    let ok = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if !ok(owner) || !ok(repo) {
        return Err(AppError::Operation(format!("invalid repository name: {owner}/{repo}")));
    }
    Ok(())
}

fn validate_oid(oid: &str) -> Result<(), AppError> {
    if oid.is_empty() || !oid.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::Operation(format!("invalid commit id: {oid}")));
    }
    Ok(())
}

pub fn status_for_commits(runner: &dyn GhRunner, owner: &str, repo: &str, oids: &[String]) -> Result<Vec<CommitCi>, AppError> {
    validate_repo_slug(owner, repo)?;
    // Oids are interpolated into the GraphQL document, so refuse anything that isn't hex.
    for oid in oids { validate_oid(oid)?; }
    let mut out = Vec::with_capacity(oids.len());
    for chunk in oids.chunks(STATUS_BATCH) {
        let query = build_status_query(owner, repo, chunk);
        let response = gh(runner, "gh api graphql", &["api", "graphql", "-f", &format!("query={query}")])?;
        out.extend(parse_status_response(&response, chunk)?);
    }
    Ok(out)
}

pub const LOG_CAP_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step { pub number: u32, pub name: String, pub status: String, pub conclusion: Option<String> }

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub job_id: u64, pub name: String, pub status: String, pub conclusion: Option<String>,
    pub started_at: Option<String>, pub completed_at: Option<String>, pub url: String, pub steps: Vec<Step>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunInfo {
    pub run_id: u64, pub workflow_id: u64, pub workflow_name: String, pub status: String,
    pub conclusion: Option<String>, pub url: String, pub started_at: Option<String>,
    pub updated_at: Option<String>, pub jobs: Vec<Job>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OtherCheck { pub name: String, pub state: CiState, pub url: Option<String>, pub source: String }

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitChecks { pub oid: String, pub runs: Vec<WorkflowRunInfo>, pub other: Vec<OtherCheck> }

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobLog { pub text: String, pub truncated: bool }

fn parse<T: serde::de::DeserializeOwned>(json: &str, what: &str) -> Result<T, AppError> {
    serde_json::from_str(json).map_err(|e| AppError::Operation(format!("failed to parse {what}: {e}")))
}

#[derive(Deserialize)]
struct RunsResp { workflow_runs: Vec<RunJson> }
#[derive(Deserialize)]
struct RunJson {
    id: u64, workflow_id: u64, name: Option<String>, status: Option<String>, conclusion: Option<String>,
    html_url: String, run_started_at: Option<String>, updated_at: Option<String>,
}
#[derive(Deserialize)]
struct JobsResp { jobs: Vec<JobJson> }
#[derive(Deserialize)]
struct JobJson {
    id: u64, name: String, status: String, conclusion: Option<String>, started_at: Option<String>,
    completed_at: Option<String>, html_url: String, #[serde(default)] steps: Vec<Step>,
}
#[derive(Deserialize)]
struct CheckRunsResp { check_runs: Vec<CheckRunJson> }
#[derive(Deserialize)]
struct AppJson { slug: Option<String> }
#[derive(Deserialize)]
struct CheckRunJson {
    name: String, status: Option<String>, conclusion: Option<String>, html_url: Option<String>, app: Option<AppJson>,
}
#[derive(Deserialize)]
struct StatusResp { statuses: Vec<StatusJson> }
#[derive(Deserialize)]
struct StatusJson { context: String, state: String, target_url: Option<String> }

const MAX_ERR_CHARS: usize = 300;

fn truncate_chars(s: &str) -> String {
    if s.chars().count() <= MAX_ERR_CHARS { return s.to_string(); }
    let mut t: String = s.chars().take(MAX_ERR_CHARS).collect();
    t.push('…');
    t
}

/// Shortens a runner error: drops the echoed `gh <argv>` (which can hold a GraphQL document or
/// oids) keeping only stderr behind a short label, and caps the length.
fn tidy_err(label: &str, e: AppError) -> AppError {
    let msg = e.to_string();
    let out = match msg.split_once(" failed: ") {
        Some((_, stderr)) => truncate_chars(&format!("{label} failed: {stderr}")),
        None => truncate_chars(&msg),
    };
    AppError::Operation(out)
}

fn gh(runner: &dyn GhRunner, label: &str, args: &[&str]) -> Result<String, AppError> {
    runner.run(args).map_err(|e| tidy_err(label, e))
}

/// GitHub answers 422 "No commit found for SHA" for commits it doesn't know (e.g. unpushed).
fn is_unknown_commit(e: &AppError) -> bool {
    let m = e.to_string().to_lowercase();
    m.contains("no commit found") || m.contains("http 422") || m.contains("unprocessable")
}

fn gh_or_empty(runner: &dyn GhRunner, args: &[&str], empty: &str) -> Result<String, AppError> {
    match gh(runner, "gh api", args) {
        Err(e) if is_unknown_commit(&e) => Ok(empty.to_string()),
        other => other,
    }
}

fn fetch_jobs(runner: &dyn GhRunner, owner: &str, repo: &str, run_id: u64) -> Result<Vec<Job>, AppError> {
    let json = gh(runner, "gh api", &["api", &format!("repos/{owner}/{repo}/actions/runs/{run_id}/jobs?per_page=100")])?;
    let resp: JobsResp = parse(&json, "jobs")?;
    Ok(resp.jobs.into_iter().map(|j| Job {
        job_id: j.id, name: j.name, status: j.status, conclusion: j.conclusion,
        started_at: j.started_at, completed_at: j.completed_at, url: j.html_url, steps: j.steps,
    }).collect())
}

pub fn commit_checks(runner: &dyn GhRunner, owner: &str, repo: &str, oid: &str) -> Result<CommitChecks, AppError> {
    validate_repo_slug(owner, repo)?;
    validate_oid(oid)?;
    let runs_json = gh_or_empty(runner, &["api", &format!("repos/{owner}/{repo}/actions/runs?head_sha={oid}&per_page=100")], r#"{"workflow_runs":[]}"#)?;
    let runs_resp: RunsResp = parse(&runs_json, "workflow runs")?;
    let mut runs = Vec::new();
    for r in runs_resp.workflow_runs {
        let jobs = fetch_jobs(runner, owner, repo, r.id)?;
        runs.push(WorkflowRunInfo {
            run_id: r.id, workflow_id: r.workflow_id, workflow_name: r.name.unwrap_or_default(),
            status: r.status.unwrap_or_default(), conclusion: r.conclusion, url: r.html_url,
            started_at: r.run_started_at, updated_at: r.updated_at,
            jobs,
        });
    }
    let cr: CheckRunsResp = parse(&gh_or_empty(runner, &["api", &format!("repos/{owner}/{repo}/commits/{oid}/check-runs?per_page=100")], r#"{"check_runs":[]}"#)?, "check runs")?;
    let st: StatusResp = parse(&gh_or_empty(runner, &["api", &format!("repos/{owner}/{repo}/commits/{oid}/status")], r#"{"statuses":[]}"#)?, "commit status")?;
    let mut other: Vec<OtherCheck> = cr.check_runs.into_iter()
        .filter(|c| c.app.as_ref().and_then(|a| a.slug.as_deref()) != Some("github-actions"))
        .map(|c| OtherCheck {
            state: to_state(check_state(c.conclusion.as_deref(), c.status.as_deref(), None)),
            name: c.name, url: c.html_url,
            source: c.app.and_then(|a| a.slug).unwrap_or_else(|| "check".into()),
        }).collect();
    other.extend(st.statuses.into_iter().map(|s| OtherCheck {
        state: to_state(check_state(None, None, Some(&s.state))), name: s.context, url: s.target_url, source: "status".into(),
    }));
    Ok(CommitChecks { oid: oid.to_string(), runs, other })
}

pub fn job_log(runner: &dyn GhRunner, owner: &str, repo: &str, job_id: u64, full: bool) -> Result<JobLog, AppError> {
    validate_repo_slug(owner, repo)?;
    let text = gh(runner, "gh run view", &["run", "view", "--job", &job_id.to_string(), "--log", "-R", &format!("{owner}/{repo}")])?;
    if full || text.len() <= LOG_CAP_BYTES {
        return Ok(JobLog { text, truncated: false });
    }
    let mut start = text.len() - LOG_CAP_BYTES;
    while !text.is_char_boundary(start) { start += 1; }
    Ok(JobLog { text: text[start..].to_string(), truncated: true })
}

pub fn rerun(runner: &dyn GhRunner, owner: &str, repo: &str, run_id: u64, failed_only: bool) -> Result<(), AppError> {
    validate_repo_slug(owner, repo)?;
    let id = run_id.to_string();
    let slug = format!("{owner}/{repo}");
    let mut args = vec!["run", "rerun", id.as_str()];
    if failed_only { args.push("--failed"); }
    args.extend(["-R", slug.as_str()]);
    gh(runner, "gh run rerun", &args).map(|_| ())
}

pub fn cancel(runner: &dyn GhRunner, owner: &str, repo: &str, run_id: u64) -> Result<(), AppError> {
    validate_repo_slug(owner, repo)?;
    gh(runner, "gh run cancel", &["run", "cancel", &run_id.to_string(), "-R", &format!("{owner}/{repo}")]).map(|_| ())
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub run_id: u64, pub workflow_id: u64, pub workflow_name: String, pub title: String,
    pub branch: Option<String>, pub sha: String, pub event: String, pub actor: Option<String>,
    pub status: String, pub conclusion: Option<String>, pub created_at: String,
    pub started_at: Option<String>, pub updated_at: Option<String>, pub url: String, pub attempt: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunsPage { pub runs: Vec<RunSummary>, pub has_more: bool }

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowInfo { pub id: u64, pub name: String, pub state: String }

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RunFilters {
    pub branch: Option<String>, pub event: Option<String>, pub status: Option<String>,
    pub actor: Option<String>, pub workflow_id: Option<u64>, pub page: Option<u32>,
}

const PER_PAGE: usize = 50;

const STATUSES_OK: [&str; 15] = [
    "completed", "in_progress", "queued", "waiting", "requested", "pending", "success", "failure",
    "cancelled", "skipped", "timed_out", "neutral", "action_required", "stale", "startup_failure",
];

fn invalid(field: &str, why: &str) -> AppError {
    AppError::Operation(format!("invalid {field}: {why}"))
}

fn validate_status(s: &str) -> Result<(), AppError> {
    if STATUSES_OK.contains(&s) { Ok(()) } else { Err(invalid("status", s)) }
}

fn validate_event(s: &str) -> Result<(), AppError> {
    if s.len() <= 40 && !s.is_empty() && s.chars().all(|c| c.is_ascii_lowercase() || c == '_') { Ok(()) } else { Err(invalid("event", s)) }
}

fn validate_actor(s: &str) -> Result<(), AppError> {
    let name = s.strip_suffix("[bot]").unwrap_or(s);
    let mut chars = name.chars();
    let ok = s.len() <= 64
        && chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '-');
    if ok { Ok(()) } else { Err(invalid("actor", s)) }
}

fn validate_branch(s: &str) -> Result<(), AppError> {
    if s.is_empty() || s.chars().count() > 255 || s.chars().any(|c| c.is_control()) {
        return Err(invalid("branch", "must be 1-255 characters without control characters"));
    }
    Ok(())
}

/// Returns the trimmed value when it is present and non-blank, after validating it.
fn clean<'a>(v: &'a Option<String>, check: fn(&str) -> Result<(), AppError>) -> Result<Option<&'a str>, AppError> {
    match v.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => check(s).map(|_| Some(s)),
        None => Ok(None),
    }
}

#[derive(Deserialize)]
struct SummaryResp { workflow_runs: Vec<SummaryJson> }
#[derive(Deserialize)]
struct ActorJson { login: String }
#[derive(Deserialize)]
struct SummaryJson {
    id: u64, workflow_id: u64, name: Option<String>, display_title: Option<String>,
    head_branch: Option<String>, #[serde(default)] head_sha: String, #[serde(default)] event: String,
    actor: Option<ActorJson>, #[serde(default)] status: String, conclusion: Option<String>,
    #[serde(default)] created_at: String, run_started_at: Option<String>, updated_at: Option<String>,
    html_url: String, run_attempt: Option<u32>,
}
#[derive(Deserialize)]
struct WorkflowsResp { workflows: Vec<WorkflowJson> }
#[derive(Deserialize)]
struct WorkflowJson { id: u64, name: String, #[serde(default)] state: String }

pub fn list_runs(runner: &dyn GhRunner, owner: &str, repo: &str, filters: &RunFilters) -> Result<RunsPage, AppError> {
    validate_repo_slug(owner, repo)?;
    let status = clean(&filters.status, validate_status)?;
    let event = clean(&filters.event, validate_event)?;
    let actor = clean(&filters.actor, validate_actor)?;
    let branch = clean(&filters.branch, validate_branch)?;
    let page = filters.page.unwrap_or(1).max(1);
    if page > 1000 { return Err(invalid("page", &page.to_string())); }
    let endpoint = match filters.workflow_id {
        Some(id) => format!("repos/{owner}/{repo}/actions/workflows/{id}/runs"),
        None => format!("repos/{owner}/{repo}/actions/runs"),
    };
    let mut args: Vec<String> = ["api", "-X", "GET"].iter().map(|s| s.to_string()).collect();
    args.extend([endpoint, "-f".into(), format!("per_page={PER_PAGE}"), "-f".into(), format!("page={page}")]);
    for (key, value) in [("branch", branch), ("event", event), ("status", status), ("actor", actor)] {
        if let Some(v) = value { args.extend(["-f".into(), format!("{key}={v}")]); }
    }
    let argv: Vec<&str> = args.iter().map(String::as_str).collect();
    let resp: SummaryResp = parse(&gh(runner, "gh api", &argv)?, "workflow runs")?;
    let runs: Vec<RunSummary> = resp.workflow_runs.into_iter().map(|r| RunSummary {
        title: r.display_title.filter(|t| !t.is_empty())
            .or_else(|| r.name.clone().filter(|n| !n.is_empty()))
            .unwrap_or_else(|| "Workflow run".into()),
        run_id: r.id, workflow_id: r.workflow_id, workflow_name: r.name.unwrap_or_default(),
        branch: r.head_branch, sha: r.head_sha, event: r.event, actor: r.actor.map(|a| a.login),
        status: r.status, conclusion: r.conclusion, created_at: r.created_at,
        started_at: r.run_started_at, updated_at: r.updated_at, url: r.html_url, attempt: r.run_attempt.unwrap_or(1),
    }).collect();
    let has_more = runs.len() == PER_PAGE;
    Ok(RunsPage { runs, has_more })
}

pub fn list_workflows(runner: &dyn GhRunner, owner: &str, repo: &str) -> Result<Vec<WorkflowInfo>, AppError> {
    validate_repo_slug(owner, repo)?;
    let json = gh(runner, "gh api", &["api", "-X", "GET", &format!("repos/{owner}/{repo}/actions/workflows"), "-f", "per_page=100"])?;
    let resp: WorkflowsResp = parse(&json, "workflows")?;
    let mut out: Vec<WorkflowInfo> = resp.workflows.into_iter()
        .map(|w| WorkflowInfo { id: w.id, name: w.name, state: w.state }).collect();
    out.sort_by_key(|w| w.name.to_lowercase());
    Ok(out)
}

pub fn run_jobs(runner: &dyn GhRunner, owner: &str, repo: &str, run_id: u64) -> Result<Vec<Job>, AppError> {
    validate_repo_slug(owner, repo)?;
    fetch_jobs(runner, owner, repo, run_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::GhRunner;
    use std::cell::RefCell;

    struct FakeRunner { responses: RefCell<Vec<Result<String, AppError>>>, calls: RefCell<Vec<Vec<String>>> }
    impl FakeRunner {
        fn new(r: Vec<Result<String, AppError>>) -> Self { Self { responses: RefCell::new(r), calls: RefCell::new(vec![]) } }
    }
    impl GhRunner for FakeRunner {
        fn run(&self, args: &[&str]) -> Result<String, AppError> {
            self.calls.borrow_mut().push(args.iter().map(|s| s.to_string()).collect());
            self.responses.borrow_mut().remove(0)
        }
    }

    const RESPONSE: &str = r#"{"data":{"repository":{
      "c0":{"statusCheckRollup":{"contexts":{"totalCount":4,"nodes":[
        {"__typename":"CheckRun","name":"build","status":"COMPLETED","conclusion":"SUCCESS",
         "checkSuite":{"workflowRun":{"workflow":{"databaseId":11,"name":"CI"}}}},
        {"__typename":"CheckRun","name":"test","status":"COMPLETED","conclusion":"FAILURE",
         "checkSuite":{"workflowRun":{"workflow":{"databaseId":11,"name":"CI"}}}},
        {"__typename":"CheckRun","name":"deploy","status":"IN_PROGRESS","conclusion":null,
         "checkSuite":{"workflowRun":{"workflow":{"databaseId":22,"name":"Deploy"}}}},
        {"__typename":"StatusContext","context":"ci/jenkins","state":"SUCCESS"}
      ]}}},
      "c1":{"statusCheckRollup":null},
      "c2":null
    }}}"#;

    #[test]
    fn parses_counts_states_and_groups_by_workflow() {
        let oids = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let out = parse_status_response(RESPONSE, &oids).unwrap();
        assert_eq!(out[0].oid, "a");
        assert_eq!(out[0].state, CiState::Failure);
        assert_eq!((out[0].total, out[0].failed, out[0].pending), (4, 1, 1));
        let ci = out[0].by_workflow.iter().find(|w| w.workflow_id == 11).unwrap();
        assert_eq!(ci.state, CiState::Failure);
        let deploy = out[0].by_workflow.iter().find(|w| w.workflow_id == 22).unwrap();
        assert_eq!(deploy.state, CiState::Pending);
    }

    #[test]
    fn commit_without_checks_or_unknown_commit_is_none() {
        let oids = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let out = parse_status_response(RESPONSE, &oids).unwrap();
        assert_eq!(out[1].state, CiState::None);
        assert_eq!(out[2].state, CiState::None);
        assert_eq!(out[1].total, 0);
    }

    #[test]
    fn query_has_one_alias_per_oid() {
        let q = build_status_query("acme", "widgets", &["a".into(), "b".into()]);
        assert!(q.contains("c0: object(oid: \"a\")") && q.contains("c1: object(oid: \"b\")"));
        assert!(q.contains("owner: \"acme\"") && q.contains("name: \"widgets\""));
    }

    #[test]
    fn status_for_commits_chunks_by_100() {
        let oids: Vec<String> = (0..150).map(|i| format!("{i:040}")).collect();
        let empty = r#"{"data":{"repository":{}}}"#;
        let runner = FakeRunner::new(vec![Ok(empty.into()), Ok(empty.into())]);
        let out = status_for_commits(&runner, "a", "w", &oids).unwrap();
        assert_eq!(runner.calls.borrow().len(), 2);
        assert_eq!(out.len(), 150);
        assert!(out.iter().all(|c| c.state == CiState::None));
    }

    #[test]
    fn oids_that_are_not_hex_are_rejected_before_calling_gh() {
        let runner = FakeRunner::new(vec![]);
        let err = status_for_commits(&runner, "a", "w", &["abc\" } }".to_string()]);
        assert!(err.is_err());
        assert!(runner.calls.borrow().is_empty());
    }

    const RUNS: &str = r#"{"workflow_runs":[
      {"id":100,"workflow_id":11,"name":"CI","status":"completed","conclusion":"failure",
       "html_url":"https://github.com/a/w/actions/runs/100","run_started_at":"2026-09-30T10:00:00Z","updated_at":"2026-09-30T10:05:00Z"}]}"#;
    const JOBS: &str = r#"{"jobs":[{"id":500,"name":"test","status":"completed","conclusion":"failure",
      "started_at":"2026-09-30T10:00:00Z","completed_at":"2026-09-30T10:04:00Z","html_url":"https://github.com/a/w/actions/runs/100/job/500",
      "steps":[{"number":1,"name":"Set up job","status":"completed","conclusion":"success"},
               {"number":2,"name":"Run tests","status":"completed","conclusion":"failure"}]}]}"#;
    const CHECK_RUNS: &str = r#"{"check_runs":[
      {"name":"test","status":"completed","conclusion":"failure","html_url":"u1","app":{"slug":"github-actions"}},
      {"name":"codecov","status":"completed","conclusion":"success","html_url":"u2","app":{"slug":"codecov"}}]}"#;
    const STATUSES: &str = r#"{"statuses":[{"context":"ci/jenkins","state":"pending","target_url":"u3"}]}"#;

    #[test]
    fn commit_checks_assembles_runs_jobs_and_other_checks_without_duplicating_actions() {
        let runner = FakeRunner::new(vec![Ok(RUNS.into()), Ok(JOBS.into()), Ok(CHECK_RUNS.into()), Ok(STATUSES.into())]);
        let out = commit_checks(&runner, "a", "w", "abc123").unwrap();
        assert_eq!(out.runs.len(), 1);
        assert_eq!(out.runs[0].workflow_id, 11);
        assert_eq!(out.runs[0].jobs[0].steps[1].name, "Run tests");
        let names: Vec<&str> = out.other.iter().map(|o| o.name.as_str()).collect();
        assert_eq!(names, vec!["codecov", "ci/jenkins"]);
        assert_eq!(out.other[1].state, CiState::Pending);
    }

    #[test]
    fn commit_checks_empty_when_no_ci() {
        let runner = FakeRunner::new(vec![
            Ok(r#"{"workflow_runs":[]}"#.into()), Ok(r#"{"check_runs":[]}"#.into()), Ok(r#"{"statuses":[]}"#.into()),
        ]);
        let out = commit_checks(&runner, "a", "w", "abc123").unwrap();
        assert!(out.runs.is_empty() && out.other.is_empty());
    }

    #[test]
    fn job_log_is_tail_capped_unless_full() {
        let big = "x".repeat(LOG_CAP_BYTES + 10);
        let runner = FakeRunner::new(vec![Ok(big.clone())]);
        let log = job_log(&runner, "a", "w", 500, false).unwrap();
        assert!(log.truncated);
        assert_eq!(log.text.len(), LOG_CAP_BYTES);
        let runner = FakeRunner::new(vec![Ok(big.clone())]);
        let log = job_log(&runner, "a", "w", 500, true).unwrap();
        assert!(!log.truncated);
        assert_eq!(log.text.len(), big.len());
    }

    #[test]
    fn job_log_truncation_never_splits_a_multibyte_char() {
        // len == CAP + 1, so the naive cut (offset 1) lands inside the 2-byte "é".
        let text = format!("é{}", "x".repeat(LOG_CAP_BYTES - 1));
        let runner = FakeRunner::new(vec![Ok(text)]);
        let log = job_log(&runner, "a", "w", 1, false).unwrap();
        assert!(log.truncated);
        assert!(log.text.len() <= LOG_CAP_BYTES);
        assert!(log.text.starts_with('x'));
    }

    #[test]
    fn rerun_and_cancel_build_the_right_gh_args() {
        let runner = FakeRunner::new(vec![Ok(String::new()), Ok(String::new()), Ok(String::new())]);
        rerun(&runner, "a", "w", 100, true).unwrap();
        rerun(&runner, "a", "w", 100, false).unwrap();
        cancel(&runner, "a", "w", 100).unwrap();
        let calls = runner.calls.borrow();
        assert_eq!(calls[0], vec!["run", "rerun", "100", "--failed", "-R", "a/w"]);
        assert_eq!(calls[1], vec!["run", "rerun", "100", "-R", "a/w"]);
        assert_eq!(calls[2], vec!["run", "cancel", "100", "-R", "a/w"]);
    }

    #[test]
    fn bad_repo_slugs_are_rejected_without_calling_gh() {
        let runner = FakeRunner::new(vec![]);
        let oids = vec!["abc".to_string()];
        assert!(status_for_commits(&runner, "bad\"owner", "w", &oids).is_err());
        assert!(status_for_commits(&runner, "a", "", &oids).is_err());
        assert!(commit_checks(&runner, "a/../x", "w", "abc").is_err());
        assert!(job_log(&runner, "a", "w w", 1, false).is_err());
        assert!(rerun(&runner, "a", "w\n", 1, false).is_err());
        assert!(cancel(&runner, "", "w", 1).is_err());
        assert!(runner.calls.borrow().is_empty());
    }

    #[test]
    fn bad_oids_are_rejected_by_commit_checks_without_calling_gh() {
        let runner = FakeRunner::new(vec![]);
        for bad in ["x&per_page=1", "../..", ""] {
            assert!(commit_checks(&runner, "a", "w", bad).is_err());
        }
        assert!(runner.calls.borrow().is_empty());
    }

    #[test]
    fn normal_repo_slugs_are_accepted() {
        assert!(validate_repo_slug("acme", "widgets-2.x_y").is_ok());
        let runner = FakeRunner::new(vec![Ok(String::new())]);
        assert!(cancel(&runner, "acme", "widgets-2.x_y", 1).is_ok());
    }

    #[test]
    fn empty_nodes_is_none_with_zero_total() {
        let json = r#"{"data":{"repository":{"c0":{"statusCheckRollup":{"contexts":{"totalCount":0,"nodes":[]}}}}}}"#;
        let out = parse_status_response(json, &["a".to_string()]).unwrap();
        assert_eq!(out[0].state, CiState::None);
        assert_eq!(out[0].total, 0);
    }

    #[test]
    fn runner_error_propagates_from_status_for_commits() {
        let runner = FakeRunner::new(vec![Err(AppError::Operation("gh exploded".into()))]);
        let err = status_for_commits(&runner, "a", "w", &["abc".to_string()]).unwrap_err();
        assert!(err.to_string().contains("gh exploded"));
    }

    #[test]
    fn more_contexts_than_fetched_cannot_be_success() {
        let json = r#"{"data":{"repository":{"c0":{"statusCheckRollup":{"contexts":{"totalCount":150,"nodes":[
          {"__typename":"StatusContext","context":"a","state":"SUCCESS"}]}}}}}}"#;
        let out = parse_status_response(json, &["a".to_string()]).unwrap();
        assert_eq!(out[0].state, CiState::Pending);
        assert_eq!(out[0].total, 150);
    }

    #[test]
    fn more_contexts_than_fetched_still_reports_failure() {
        let json = r#"{"data":{"repository":{"c0":{"statusCheckRollup":{"contexts":{"totalCount":150,"nodes":[
          {"__typename":"StatusContext","context":"a","state":"FAILURE"}]}}}}}}"#;
        let out = parse_status_response(json, &["a".to_string()]).unwrap();
        assert_eq!(out[0].state, CiState::Failure);
    }

    fn op(s: &str) -> AppError { AppError::Operation(s.to_string()) }

    #[test]
    fn unknown_commit_422_on_check_runs_and_status_is_empty_not_error() {
        let runner = FakeRunner::new(vec![
            Ok(r#"{"workflow_runs":[]}"#.into()),
            Err(op("gh api repos/a/w/commits/abc123/check-runs?per_page=100 failed: gh: No commit found for SHA: abc123 (HTTP 422)")),
            Err(op("gh api repos/a/w/commits/abc123/status failed: gh: No commit found for SHA: abc123 (HTTP 422)")),
        ]);
        let out = commit_checks(&runner, "a", "w", "abc123").unwrap();
        assert!(out.runs.is_empty() && out.other.is_empty());
    }

    #[test]
    fn unknown_commit_422_on_actions_runs_is_empty_too() {
        let runner = FakeRunner::new(vec![
            Err(op("gh api x failed: HTTP 422 Unprocessable Entity")),
            Err(op("gh api x failed: No commit found for SHA")),
            Err(op("gh api x failed: No commit found for SHA")),
        ]);
        let out = commit_checks(&runner, "a", "w", "abc123").unwrap();
        assert!(out.runs.is_empty() && out.other.is_empty());
    }

    #[test]
    fn other_errors_still_propagate_from_commit_checks() {
        let runner = FakeRunner::new(vec![
            Ok(r#"{"workflow_runs":[]}"#.into()),
            Err(op("gh api x failed: HTTP 500 Server Error")),
        ]);
        let err = commit_checks(&runner, "a", "w", "abc123").unwrap_err();
        assert!(err.to_string().contains("HTTP 500"));
    }

    #[test]
    fn graphql_document_never_appears_in_surfaced_error() {
        let oid = "0123456789abcdef0123456789abcdef01234567";
        let runner = FakeRunner::new(vec![Err(op(&format!(
            "gh api graphql -f query=query {{ repository {{ c0: object(oid: \"{oid}\") }} }} failed: HTTP 502 Bad Gateway"
        )))]);
        let msg = status_for_commits(&runner, "a", "w", &[oid.to_string()]).unwrap_err().to_string();
        assert!(!msg.contains("query {") && !msg.contains(oid), "{msg}");
        assert!(msg.contains("HTTP 502"), "{msg}");
    }

    #[test]
    fn surfaced_error_is_truncated_and_marker_less_errors_pass_through() {
        let long = format!("gh run view --job 1 failed: {}", "é".repeat(1000));
        let msg = job_log(&FakeRunner::new(vec![Err(op(&long))]), "a", "w", 1, false).unwrap_err().to_string();
        assert!(msg.chars().count() <= 320, "{}", msg.chars().count());
        assert!(msg.ends_with('…'));
        let msg = cancel(&FakeRunner::new(vec![Err(op("failed to run gh: No such file"))]), "a", "w", 1).unwrap_err().to_string();
        assert_eq!(msg, "failed to run gh: No such file");
        let msg = rerun(&FakeRunner::new(vec![Err(op(&"z".repeat(1000)))]), "a", "w", 1, false).unwrap_err().to_string();
        assert!(msg.chars().count() <= 320 && msg.ends_with('…'));
        let msg = rerun(&FakeRunner::new(vec![Err(op("gh run rerun 1 -R a/w failed: boom"))]), "a", "w", 1, false).unwrap_err().to_string();
        assert_eq!(msg, "gh run rerun failed: boom");
    }

    fn filters() -> RunFilters { RunFilters::default() }

    fn run_json(id: u64, extra: &str) -> String {
        format!(r#"{{"id":{id},"workflow_id":11,"name":"CI","display_title":"Fix bug","head_branch":"main","head_sha":"abc",
          "event":"push","actor":{{"login":"octo"}},"status":"completed","conclusion":"success",
          "created_at":"2026-09-30T10:00:00Z","run_started_at":"2026-09-30T10:00:01Z","updated_at":"2026-09-30T10:05:00Z",
          "html_url":"https://github.com/a/w/actions/runs/{id}","run_attempt":2{extra}}}"#)
    }
    fn runs_body(n: usize) -> String {
        let items: Vec<String> = (0..n as u64).map(|i| run_json(i + 1, "")).collect();
        format!(r#"{{"workflow_runs":[{}]}}"#, items.join(","))
    }

    #[test]
    fn list_runs_builds_args_without_filters_and_defaults_page() {
        let runner = FakeRunner::new(vec![Ok(runs_body(1))]);
        list_runs(&runner, "a", "w", &filters()).unwrap();
        assert_eq!(runner.calls.borrow()[0],
            vec!["api", "-X", "GET", "repos/a/w/actions/runs", "-f", "per_page=50", "-f", "page=1"]);
    }

    #[test]
    fn list_runs_builds_args_with_filters_and_workflow_endpoint() {
        let runner = FakeRunner::new(vec![Ok(runs_body(1)), Ok(runs_body(1))]);
        let f = RunFilters {
            branch: Some("feat/x".into()), event: Some("push".into()), status: Some("failure".into()),
            actor: Some("dependabot[bot]".into()), workflow_id: Some(42), page: Some(3),
        };
        list_runs(&runner, "a", "w", &f).unwrap();
        assert_eq!(runner.calls.borrow()[0], vec![
            "api", "-X", "GET", "repos/a/w/actions/workflows/42/runs", "-f", "per_page=50", "-f", "page=3",
            "-f", "branch=feat/x", "-f", "event=push", "-f", "status=failure", "-f", "actor=dependabot[bot]",
        ]);
        // page 0 is clamped to 1; blank filters are skipped
        let f = RunFilters { page: Some(0), branch: Some("  ".into()), event: Some("".into()), ..Default::default() };
        list_runs(&runner, "a", "w", &f).unwrap();
        assert_eq!(runner.calls.borrow()[1],
            vec!["api", "-X", "GET", "repos/a/w/actions/runs", "-f", "per_page=50", "-f", "page=1"]);
    }

    #[test]
    fn list_runs_parses_fields_and_fallbacks() {
        let body = format!(r#"{{"workflow_runs":[{},
          {{"id":2,"workflow_id":12,"name":"Deploy","display_title":"","head_branch":null,"head_sha":"def","event":"schedule",
            "status":"queued","conclusion":null,"created_at":"c","html_url":"u2"}},
          {{"id":3,"workflow_id":12,"name":null,"display_title":null,"head_sha":"g","event":"push","status":"queued",
            "created_at":"c","html_url":"u3"}}]}}"#, run_json(1, ""));
        let runner = FakeRunner::new(vec![Ok(body)]);
        let page = list_runs(&runner, "a", "w", &filters()).unwrap();
        let r = &page.runs[0];
        assert_eq!((r.run_id, r.workflow_id, r.attempt), (1, 11, 2));
        assert_eq!(r.title, "Fix bug");
        assert_eq!(r.workflow_name, "CI");
        assert_eq!(r.branch.as_deref(), Some("main"));
        assert_eq!(r.actor.as_deref(), Some("octo"));
        assert_eq!(r.started_at.as_deref(), Some("2026-09-30T10:00:01Z"));
        assert_eq!(r.conclusion.as_deref(), Some("success"));
        let r = &page.runs[1];
        assert_eq!(r.title, "Deploy");
        assert_eq!((r.branch.clone(), r.actor.clone(), r.conclusion.clone(), r.started_at.clone()), (None, None, None, None));
        assert_eq!(r.attempt, 1);
        assert_eq!(page.runs[2].title, "Workflow run");
    }

    #[test]
    fn list_runs_has_more_only_for_a_full_page() {
        let runner = FakeRunner::new(vec![Ok(runs_body(50)), Ok(runs_body(49))]);
        assert!(list_runs(&runner, "a", "w", &filters()).unwrap().has_more);
        assert!(!list_runs(&runner, "a", "w", &filters()).unwrap().has_more);
    }

    #[test]
    fn list_runs_rejects_bad_filters_without_calling_gh() {
        let runner = FakeRunner::new(vec![]);
        let bad = [
            RunFilters { status: Some("bogus".into()), ..Default::default() },
            RunFilters { event: Some("Push".into()), ..Default::default() },
            RunFilters { event: Some("pull request".into()), ..Default::default() },
            RunFilters { event: Some("a".repeat(41)), ..Default::default() },
            RunFilters { actor: Some("bad;actor".into()), ..Default::default() },
            RunFilters { actor: Some("-lead".into()), ..Default::default() },
            RunFilters { actor: Some("a".repeat(65)), ..Default::default() },
            RunFilters { branch: Some("a\nb".into()), ..Default::default() },
            RunFilters { branch: Some("a".repeat(256)), ..Default::default() },
            RunFilters { page: Some(5000), ..Default::default() },
        ];
        for f in &bad {
            let e = list_runs(&runner, "a", "w", f).unwrap_err().to_string();
            assert!(e.contains("invalid"), "{e}");
        }
        assert!(list_runs(&runner, "a/b", "w", &filters()).is_err());
        assert!(runner.calls.borrow().is_empty());
    }

    #[test]
    fn list_runs_accepts_boundary_values() {
        let runner = FakeRunner::new(vec![Ok(runs_body(0)), Ok(runs_body(0)), Ok(runs_body(0))]);
        let f = RunFilters {
            branch: Some("b".repeat(255)), event: Some("a".repeat(40)),
            actor: Some(format!("{}[bot]", "a".repeat(58))), status: Some("startup_failure".into()),
            page: Some(1000), workflow_id: None,
        };
        list_runs(&runner, "a", "w", &f).unwrap();
        for s in ["completed", "in_progress", "queued", "waiting", "requested", "pending", "success", "failure",
                  "cancelled", "skipped", "timed_out", "neutral", "action_required", "stale"] {
            let f = RunFilters { status: Some(s.into()), ..Default::default() };
            if s == "completed" || s == "stale" { list_runs(&runner, "a", "w", &f).unwrap(); }
            else { assert!(validate_status(s).is_ok(), "{s}"); }
        }
    }

    #[test]
    fn list_workflows_sorts_case_insensitively() {
        let body = r#"{"workflows":[{"id":1,"name":"zeta","state":"active"},{"id":2,"name":"Alpha","state":"disabled_manually"},{"id":3,"name":"beta","state":"active"}]}"#;
        let runner = FakeRunner::new(vec![Ok(body.into())]);
        let out = list_workflows(&runner, "a", "w").unwrap();
        assert_eq!(out.iter().map(|w| w.name.as_str()).collect::<Vec<_>>(), vec!["Alpha", "beta", "zeta"]);
        assert_eq!(out[0].state, "disabled_manually");
        assert_eq!(runner.calls.borrow()[0],
            vec!["api", "-X", "GET", "repos/a/w/actions/workflows", "-f", "per_page=100"]);
        assert!(list_workflows(&FakeRunner::new(vec![]), "a b", "w").is_err());
    }

    #[test]
    fn run_jobs_parses_steps_and_builds_endpoint() {
        let runner = FakeRunner::new(vec![Ok(JOBS.into())]);
        let jobs = run_jobs(&runner, "a", "w", 100).unwrap();
        assert_eq!(runner.calls.borrow()[0], vec!["api", "repos/a/w/actions/runs/100/jobs?per_page=100"]);
        assert_eq!(jobs[0].job_id, 500);
        assert_eq!(jobs[0].steps[1].name, "Run tests");
        assert!(run_jobs(&FakeRunner::new(vec![]), "", "w", 1).is_err());
    }

    #[test]
    fn new_fns_shorten_runner_errors() {
        let argv_err = || Err(op("gh api -X GET repos/a/w/actions/runs -f per_page=50 -f actor=secret failed: HTTP 502 Bad Gateway"));
        for msg in [
            list_runs(&FakeRunner::new(vec![argv_err()]), "a", "w", &filters()).unwrap_err().to_string(),
            list_workflows(&FakeRunner::new(vec![argv_err()]), "a", "w").unwrap_err().to_string(),
            run_jobs(&FakeRunner::new(vec![argv_err()]), "a", "w", 1).unwrap_err().to_string(),
        ] {
            assert!(!msg.contains("actor=secret") && !msg.contains("per_page"), "{msg}");
            assert!(msg.contains("HTTP 502"), "{msg}");
        }
    }
}

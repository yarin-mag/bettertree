# CI Viewing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show GitHub CI state in bettertree: status badges on commits/branches/PRs, a per-commit Checks panel, an in-app job log viewer, re-run/cancel, and per-workflow custom names + favorites.

**Architecture:** A new Rust module `ci.rs` wraps `gh` (GraphQL for batched commit status, REST + `gh run` for detail/logs/actions) behind the existing `GhRunner` trait. Three zustand stores (`ciStatusStore`, `ciChecksStore`, `ciPrefsStore`) feed a `CiBadge`, a `ChecksPanel` (tab in the commit drawer/modal) and a `LogViewer`. Custom names/favorites live in `localStorage` per repo.

**Tech Stack:** Rust (tauri 2, serde, serde_json, `gh` CLI), React 18 + TypeScript, zustand, vitest + Testing Library, lucide-react, Tailwind theme tokens.

**Spec:** `docs/superpowers/specs/2026-09-30-ci-viewing-design.md`

## Global Constraints

- GitHub only, via the `gh` CLI already used by `github.rs`; no new npm or cargo dependencies.
- Names and favorites are per repo, stored in `localStorage` (try/catch), never sent to GitHub; attached to **workflows** only (by `workflowId`), not jobs.
- Badge states are exactly `success | pending | failure | none`. Settled (`success`/`failure`) results are never re-fetched except by explicit refresh; only `pending` ones poll (every 30 s, window visible).
- GraphQL status batches are at most 100 oids per call.
- Job logs are capped at 2 MB (tail kept) unless the caller asks for the full log.
- Default: when favorites-only is on, row/branch badges follow favorites (`badgeFollowsFavorites: true`). This was assumed, not confirmed — keep it one flag.
- No git in this project: replace "commit" with a **Checkpoint** (run the suites). Do not run git commands.
- Match existing style: toasts via `toast` from `src/store/toastStore.ts`, empty states via `EmptyState`, shortcuts via `useShortcut`, virtual lists via `useVirtualList`. Tests: `npx vitest run`, `npx tsc --noEmit`, `cd src-tauri && cargo test`.

## Review Focus

- Commit with **zero CI** (no checks at all): badge must render nothing, panel must say "No CI on this commit", never an error.
- **Workflow renamed to empty string / whitespace**: fall back to the original name, never render a blank title.
- **Failed job with no failed step recorded** (cancelled/timed out before steps): log viewer opens at the top, not at a stale or undefined step.
- **`gh` missing / unauthenticated / rate-limited**: badges degrade to `none` silently with at most one toast per failure streak; panel shows the actionable `EmptyState`.
- **Favorites-only with no favorites starred**: panel shows a hint ("Star a workflow to see it here") rather than an empty screen, and badges fall back to the whole commit.
- **Huge log (>2 MB) and ANSI escape sequences that are malformed/partial**: viewer must not crash or hang; unknown sequences are dropped.

---

## File Structure

| File | Responsibility |
|---|---|
| `src-tauri/src/ci.rs` (new) | Types, GraphQL status batch, checks/jobs assembly, job log, rerun/cancel, all with fake-runner tests |
| `src-tauri/src/github.rs` (modify) | Extract `check_state` from `compute_status_rollup` for reuse |
| `src-tauri/src/commands.rs`, `lib.rs` (modify) | Register 5 commands |
| `src/lib/tauri.ts` (modify) | Types + invoke wrappers |
| `src/lib/ciErrors.ts` (new) | Map `gh` error text to `CiErrorKind` |
| `src/lib/ci.ts` (new) | Pure helpers: workflow display name, sort, badge state under favorites, log parsing, duration formatting |
| `src/lib/ansi.ts` (new) | ANSI SGR → styled segments |
| `src/store/ciPrefsStore.ts` (new) | Per-repo names/favorites/flags, persisted |
| `src/store/ciStatusStore.ts` (new) | Batched, cached, pending-polled commit status |
| `src/store/ciChecksStore.ts` (new) | Checks for the open commit + actions |
| `src/components/CiBadge.tsx` (new) | Badge icon + tooltip |
| `src/components/ChecksPanel.tsx` (new) | Workflow cards, star/rename, filter, actions |
| `src/components/LogViewer.tsx` (new) | Virtualized, searchable log modal |
| `src/components/CommitGraphRow.tsx`, `BranchTree.tsx`, `CommitGraph.tsx`, `PullRequestsScreen.tsx`, `CommitDrawer.tsx`, `PullRequestDetail.tsx` (modify) | Integration |

---

### Task 1: Rust — types, shared state classification, batched status

**Files:**
- Create: `src-tauri/src/ci.rs`
- Modify: `src-tauri/src/github.rs` (extract helper), `src-tauri/src/lib.rs` (add `mod ci;`)

**Interfaces:**
- Produces (Rust, serde camelCase): `CiState`, `CommitCi { oid, state, total, failed, pending, by_workflow: Vec<WorkflowCi> }`, `WorkflowCi { workflow_id: u64, workflow_name: String, state: CiState }`, `pub fn status_for_commits(runner: &dyn GhRunner, owner: &str, repo: &str, oids: &[String]) -> Result<Vec<CommitCi>, AppError>`, `pub fn build_status_query(owner: &str, repo: &str, oids: &[String]) -> String`, `pub fn parse_status_response(json: &str, oids: &[String]) -> Result<Vec<CommitCi>, AppError>`.
- Produces (github.rs): `pub(crate) fn check_state(conclusion: Option<&str>, status: Option<&str>, state: Option<&str>) -> &'static str` returning `"failure" | "pending" | "success"`.

- [ ] **Step 1: Extract `check_state` in `github.rs`**

Replace the per-check classification inside `compute_status_rollup` with a call to a new function, keeping behavior identical:

```rust
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
```

and in `compute_status_rollup` loop use:

```rust
match check_state(check.conclusion.as_deref(), check.status.as_deref(), check.state.as_deref()) {
    "failure" => has_failure = true,
    "pending" => has_pending = true,
    _ => {}
}
```

- [ ] **Step 2: Run existing rollup tests to confirm no regression**

Run: `cd src-tauri && cargo test compute_status_rollup`
Expected: all existing `compute_status_rollup_*` tests PASS.

- [ ] **Step 3: Write failing tests in `ci.rs`**

```rust
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
      "c0":{"statusCheckRollup":{"contexts":{"nodes":[
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
}
```

(Note: the test helper oids `"a"`, `"b"`, `"c"` are used only with `parse_status_response`/`build_status_query`, which don't validate; only `status_for_commits` validates hex, and its chunk test uses 40-digit numeric strings.)

- [ ] **Step 4: Run to verify failure**

Run: `cd src-tauri && cargo test ci::`
Expected: FAIL — module/functions not defined.

- [ ] **Step 5: Implement**

```rust
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
    let fields = "... on Commit { statusCheckRollup { contexts(first: 100) { nodes { __typename \
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
struct Contexts { nodes: Vec<Node> }
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
        let total = rollup.contexts.nodes.len() as u32;
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
        let state = if total == 0 { CiState::None } else if failed > 0 { CiState::Failure } else if pending > 0 { CiState::Pending } else { CiState::Success };
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

pub fn status_for_commits(runner: &dyn GhRunner, owner: &str, repo: &str, oids: &[String]) -> Result<Vec<CommitCi>, AppError> {
    // Oids are interpolated into the GraphQL document, so refuse anything that isn't hex.
    if let Some(bad) = oids.iter().find(|o| o.is_empty() || !o.chars().all(|c| c.is_ascii_hexdigit())) {
        return Err(AppError::Operation(format!("invalid commit id: {bad}")));
    }
    let mut out = Vec::with_capacity(oids.len());
    for chunk in oids.chunks(STATUS_BATCH) {
        let query = build_status_query(owner, repo, chunk);
        let response = runner.run(&["api", "graphql", "-f", &format!("query={query}")])?;
        out.extend(parse_status_response(&response, chunk)?);
    }
    Ok(out)
}
```

Add `mod ci;` to `src-tauri/src/lib.rs` (Edit tool, next to `mod conflicts;`).

- [ ] **Step 6: Run tests**

Run: `cd src-tauri && cargo test ci:: && cargo test compute_status_rollup`
Expected: PASS.

- [ ] **Step 7: Checkpoint** — `cd src-tauri && cargo test` (all green).

---

### Task 2: Rust — checks detail, job log, re-run/cancel, commands, TS wrappers

**Files:**
- Modify: `src-tauri/src/ci.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src/lib/tauri.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces (Rust): `Step { number: u32, name, status, conclusion: Option<String> }`, `Job { job_id: u64, name, status, conclusion: Option<String>, started_at: Option<String>, completed_at: Option<String>, url, steps: Vec<Step> }`, `WorkflowRunInfo { run_id: u64, workflow_id: u64, workflow_name, status, conclusion: Option<String>, url, started_at: Option<String>, updated_at: Option<String>, jobs: Vec<Job> }`, `OtherCheck { name, state: CiState, url: Option<String>, source: String }`, `CommitChecks { oid, runs, other }`, `JobLog { text: String, truncated: bool }`; fns `commit_checks(runner,owner,repo,oid)`, `job_log(runner,owner,repo,job_id,full)`, `rerun(runner,owner,repo,run_id,failed_only)`, `cancel(runner,owner,repo,run_id)`.
- Produces (TS, `src/lib/tauri.ts`, camelCase mirror): `CiState`, `WorkflowCi`, `CommitCi`, `CiStep`, `CiJob`, `CiWorkflowRun`, `CiOtherCheck`, `CommitChecks`, `JobLog`; wrappers `invokeCiStatusForCommits(repoPath, oids): Promise<CommitCi[]>`, `invokeCiCommitChecks(repoPath, oid): Promise<CommitChecks>`, `invokeCiJobLog(repoPath, jobId: number, full: boolean): Promise<JobLog>`, `invokeCiRerun(repoPath, runId: number, failedOnly: boolean): Promise<void>`, `invokeCiCancel(repoPath, runId: number): Promise<void>`.

- [ ] **Step 1: Failing tests** (append to `ci.rs` tests module)

```rust
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
    let text = format!("{}é", "x".repeat(LOG_CAP_BYTES));
    let runner = FakeRunner::new(vec![Ok(text)]);
    let log = job_log(&runner, "a", "w", 1, false).unwrap();
    assert!(log.text.is_char_boundary(0));
    assert!(log.truncated);
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
```

- [ ] **Step 2: Run to verify failure** — `cd src-tauri && cargo test ci::` → FAIL (undefined).

- [ ] **Step 3: Implement** (append to `ci.rs`, above tests)

```rust
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

pub fn commit_checks(runner: &dyn GhRunner, owner: &str, repo: &str, oid: &str) -> Result<CommitChecks, AppError> {
    let runs_json = runner.run(&["api", &format!("repos/{owner}/{repo}/actions/runs?head_sha={oid}&per_page=100")])?;
    let runs_resp: RunsResp = parse(&runs_json, "workflow runs")?;
    let mut runs = Vec::new();
    for r in runs_resp.workflow_runs {
        let jobs_json = runner.run(&["api", &format!("repos/{owner}/{repo}/actions/runs/{}/jobs?per_page=100", r.id)])?;
        let jobs: JobsResp = parse(&jobs_json, "jobs")?;
        runs.push(WorkflowRunInfo {
            run_id: r.id, workflow_id: r.workflow_id, workflow_name: r.name.unwrap_or_default(),
            status: r.status.unwrap_or_default(), conclusion: r.conclusion, url: r.html_url,
            started_at: r.run_started_at, updated_at: r.updated_at,
            jobs: jobs.jobs.into_iter().map(|j| Job {
                job_id: j.id, name: j.name, status: j.status, conclusion: j.conclusion,
                started_at: j.started_at, completed_at: j.completed_at, url: j.html_url, steps: j.steps,
            }).collect(),
        });
    }
    let cr: CheckRunsResp = parse(&runner.run(&["api", &format!("repos/{owner}/{repo}/commits/{oid}/check-runs?per_page=100")])?, "check runs")?;
    let st: StatusResp = parse(&runner.run(&["api", &format!("repos/{owner}/{repo}/commits/{oid}/status")])?, "commit status")?;
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
    let text = runner.run(&["run", "view", "--job", &job_id.to_string(), "--log", "-R", &format!("{owner}/{repo}")])?;
    if full || text.len() <= LOG_CAP_BYTES {
        return Ok(JobLog { text, truncated: false });
    }
    let mut start = text.len() - LOG_CAP_BYTES;
    while !text.is_char_boundary(start) { start += 1; }
    Ok(JobLog { text: text[start..].to_string(), truncated: true })
}

pub fn rerun(runner: &dyn GhRunner, owner: &str, repo: &str, run_id: u64, failed_only: bool) -> Result<(), AppError> {
    let id = run_id.to_string();
    let slug = format!("{owner}/{repo}");
    let mut args = vec!["run", "rerun", id.as_str()];
    if failed_only { args.push("--failed"); }
    args.extend(["-R", slug.as_str()]);
    runner.run(&args).map(|_| ())
}

pub fn cancel(runner: &dyn GhRunner, owner: &str, repo: &str, run_id: u64) -> Result<(), AppError> {
    runner.run(&["run", "cancel", &run_id.to_string(), "-R", &format!("{owner}/{repo}")]).map(|_| ())
}
```

Note: the truncation test expects `text.len() == LOG_CAP_BYTES` only for ASCII input; the multibyte test only asserts `truncated`.

- [ ] **Step 4: Run tests** — `cd src-tauri && cargo test ci::` → PASS.

- [ ] **Step 5: Commands** — append to `commands.rs` (Edit tool; pattern matches `list_commit_pull_requests`):

```rust
#[tauri::command]
pub async fn ci_status_for_commits(repo_path: String, oids: Vec<String>) -> Result<Vec<crate::ci::CommitCi>, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        crate::ci::status_for_commits(&SystemGhRunner, &owner, &repo, &oids)
    }).await
}
#[tauri::command]
pub async fn ci_commit_checks(repo_path: String, oid: String) -> Result<crate::ci::CommitChecks, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        crate::ci::commit_checks(&SystemGhRunner, &owner, &repo, &oid)
    }).await
}
#[tauri::command]
pub async fn ci_job_log(repo_path: String, job_id: u64, full: bool) -> Result<crate::ci::JobLog, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        crate::ci::job_log(&SystemGhRunner, &owner, &repo, job_id, full)
    }).await
}
#[tauri::command]
pub async fn ci_rerun(repo_path: String, run_id: u64, failed_only: bool) -> Result<(), AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        crate::ci::rerun(&SystemGhRunner, &owner, &repo, run_id, failed_only)
    }).await
}
#[tauri::command]
pub async fn ci_cancel(repo_path: String, run_id: u64) -> Result<(), AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        crate::ci::cancel(&SystemGhRunner, &owner, &repo, run_id)
    }).await
}
```

Register in `lib.rs` `generate_handler!` (Edit tool): `commands::ci_status_for_commits, commands::ci_commit_checks, commands::ci_job_log, commands::ci_rerun, commands::ci_cancel,`.

- [ ] **Step 6: TS wrappers** — append to `src/lib/tauri.ts` (Edit tool):

```ts
export type CiState = "success" | "pending" | "failure" | "none";
export interface WorkflowCi { workflowId: number; workflowName: string; state: CiState }
export interface CommitCi { oid: string; state: CiState; total: number; failed: number; pending: number; byWorkflow: WorkflowCi[] }
export interface CiStep { number: number; name: string; status: string; conclusion: string | null }
export interface CiJob { jobId: number; name: string; status: string; conclusion: string | null; startedAt: string | null; completedAt: string | null; url: string; steps: CiStep[] }
export interface CiWorkflowRun { runId: number; workflowId: number; workflowName: string; status: string; conclusion: string | null; url: string; startedAt: string | null; updatedAt: string | null; jobs: CiJob[] }
export interface CiOtherCheck { name: string; state: CiState; url: string | null; source: string }
export interface CommitChecks { oid: string; runs: CiWorkflowRun[]; other: CiOtherCheck[] }
export interface JobLog { text: string; truncated: boolean }

export const invokeCiStatusForCommits = (repoPath: string, oids: string[]) =>
  invoke<CommitCi[]>("ci_status_for_commits", { repoPath, oids });
export const invokeCiCommitChecks = (repoPath: string, oid: string) =>
  invoke<CommitChecks>("ci_commit_checks", { repoPath, oid });
export const invokeCiJobLog = (repoPath: string, jobId: number, full: boolean) =>
  invoke<JobLog>("ci_job_log", { repoPath, jobId, full });
export const invokeCiRerun = (repoPath: string, runId: number, failedOnly: boolean) =>
  invoke<void>("ci_rerun", { repoPath, runId, failedOnly });
export const invokeCiCancel = (repoPath: string, runId: number) => invoke<void>("ci_cancel", { repoPath, runId });
```

- [ ] **Step 7: Checkpoint** — `cd src-tauri && cargo test` and `npx tsc --noEmit` both green.

---

### Task 3: Pure helpers — errors, display, log parsing, ANSI

**Files:**
- Create: `src/lib/ciErrors.ts`, `src/lib/ci.ts`, `src/lib/ansi.ts`
- Test: `src/__tests__/ci.test.ts`, `src/__tests__/ansi.test.ts`

**Interfaces:**
- Produces:
  - `ciErrors.ts`: `type CiErrorKind = "no-gh" | "unauthenticated" | "rate-limited" | "forbidden" | "other"`, `classifyCiError(message: string): { kind: CiErrorKind; retryAt?: number }`.
  - `ci.ts`: `workflowTitle(name: string, custom: string | undefined): { title: string; original: string | null }`, `sortRuns(runs: CiWorkflowRun[]): CiWorkflowRun[]` (failure, then in progress, then success, then others; stable by name), `runState(run: CiWorkflowRun): CiState`, `badgeState(ci: CommitCi, opts: { favorites: number[]; followFavorites: boolean }): CiState`, `formatDuration(startedAt: string | null, endedAt: string | null): string`, `firstFailedStep(job: CiJob): number | null`, `parseLogSteps(text: string): { stepName: string; lines: string[] }[]`.
  - `ansi.ts`: `type AnsiSegment = { text: string; className: string }`, `parseAnsi(line: string): AnsiSegment[]`.

- [ ] **Step 1: Failing tests** `src/__tests__/ci.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { classifyCiError } from "../lib/ciErrors";
import { workflowTitle, sortRuns, badgeState, formatDuration, firstFailedStep, parseLogSteps } from "../lib/ci";
import type { CiWorkflowRun, CommitCi, CiJob } from "../lib/tauri";

const run = (name: string, status: string, conclusion: string | null): CiWorkflowRun => ({
  runId: 1, workflowId: 1, workflowName: name, status, conclusion, url: "", startedAt: null, updatedAt: null, jobs: [],
});

describe("classifyCiError", () => {
  it("recognizes the common gh failures", () => {
    expect(classifyCiError("failed to run gh: No such file").kind).toBe("no-gh");
    expect(classifyCiError("gh: To get started with GitHub CLI, please run: gh auth login").kind).toBe("unauthenticated");
    expect(classifyCiError("HTTP 403: API rate limit exceeded").kind).toBe("rate-limited");
    expect(classifyCiError("HTTP 403: Resource not accessible by integration").kind).toBe("forbidden");
    expect(classifyCiError("boom").kind).toBe("other");
  });
});

describe("workflowTitle", () => {
  it("shows custom name with original muted, and ignores blank custom names", () => {
    expect(workflowTitle("CI", "My CI")).toEqual({ title: "My CI", original: "CI" });
    expect(workflowTitle("CI", "   ")).toEqual({ title: "CI", original: null });
    expect(workflowTitle("CI", undefined)).toEqual({ title: "CI", original: null });
    expect(workflowTitle("", undefined).title).toBe("Workflow");
  });
});

describe("sortRuns", () => {
  it("orders failures, then running, then success", () => {
    const sorted = sortRuns([run("b", "completed", "success"), run("a", "in_progress", null), run("c", "completed", "failure")]);
    expect(sorted.map((r) => r.workflowName)).toEqual(["c", "a", "b"]);
  });
});

describe("badgeState", () => {
  const ci: CommitCi = {
    oid: "x", state: "failure", total: 3, failed: 1, pending: 0,
    byWorkflow: [
      { workflowId: 1, workflowName: "CI", state: "success" },
      { workflowId: 2, workflowName: "Lint", state: "failure" },
    ],
  };
  it("follows favorites when enabled and some favorite is present on the commit", () => {
    expect(badgeState(ci, { favorites: [1], followFavorites: true })).toBe("success");
    expect(badgeState(ci, { favorites: [2], followFavorites: true })).toBe("failure");
  });
  it("falls back to whole commit when no favorites, none present, or following is off", () => {
    expect(badgeState(ci, { favorites: [], followFavorites: true })).toBe("failure");
    expect(badgeState(ci, { favorites: [99], followFavorites: true })).toBe("failure");
    expect(badgeState(ci, { favorites: [1], followFavorites: false })).toBe("failure");
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes and handles missing times", () => {
    expect(formatDuration("2026-09-30T10:00:00Z", "2026-09-30T10:00:42Z")).toBe("42s");
    expect(formatDuration("2026-09-30T10:00:00Z", "2026-09-30T10:04:05Z")).toBe("4m 5s");
    expect(formatDuration(null, null)).toBe("");
  });
});

describe("firstFailedStep", () => {
  const job = (steps: { number: number; conclusion: string | null }[]): CiJob => ({
    jobId: 1, name: "j", status: "completed", conclusion: "failure", startedAt: null, completedAt: null, url: "",
    steps: steps.map((s) => ({ ...s, name: `s${s.number}`, status: "completed" })),
  });
  it("returns the first failed step or null when none recorded", () => {
    expect(firstFailedStep(job([{ number: 1, conclusion: "success" }, { number: 2, conclusion: "failure" }]))).toBe(2);
    expect(firstFailedStep(job([{ number: 1, conclusion: "cancelled" }]))).toBeNull();
    expect(firstFailedStep(job([]))).toBeNull();
  });
});

describe("parseLogSteps", () => {
  it("groups gh log lines (job\\tstep\\ttime content) by step, keeping order", () => {
    const text = "test\tSet up job\t2026-09-30T10:00:00.0Z hello\ntest\tRun tests\t2026-09-30T10:00:01.0Z boom\ntest\tRun tests\t2026-09-30T10:00:02.0Z bang\n";
    const steps = parseLogSteps(text);
    expect(steps.map((s) => s.stepName)).toEqual(["Set up job", "Run tests"]);
    expect(steps[1].lines).toEqual(["boom", "bang"]);
  });
  it("keeps unparseable lines under an 'Output' step instead of dropping them", () => {
    expect(parseLogSteps("just text\n")).toEqual([{ stepName: "Output", lines: ["just text"] }]);
  });
});
```

`src/__tests__/ansi.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseAnsi } from "../lib/ansi";

describe("parseAnsi", () => {
  it("returns one plain segment for text without escapes", () => {
    expect(parseAnsi("hello")).toEqual([{ text: "hello", className: "" }]);
  });
  it("colors segments and resets", () => {
    const out = parseAnsi("\u001b[31mred\u001b[0m plain");
    expect(out[0]).toEqual({ text: "red", className: "text-danger" });
    expect(out[1]).toEqual({ text: " plain", className: "" });
  });
  it("drops unknown or malformed sequences without throwing", () => {
    expect(parseAnsi("a\u001b[38;5;99mb\u001b[")).toEqual([{ text: "ab", className: "" }]);
    expect(() => parseAnsi("\u001b[")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/__tests__/ci.test.ts src/__tests__/ansi.test.ts` → FAIL (modules missing).

- [ ] **Step 3: Implement**

`src/lib/ciErrors.ts`:

```ts
export type CiErrorKind = "no-gh" | "unauthenticated" | "rate-limited" | "forbidden" | "other";

export function classifyCiError(message: string): { kind: CiErrorKind } {
  const m = message.toLowerCase();
  if (m.includes("failed to run gh") || m.includes("no such file") || m.includes("not installed")) return { kind: "no-gh" };
  if (m.includes("gh auth login") || m.includes("not logged in") || m.includes("authentication")) return { kind: "unauthenticated" };
  if (m.includes("rate limit")) return { kind: "rate-limited" };
  if (m.includes("403") || m.includes("not accessible") || m.includes("forbidden")) return { kind: "forbidden" };
  return { kind: "other" };
}
```

`src/lib/ci.ts`:

```ts
import type { CiJob, CiState, CiWorkflowRun, CommitCi } from "./tauri";

export function workflowTitle(name: string, custom: string | undefined): { title: string; original: string | null } {
  const trimmed = custom?.trim();
  const base = name.trim() || "Workflow";
  if (trimmed) return { title: trimmed, original: name.trim() || null };
  return { title: base, original: null };
}

export function runState(run: CiWorkflowRun): CiState {
  if (run.status !== "completed") return "pending";
  switch ((run.conclusion ?? "").toLowerCase()) {
    case "success": case "neutral": case "skipped": return "success";
    case "": return "pending";
    default: return "failure";
  }
}

const RANK: Record<CiState, number> = { failure: 0, pending: 1, success: 2, none: 3 };

export function sortRuns(runs: CiWorkflowRun[]): CiWorkflowRun[] {
  return [...runs].sort((a, b) => RANK[runState(a)] - RANK[runState(b)] || a.workflowName.localeCompare(b.workflowName));
}

export function badgeState(ci: CommitCi, opts: { favorites: number[]; followFavorites: boolean }): CiState {
  if (!opts.followFavorites || opts.favorites.length === 0) return ci.state;
  const mine = ci.byWorkflow.filter((w) => opts.favorites.includes(w.workflowId));
  if (mine.length === 0) return ci.state;
  if (mine.some((w) => w.state === "failure")) return "failure";
  if (mine.some((w) => w.state === "pending")) return "pending";
  return "success";
}

export function formatDuration(startedAt: string | null, endedAt: string | null): string {
  if (!startedAt || !endedAt) return "";
  const seconds = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000));
  if (Number.isNaN(seconds)) return "";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes}m ${rest}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function firstFailedStep(job: CiJob): number | null {
  const step = job.steps.find((s) => (s.conclusion ?? "").toLowerCase() === "failure");
  return step ? step.number : null;
}

// `gh run view --log` prints "<job>\t<step>\t<timestamp> <content>" per line.
export function parseLogSteps(text: string): { stepName: string; lines: string[] }[] {
  const out: { stepName: string; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    if (raw === "") continue;
    const parts = raw.split("\t");
    let stepName = "Output";
    let content = raw;
    if (parts.length >= 3) {
      stepName = parts[1];
      content = parts.slice(2).join("\t").replace(/^\S+\s/, "");
    }
    const last = out[out.length - 1];
    if (last && last.stepName === stepName) last.lines.push(content);
    else out.push({ stepName, lines: [content] });
  }
  return out;
}
```

`src/lib/ansi.ts`:

```ts
export interface AnsiSegment { text: string; className: string }

const COLORS: Record<number, string> = {
  31: "text-danger", 32: "text-success", 33: "text-merged", 34: "text-accent", 35: "text-merged", 36: "text-accent",
  90: "text-text-muted",
};

// Handles SGR color/bold/reset; every other or malformed escape sequence is dropped.
export function parseAnsi(line: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  const re = /\u001b\[([0-9;]*)m|\u001b\[[0-9;]*[A-Za-z]?|\u001b/g;
  let className = "";
  let last = 0;
  const push = (text: string) => {
    if (text) segments.push({ text, className });
  };
  let match: RegExpExecArray | null;
  while ((match = re.exec(line))) {
    push(line.slice(last, match.index));
    last = re.lastIndex;
    if (match[1] === undefined) continue;
    const codes = match[1].split(";").map((c) => Number(c || 0));
    for (const code of codes) {
      if (code === 0) className = "";
      else if (code === 1) className = `${className} font-bold`.trim();
      else if (COLORS[code]) className = COLORS[code];
    }
  }
  push(line.slice(last));
  // Merge adjacent segments with identical styling; an empty line still yields one empty segment.
  const merged = segments.reduce<AnsiSegment[]>((acc, s) => {
    const prev = acc[acc.length - 1];
    if (prev && prev.className === s.className) prev.text += s.text;
    else acc.push({ ...s });
    return acc;
  }, []);
  return merged.length ? merged : [{ text: "", className: "" }];
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/__tests__/ci.test.ts src/__tests__/ansi.test.ts` → PASS.

- [ ] **Step 5: Checkpoint** — `npx tsc --noEmit` clean.

---

### Task 4: Stores — prefs, status (batched/polled), checks

**Files:**
- Create: `src/store/ciPrefsStore.ts`, `src/store/ciStatusStore.ts`, `src/store/ciChecksStore.ts`
- Test: `src/__tests__/ciStores.test.ts`

**Interfaces:**
- Consumes: Task 2 wrappers/types; Task 3 `classifyCiError`; `toast`; `nextFetchDelay` from `src/hooks/useAutoFetch.ts`.
- Produces:
  - `useCiPrefsStore`: `getPrefs(repoPath): CiPrefs`, `setName(repoPath, workflowId, name)`, `toggleFavorite(repoPath, workflowId)`, `setFavoritesOnly(repoPath, on)`, `setBadgeFollowsFavorites(repoPath, on)`; `CiPrefs = { names: Record<number, string>; favorites: number[]; favoritesOnly: boolean; badgeFollowsFavorites: boolean }`; persisted under `ciPrefs` in `localStorage`.
  - `useCiStatusStore`: `byOid: Record<string, CommitCi>`, `request(repoPath, oids)` (debounced 300 ms), `refresh(repoPath, oids)` (bypass cache), `CI_POLL_MS = 30_000`; exported `resetCiStatus()` for tests.
  - `useCiChecksStore`: `checks: CommitChecks | null`, `loading`, `error: { kind: CiErrorKind; message: string } | null`, `load(repoPath, oid)`, `refresh()`, `rerun(runId, failedOnly)`, `cancel(runId)`; `CI_CHECKS_POLL_MS = 15_000`.

- [ ] **Step 1: Failing tests** `src/__tests__/ciStores.test.ts`

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/tauri", () => ({
  invokeCiStatusForCommits: vi.fn(),
  invokeCiCommitChecks: vi.fn(),
  invokeCiRerun: vi.fn(),
  invokeCiCancel: vi.fn(),
}));
import * as tauri from "../lib/tauri";
import { useCiPrefsStore } from "../store/ciPrefsStore";
import { useCiStatusStore, resetCiStatus, CI_POLL_MS } from "../store/ciStatusStore";
import { useCiChecksStore } from "../store/ciChecksStore";

const ci = (oid: string, state: any = "success") => ({ oid, state, total: 1, failed: 0, pending: state === "pending" ? 1 : 0, byWorkflow: [] });

describe("ciPrefsStore", () => {
  beforeEach(() => { localStorage.clear(); useCiPrefsStore.setState({ prefs: {} } as any); });
  it("keeps names and favorites per repo and persists them", () => {
    const s = useCiPrefsStore.getState();
    s.setName("/a", 1, "My CI");
    s.toggleFavorite("/a", 1);
    expect(useCiPrefsStore.getState().getPrefs("/a")).toMatchObject({ names: { 1: "My CI" }, favorites: [1] });
    expect(useCiPrefsStore.getState().getPrefs("/b").favorites).toEqual([]);
    expect(JSON.parse(localStorage.getItem("ciPrefs")!)["/a"].favorites).toEqual([1]);
    s.toggleFavorite("/a", 1);
    expect(useCiPrefsStore.getState().getPrefs("/a").favorites).toEqual([]);
  });
  it("an empty name removes the custom name", () => {
    const s = useCiPrefsStore.getState();
    s.setName("/a", 1, "X");
    s.setName("/a", 1, "  ");
    expect(useCiPrefsStore.getState().getPrefs("/a").names[1]).toBeUndefined();
  });
});

describe("ciStatusStore", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); resetCiStatus(); });
  afterEach(() => vi.useRealTimers());

  it("debounces and batches requested oids into one call, skipping settled ones", async () => {
    (tauri.invokeCiStatusForCommits as any).mockResolvedValue([ci("a"), ci("b")]);
    const s = useCiStatusStore.getState();
    s.request("/r", ["a"]); s.request("/r", ["b", "a"]);
    await vi.advanceTimersByTimeAsync(350);
    expect(tauri.invokeCiStatusForCommits).toHaveBeenCalledTimes(1);
    expect((tauri.invokeCiStatusForCommits as any).mock.calls[0][1].sort()).toEqual(["a", "b"]);
    s.request("/r", ["a", "b"]);
    await vi.advanceTimersByTimeAsync(350);
    expect(tauri.invokeCiStatusForCommits).toHaveBeenCalledTimes(1);
  });

  it("re-polls only pending oids", async () => {
    (tauri.invokeCiStatusForCommits as any)
      .mockResolvedValueOnce([ci("a", "pending"), ci("b", "success")])
      .mockResolvedValueOnce([ci("a", "success")]);
    useCiStatusStore.getState().request("/r", ["a", "b"]);
    await vi.advanceTimersByTimeAsync(350);
    await vi.advanceTimersByTimeAsync(CI_POLL_MS + 10);
    expect((tauri.invokeCiStatusForCommits as any).mock.calls[1][1]).toEqual(["a"]);
    expect(useCiStatusStore.getState().byOid["a"].state).toBe("success");
  });

  it("on failure degrades silently to no entry (no throw)", async () => {
    (tauri.invokeCiStatusForCommits as any).mockRejectedValue("failed to run gh");
    useCiStatusStore.getState().request("/r", ["a"]);
    await vi.advanceTimersByTimeAsync(350);
    expect(useCiStatusStore.getState().byOid["a"]).toBeUndefined();
  });
});

describe("ciChecksStore", () => {
  beforeEach(() => { vi.clearAllMocks(); useCiChecksStore.setState({ checks: null, error: null, loading: false } as any); });
  it("loads checks and classifies errors", async () => {
    (tauri.invokeCiCommitChecks as any).mockResolvedValueOnce({ oid: "a", runs: [], other: [] });
    await useCiChecksStore.getState().load("/r", "a");
    expect(useCiChecksStore.getState().checks?.oid).toBe("a");
    (tauri.invokeCiCommitChecks as any).mockRejectedValueOnce("HTTP 403: API rate limit exceeded");
    await useCiChecksStore.getState().load("/r", "b");
    expect(useCiChecksStore.getState().error?.kind).toBe("rate-limited");
  });
  it("rerun refreshes the open commit afterwards", async () => {
    (tauri.invokeCiCommitChecks as any).mockResolvedValue({ oid: "a", runs: [], other: [] });
    await useCiChecksStore.getState().load("/r", "a");
    await useCiChecksStore.getState().rerun(7, true);
    expect(tauri.invokeCiRerun).toHaveBeenCalledWith("/r", 7, true);
    expect(tauri.invokeCiCommitChecks).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL (stores missing).

- [ ] **Step 3: Implement**

`src/store/ciPrefsStore.ts`:

```ts
import { create } from "zustand";

export interface CiPrefs {
  names: Record<number, string>;
  favorites: number[];
  favoritesOnly: boolean;
  badgeFollowsFavorites: boolean;
}

const STORAGE_KEY = "ciPrefs";
const DEFAULTS: CiPrefs = { names: {}, favorites: [], favoritesOnly: false, badgeFollowsFavorites: true };

function load(): Record<string, CiPrefs> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, CiPrefs>) : {};
  } catch {
    return {};
  }
}

interface State {
  prefs: Record<string, CiPrefs>;
  getPrefs: (repoPath: string) => CiPrefs;
  setName: (repoPath: string, workflowId: number, name: string) => void;
  toggleFavorite: (repoPath: string, workflowId: number) => void;
  setFavoritesOnly: (repoPath: string, on: boolean) => void;
  setBadgeFollowsFavorites: (repoPath: string, on: boolean) => void;
}

export const useCiPrefsStore = create<State>((set, get) => {
  const update = (repoPath: string, patch: (p: CiPrefs) => CiPrefs) => {
    const next = { ...get().prefs, [repoPath]: patch(get().getPrefs(repoPath)) };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable: applies for this session only
    }
    set({ prefs: next });
  };
  return {
    prefs: load(),
    getPrefs: (repoPath) => ({ ...DEFAULTS, ...get().prefs[repoPath] }),
    setName: (repoPath, workflowId, name) =>
      update(repoPath, (p) => {
        const names = { ...p.names };
        if (name.trim()) names[workflowId] = name.trim();
        else delete names[workflowId];
        return { ...p, names };
      }),
    toggleFavorite: (repoPath, workflowId) =>
      update(repoPath, (p) => ({
        ...p,
        favorites: p.favorites.includes(workflowId) ? p.favorites.filter((f) => f !== workflowId) : [...p.favorites, workflowId],
      })),
    setFavoritesOnly: (repoPath, favoritesOnly) => update(repoPath, (p) => ({ ...p, favoritesOnly })),
    setBadgeFollowsFavorites: (repoPath, badgeFollowsFavorites) => update(repoPath, (p) => ({ ...p, badgeFollowsFavorites })),
  };
});
```

`src/store/ciStatusStore.ts`:

```ts
import { create } from "zustand";
import { invokeCiStatusForCommits, type CommitCi } from "../lib/tauri";
import { toast } from "./toastStore";
import { classifyCiError } from "../lib/ciErrors";

export const CI_POLL_MS = 30_000;
const DEBOUNCE_MS = 300;

interface State {
  byOid: Record<string, CommitCi>;
  request: (repoPath: string, oids: string[]) => void;
  refresh: (repoPath: string, oids: string[]) => Promise<void>;
}

let wanted = new Set<string>();
let debounce: ReturnType<typeof setTimeout> | undefined;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let inFlight = new Set<string>();
let failureStreak = 0;
let activeRepo = "";

export function resetCiStatus() {
  clearTimeout(debounce);
  clearTimeout(pollTimer);
  wanted = new Set();
  inFlight = new Set();
  failureStreak = 0;
  activeRepo = "";
  useCiStatusStore.setState({ byOid: {} });
}

export const useCiStatusStore = create<State>((set, get) => {
  const fetchOids = async (repoPath: string, oids: string[]) => {
    const todo = oids.filter((o) => !inFlight.has(o));
    if (todo.length === 0) return;
    todo.forEach((o) => inFlight.add(o));
    try {
      const results = await invokeCiStatusForCommits(repoPath, todo);
      failureStreak = 0;
      const next = { ...get().byOid };
      for (const r of results) next[r.oid] = r;
      set({ byOid: next });
    } catch (e) {
      // Badges degrade to "none"; one toast per failure streak.
      failureStreak += 1;
      if (failureStreak === 1 && classifyCiError(String(e)).kind !== "no-gh") toast.error(`CI status unavailable: ${e}`);
    } finally {
      todo.forEach((o) => inFlight.delete(o));
      schedulePoll(repoPath);
    }
  };

  const schedulePoll = (repoPath: string) => {
    clearTimeout(pollTimer);
    const pending = Object.values(get().byOid).filter((c) => c.state === "pending").map((c) => c.oid);
    if (pending.length === 0) return;
    pollTimer = setTimeout(() => {
      if (document.visibilityState === "hidden") return schedulePoll(repoPath);
      const still = Object.values(get().byOid).filter((c) => c.state === "pending").map((c) => c.oid);
      void fetchOids(repoPath, still);
    }, CI_POLL_MS);
  };

  return {
    byOid: {},
    request: (repoPath, oids) => {
      if (repoPath !== activeRepo) {
        activeRepo = repoPath;
        set({ byOid: {} });
        wanted = new Set();
      }
      const known = get().byOid;
      oids.forEach((o) => { if (!known[o]) wanted.add(o); });
      if (wanted.size === 0) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        const batch = [...wanted];
        wanted = new Set();
        void fetchOids(repoPath, batch);
      }, DEBOUNCE_MS);
    },
    refresh: (repoPath, oids) => fetchOids(repoPath, oids),
  };
});
```

`src/store/ciChecksStore.ts`:

```ts
import { create } from "zustand";
import { invokeCiCommitChecks, invokeCiRerun, invokeCiCancel, type CommitChecks } from "../lib/tauri";
import { classifyCiError, type CiErrorKind } from "../lib/ciErrors";
import { toast } from "./toastStore";
import { useCiStatusStore } from "./ciStatusStore";

export const CI_CHECKS_POLL_MS = 15_000;

interface State {
  repoPath: string | null;
  oid: string | null;
  checks: CommitChecks | null;
  loading: boolean;
  error: { kind: CiErrorKind; message: string } | null;
  load: (repoPath: string, oid: string) => Promise<void>;
  refresh: () => Promise<void>;
  rerun: (runId: number, failedOnly: boolean) => Promise<void>;
  cancel: (runId: number) => Promise<void>;
}

export const useCiChecksStore = create<State>((set, get) => ({
  repoPath: null,
  oid: null,
  checks: null,
  loading: false,
  error: null,
  load: async (repoPath, oid) => {
    set({ repoPath, oid, loading: true, error: null, checks: get().oid === oid ? get().checks : null });
    try {
      const checks = await invokeCiCommitChecks(repoPath, oid);
      if (get().oid !== oid) return;
      set({ checks, loading: false });
    } catch (e) {
      if (get().oid !== oid) return;
      const message = String(e);
      set({ loading: false, error: { kind: classifyCiError(message).kind, message } });
    }
  },
  refresh: async () => {
    const { repoPath, oid } = get();
    if (repoPath && oid) {
      await get().load(repoPath, oid);
      void useCiStatusStore.getState().refresh(repoPath, [oid]);
    }
  },
  rerun: async (runId, failedOnly) => {
    const { repoPath } = get();
    if (!repoPath) return;
    try {
      await invokeCiRerun(repoPath, runId, failedOnly);
      toast.success(failedOnly ? "Re-running failed jobs" : "Re-running workflow");
      await get().refresh();
    } catch (e) {
      toast.error(`Re-run failed: ${e}`);
    }
  },
  cancel: async (runId) => {
    const { repoPath } = get();
    if (!repoPath) return;
    try {
      await invokeCiCancel(repoPath, runId);
      toast.success("Cancelling workflow");
      await get().refresh();
    } catch (e) {
      toast.error(`Cancel failed: ${e}`);
    }
  },
}));
```

- [ ] **Step 4: Run tests** — `npx vitest run src/__tests__/ciStores.test.ts` → PASS.

- [ ] **Step 5: Checkpoint** — `npx tsc --noEmit` clean; `npx vitest run` green.

---

### Task 5: Badges — `CiBadge` + integration (commits, branches, PRs)

**Files:**
- Create: `src/components/CiBadge.tsx`
- Modify: `src/components/CommitGraphRow.tsx`, `src/components/CommitGraph.tsx`, `src/components/BranchTree.tsx`, `src/components/PullRequestsScreen.tsx`, `src/store/uiStore.ts` (add `drawerTab`)
- Test: `src/__tests__/CiBadge.test.tsx`

**Interfaces:**
- Consumes: Task 3 `badgeState`; Task 4 stores.
- Produces: `CiBadge({ state: CiState; title?: string; onClick?: () => void })` (renders `null` for `"none"`); `useCiBadge(oid: string | undefined): { state: CiState; title: string }` hook exported from `CiBadge.tsx` (reads status store + prefs for the active repo, applies `badgeState`); `useUiStore` gains `drawerTab: "diff" | "checks"` and `setDrawerTab(tab)`; selecting a commit does not reset the tab.

- [ ] **Step 1: Failing test** `src/__tests__/CiBadge.test.tsx`

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CiBadge from "../components/CiBadge";

describe("CiBadge", () => {
  it("renders nothing when there is no CI", () => {
    const { container } = render(<CiBadge state="none" />);
    expect(container).toBeEmptyDOMElement();
  });
  it.each([["success", "CI passed"], ["failure", "CI failed"], ["pending", "CI running"]])("labels %s", (state, label) => {
    render(<CiBadge state={state as any} />);
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  });
  it("calls onClick without bubbling to the row", () => {
    const onClick = vi.fn(); const rowClick = vi.fn();
    render(<div onClick={rowClick}><CiBadge state="failure" onClick={onClick} /></div>);
    fireEvent.click(screen.getByLabelText("CI failed"));
    expect(onClick).toHaveBeenCalled();
    expect(rowClick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement `CiBadge.tsx`**

```tsx
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import type { CiState } from "../lib/tauri";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useCiStatusStore } from "../store/ciStatusStore";
import { useCiPrefsStore } from "../store/ciPrefsStore";
import { badgeState } from "../lib/ci";

const LABELS: Record<Exclude<CiState, "none">, string> = { success: "CI passed", failure: "CI failed", pending: "CI running" };

export function useCiBadge(oid: string | undefined): { state: CiState; title: string } {
  const repoPath = useWorkspaceStore((s) => s.repos.find((r) => r.id === s.activeRepoId)?.path);
  const ci = useCiStatusStore((s) => (oid ? s.byOid[oid] : undefined));
  const prefs = useCiPrefsStore((s) => (repoPath ? s.getPrefs(repoPath) : undefined));
  if (!ci) return { state: "none", title: "" };
  const follow = !!prefs?.favoritesOnly && prefs.badgeFollowsFavorites;
  const state = badgeState(ci, { favorites: prefs?.favorites ?? [], followFavorites: follow });
  const counts = ci.failed > 0 ? `${ci.failed} of ${ci.total} failed` : ci.pending > 0 ? `${ci.pending} of ${ci.total} running` : `${ci.total} checks passed`;
  return { state, title: follow ? `${counts} (favorites only)` : counts };
}

export default function CiBadge({ state, title, onClick }: { state: CiState; title?: string; onClick?: () => void }) {
  if (state === "none") return null;
  const Icon = state === "success" ? CheckCircle2 : state === "failure" ? XCircle : Loader2;
  const color = state === "success" ? "text-success" : state === "failure" ? "text-danger" : "text-merged";
  return (
    <button
      type="button"
      aria-label={LABELS[state]}
      title={title || LABELS[state]}
      className={`shrink-0 press-scale ${color}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      <Icon size={12} className={state === "pending" ? "animate-spin" : ""} />
    </button>
  );
}
```

- [ ] **Step 4: Integrate**
  - `uiStore.ts` (Edit tool): add `drawerTab: "diff" | "checks"` (default `"diff"`) and `setDrawerTab`.
  - `CommitGraphRow.tsx`: in both row variants, render `<CommitBadgeSlot oid={commit.oid} />` immediately after `<RefBadges refs={refs} />`, where `CommitBadgeSlot` is a small component defined in the same file: `const { state, title } = useCiBadge(oid); return <CiBadge state={state} title={title} onClick={() => { useUiStore.getState().selectCommit(oid); useUiStore.getState().setDrawerTab("checks"); }} />;`.
  - `CommitGraph.tsx`: add an effect that, when `start`/`end`/`visible` change, calls `useCiStatusStore.getState().request(repoPath, visible.slice(start, end).map((c) => c.oid))` (repoPath from the active repo; skip when GitHub status unavailable: `useGithubStore((s) => s.status?.available)`).
  - `BranchTree.tsx`: in `BranchRow` render `<CiBadge>` from `useCiBadge(branch.targetOid)` after the name span (with the same click behavior as above); in `BranchTree` request statuses for the tips of the currently windowed local branches (reuse the `VirtualRows` window: call the request inside `VirtualRows` via an optional `onWindow?: (items: T[]) => void` prop invoked in an effect on `[start, end, items]`).
  - `PullRequestsScreen.tsx`: keep `checkStatusBadge` untouched (PR rollup is already correct and tests assert its text); no change needed beyond confirming it still renders. (Deliberate deviation from the spec's "switch PR list to CiBadge": the PR list badge carries a label the existing tests rely on; revisit if visual consistency matters.)

- [ ] **Step 5: Tests for integration** — append to `src/__tests__/CommitGraph.test.tsx` (mock `../store/ciStatusStore`'s `request` via `vi.spyOn(useCiStatusStore.getState(), "request")`): assert it is called with the visible oids once GitHub status is available, and not called when `status.available` is false. Append to `BranchTree.test.tsx`: a branch whose tip has `byOid[tip].state = "failure"` renders an element with label "CI failed".

- [ ] **Step 6: Run** — `npx vitest run` → PASS (fix any existing test that now needs `useGithubStore` state).

- [ ] **Step 7: Checkpoint** — `npx tsc --noEmit` clean.

---

### Task 6: Checks panel + drawer tabs + actions

**Files:**
- Create: `src/components/ChecksPanel.tsx`, `src/components/WorkflowCard.tsx`
- Modify: `src/components/CommitDrawer.tsx`, `src/components/PullRequestDetail.tsx`
- Test: `src/__tests__/ChecksPanel.test.tsx`

**Interfaces:**
- Consumes: Tasks 3 and 4; `EmptyState`; `describeGithubUnavailable`; `toast`.
- Produces: `ChecksPanel({ oid: string; onOpenJob: (job: CiJob, run: CiWorkflowRun) => void })` (loads checks for `oid` via `useCiChecksStore`, polls every `CI_CHECKS_POLL_MS` while any run is in progress); `WorkflowCard({ repoPath, run, onOpenJob })`.

- [ ] **Step 1: Failing tests** `src/__tests__/ChecksPanel.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChecksPanel from "../components/ChecksPanel";
import { useCiChecksStore } from "../store/ciChecksStore";
import { useCiPrefsStore } from "../store/ciPrefsStore";
import { useWorkspaceStore } from "../store/workspaceStore";

vi.mock("../lib/tauri", () => ({
  invokeCiCommitChecks: vi.fn().mockResolvedValue({ oid: "a", runs: [], other: [] }),
  invokeCiRerun: vi.fn(), invokeCiCancel: vi.fn(), invokeCiStatusForCommits: vi.fn().mockResolvedValue([]),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const run = (id: number, wf: number, name: string, status: string, conclusion: string | null) => ({
  runId: id, workflowId: wf, workflowName: name, status, conclusion, url: "https://x", startedAt: null, updatedAt: null,
  jobs: [{ jobId: id * 10, name: "job", status, conclusion, startedAt: null, completedAt: null, url: "", steps: [] }],
});

function seed(runs: any[], other: any[] = []) {
  useCiChecksStore.setState({ repoPath: "/r", oid: "a", checks: { oid: "a", runs, other }, loading: false, error: null, load: vi.fn(), refresh: vi.fn() } as any);
}

describe("ChecksPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    useCiPrefsStore.setState({ prefs: {} } as any);
    useWorkspaceStore.setState({ repos: [{ id: 1, path: "/r", name: "r", pinned: false }], activeRepoId: 1 } as any);
  });

  it("shows failures first and a no-CI state when empty", () => {
    seed([run(1, 1, "Lint", "completed", "success"), run(2, 2, "Build", "completed", "failure")]);
    const { unmount } = render(<ChecksPanel oid="a" onOpenJob={vi.fn()} />);
    const titles = screen.getAllByTestId("workflow-title").map((n) => n.textContent);
    expect(titles).toEqual(["Build", "Lint"]);
    unmount();
    seed([]);
    render(<ChecksPanel oid="a" onOpenJob={vi.fn()} />);
    expect(screen.getByText("No CI on this commit")).toBeInTheDocument();
  });

  it("renames a workflow, showing the original muted, and falls back when blanked", () => {
    seed([run(1, 1, "CI", "completed", "success")]);
    render(<ChecksPanel oid="a" onOpenJob={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Rename workflow"));
    fireEvent.change(screen.getByLabelText("Workflow name"), { target: { value: "Main pipeline" } });
    fireEvent.keyDown(screen.getByLabelText("Workflow name"), { key: "Enter" });
    expect(screen.getByTestId("workflow-title")).toHaveTextContent("Main pipeline");
    expect(screen.getByText("CI")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Rename workflow"));
    fireEvent.change(screen.getByLabelText("Workflow name"), { target: { value: "  " } });
    fireEvent.keyDown(screen.getByLabelText("Workflow name"), { key: "Enter" });
    expect(screen.getByTestId("workflow-title")).toHaveTextContent("CI");
  });

  it("favorites-only hides others behind a count, and hints when nothing is starred", () => {
    seed([run(1, 1, "CI", "completed", "success"), run(2, 2, "Deploy", "completed", "success")]);
    render(<ChecksPanel oid="a" onOpenJob={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Favorites only"));
    expect(screen.getByText("Star a workflow to see it here")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Favorites only")); // off
    fireEvent.click(screen.getAllByLabelText("Favorite workflow")[0]);
    fireEvent.click(screen.getByLabelText("Favorites only"));
    expect(screen.getAllByTestId("workflow-title")).toHaveLength(1);
    expect(screen.getByText("1 hidden")).toBeInTheDocument();
  });

  it("offers re-run for finished runs and cancel (with confirm) for running ones", () => {
    const rerun = vi.fn(); const cancel = vi.fn();
    seed([run(1, 1, "CI", "completed", "failure"), run(2, 2, "Deploy", "in_progress", null)]);
    useCiChecksStore.setState({ rerun, cancel } as any);
    render(<ChecksPanel oid="a" onOpenJob={vi.fn()} />);
    fireEvent.click(screen.getByText("Re-run failed jobs"));
    expect(rerun).toHaveBeenCalledWith(1, true);
    fireEvent.click(screen.getByText("Cancel"));
    expect(cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Confirm cancel"));
    expect(cancel).toHaveBeenCalledWith(2);
  });

  it("shows the gh-unavailable empty state on a no-gh error", () => {
    useCiChecksStore.setState({ repoPath: "/r", oid: "a", checks: null, loading: false, error: { kind: "no-gh", message: "failed to run gh" }, load: vi.fn(), refresh: vi.fn() } as any);
    render(<ChecksPanel oid="a" onOpenJob={vi.fn()} />);
    expect(screen.getByText("GitHub CLI not found")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement**

`WorkflowCard.tsx` — one card: header row with status icon (from `runState`), `<span data-testid="workflow-title">{title}</span>` + muted `original` line, duration (`formatDuration(run.startedAt, run.updatedAt)`), GitHub link button (`openUrl(run.url)`), star button (`aria-label="Favorite workflow"`, filled when favorited, toggles `useCiPrefsStore.toggleFavorite(repoPath, run.workflowId)`), pencil button (`aria-label="Rename workflow"`) that swaps the title for an `<input aria-label="Workflow name" autoFocus>` (Enter or blur commits through `setName`, Esc cancels). Body (expandable, collapsed for successful runs, expanded for failures): job rows (name, conclusion icon, duration bar width proportional to the longest job) — clicking a job calls `onOpenJob(job, run)`. Footer buttons: finished run → "Re-run failed jobs" (only if `runState(run) === "failure"`, calls `rerun(run.runId, true)`) and "Re-run all" (`rerun(run.runId, false)`); running run → "Cancel" which turns into "Confirm cancel" on first click (calls `cancel(run.runId)` on the second; resets after 4 s).

`ChecksPanel.tsx`:
1. On mount/`oid` change, call `load(repoPath, oid)` (repoPath from the active repo); set an interval of `CI_CHECKS_POLL_MS` that calls `refresh()` only while some run has `status !== "completed"` and `document.visibilityState !== "hidden"`; clear on unmount.
2. Error → `EmptyState` variant="error": for `no-gh`/`unauthenticated` use `describeGithubUnavailable(message)`; `rate-limited` → "GitHub rate limit reached" with hint "Try again in a few minutes" and a Retry action; `forbidden` → "Not allowed"; `other` → "Couldn't load checks" with `details={message}` and a Retry action.
3. Loading with no data → `SkeletonBlock lines={4}` (existing component).
4. Toolbar row: "Favorites only" toggle button (`aria-label="Favorites only"`, reflects `prefs.favoritesOnly`), Refresh button.
5. No runs and no other checks → `EmptyState title="No CI on this commit"`.
6. Runs: `sortRuns(runs)`; when `favoritesOnly`: if `favorites.length === 0` render `EmptyState` with `title="Star a workflow to see it here"` (still list a "Show all" action that turns favorites-only off); else render only favorites and a muted `"{n} hidden"` line when `n > 0`.
7. "Other checks" group below (name, state icon, source, link) — hidden when favorites-only is on.

`CommitDrawer.tsx` (Edit tool): add a two-tab control ("Changes" / "Checks", `useUiStore` `drawerTab`/`setDrawerTab`) in both the drawer and the modal, above the body; body renders `<DiffViewer files={detail.files} />` when `drawerTab === "diff"` else `<ChecksPanel oid={detail.oid} onOpenJob={openJob} />`. Tabs show only when GitHub is available (`githubStatus?.available`); otherwise diff only. `openJob` sets local state `{ job, run }` that mounts `LogViewer` (Task 7). Show a `CiBadge` (via `useCiBadge(detail.oid)`) next to the "Checks" tab label.

`PullRequestDetail.tsx`: add a "Checks" section/tab that renders `<ChecksPanel oid={headOid} .../>` where `headOid` is the PR's head commit (last entry of `prDetail.commits`); if absent, omit.

- [ ] **Step 4: Run tests** — `npx vitest run src/__tests__/ChecksPanel.test.tsx` then full `npx vitest run` → PASS.

- [ ] **Step 5: Checkpoint** — `npx tsc --noEmit` clean.

---

### Task 7: Log viewer

**Files:**
- Create: `src/components/LogViewer.tsx`
- Test: `src/__tests__/LogViewer.test.tsx`

**Interfaces:**
- Consumes: `invokeCiJobLog`, `parseLogSteps`, `firstFailedStep`, `parseAnsi`, `useVirtualList`, `copyText`, `toast`.
- Produces: `LogViewer({ repoPath, job, run, onClose })`.

- [ ] **Step 1: Failing tests** `src/__tests__/LogViewer.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LogViewer from "../components/LogViewer";
import * as tauri from "../lib/tauri";

vi.mock("../lib/tauri", () => ({ invokeCiJobLog: vi.fn() }));
vi.mock("../lib/clipboard", () => ({ copyText: vi.fn().mockResolvedValue(true) }));

const job = (steps: any[]) => ({ jobId: 5, name: "test", status: "completed", conclusion: "failure", startedAt: null, completedAt: null, url: "", steps });
const run = { runId: 1, workflowId: 1, workflowName: "CI", status: "completed", conclusion: "failure", url: "", startedAt: null, updatedAt: null, jobs: [] } as any;
const LOG = "test\tSet up job\t2026-09-30T10:00:00Z ok\ntest\tRun tests\t2026-09-30T10:00:01Z \u001b[31mFAIL\u001b[0m here\n";

describe("LogViewer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the log, opens the failed step and renders ANSI text", async () => {
    (tauri.invokeCiJobLog as any).mockResolvedValue({ text: LOG, truncated: false });
    render(<LogViewer repoPath="/r" job={job([{ number: 1, name: "Set up job", status: "completed", conclusion: "success" }, { number: 2, name: "Run tests", status: "completed", conclusion: "failure" }])} run={run} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("FAIL")).toBeInTheDocument());
    expect(screen.getByText("Run tests").closest("[data-open]")).toHaveAttribute("data-open", "true");
    expect(screen.getByText("Set up job").closest("[data-open]")).toHaveAttribute("data-open", "false");
  });

  it("opens at the top when no failed step is recorded", async () => {
    (tauri.invokeCiJobLog as any).mockResolvedValue({ text: LOG, truncated: false });
    render(<LogViewer repoPath="/r" job={job([])} run={run} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Set up job")).toBeInTheDocument());
    expect(screen.getByText("Set up job").closest("[data-open]")).toHaveAttribute("data-open", "true");
  });

  it("searches and highlights matches with a count", async () => {
    (tauri.invokeCiJobLog as any).mockResolvedValue({ text: LOG, truncated: false });
    render(<LogViewer repoPath="/r" job={job([])} run={run} onClose={vi.fn()} />);
    await waitFor(() => screen.getByText("Set up job"));
    fireEvent.change(screen.getByPlaceholderText("Search log"), { target: { value: "here" } });
    expect(screen.getByText("1 match")).toBeInTheDocument();
    expect(document.querySelector("mark")).toHaveTextContent("here");
  });

  it("offers to load the full log when truncated", async () => {
    (tauri.invokeCiJobLog as any).mockResolvedValueOnce({ text: LOG, truncated: true }).mockResolvedValueOnce({ text: LOG, truncated: false });
    render(<LogViewer repoPath="/r" job={job([])} run={run} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText("Load full log"));
    await waitFor(() => expect(tauri.invokeCiJobLog).toHaveBeenLastCalledWith("/r", 5, true));
  });

  it("shows an error state with retry when loading fails, and Esc closes", async () => {
    (tauri.invokeCiJobLog as any).mockRejectedValue("boom");
    const onClose = vi.fn();
    render(<LogViewer repoPath="/r" job={job([])} run={run} onClose={onClose} />);
    expect(await screen.findByText("Couldn't load log")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement `LogViewer.tsx`**

Behavior (write the component to satisfy the tests above):
- Portal modal (`fixed inset-0 z-[70]`, same look as the other modals), `role="dialog"`, Esc closes (capture-phase `keydown` on window so the commit modal behind it doesn't also close).
- On mount call `invokeCiJobLog(repoPath, job.jobId, false)`; keep `{ text, truncated }`, `loading`, `error`. `error` → `EmptyState variant="error" title="Couldn't load log" details={message}` with a Retry action. `truncated` → a banner with a "Load full log" button that re-invokes with `full = true`.
- `steps = parseLogSteps(text)`; map each step to `job.steps` by **name** to know its conclusion; `failed = firstFailedStep(job)` → the step name to open; if `failed === null`, open only the first step (top of log). Each step is a section `<div data-open="true|false">` with a header button (name, conclusion icon, line count) that toggles open state (initial open set computed once when the log loads).
- Lines: a flat windowed list over the open steps' lines using `useVirtualList` with `itemHeight = 18` (line numbers computed over the flattened visible lines); each line renders `parseAnsi(line)` segments inside a `whitespace-pre font-mono text-xs` row; when a search term is active, split segments around case-insensitive matches (escape regex chars) and wrap matches in `<mark className="bg-accent-soft text-accent">`.
- Toolbar: search input (`placeholder="Search log"`), match count text (`"{n} match"`/`"{n} matches"`, `"No matches"`), prev/next buttons (scroll to the match line via `scrollToIndex(index, "center")`; Enter = next, Shift+Enter = prev), Copy (copies the raw text via `copyText`, `toast.success("Copied log")`), Refresh (re-invoke; shown for non-completed jobs), Close.
- Header: `{run.workflowName} › {job.name}` and a link button to open `job.url` via `openUrl`.

- [ ] **Step 4: Run tests** — `npx vitest run src/__tests__/LogViewer.test.tsx` → PASS; then full `npx vitest run`.

- [ ] **Step 5: Wire into `CommitDrawer`** — `openJob` mounts `<LogViewer repoPath={activeRepo.path} job={job} run={run} onClose={() => setOpenJob(null)} />` (local state in `CommitDrawer`, rendered once outside both the drawer and modal branches so it shows above either).

- [ ] **Step 6: Checkpoint** — `npx tsc --noEmit` clean.

---

### Task 8: Shortcuts, polish, settings flag, final verification

**Files:**
- Modify: `src/components/CommitDrawer.tsx`, `src/components/ChecksPanel.tsx`, `src/components/SettingsModal.tsx`, `src/hooks/useKeyboardShortcuts.ts` (only if the dialog needs a new group label)
- Test: `src/__tests__/ciShortcuts.test.tsx`

**Interfaces:**
- Consumes: `useShortcut`, `useUiStore.drawerTab`, `useCiPrefsStore`.

- [ ] **Step 1: Failing test** `src/__tests__/ciShortcuts.test.tsx`

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useUiStore } from "../store/uiStore";
import { useRegisteredShortcuts } from "../hooks/useKeyboardShortcuts";
import { useCiShortcuts } from "../components/ChecksPanel";

function Harness({ onFavoritesToggle }: { onFavoritesToggle: () => void }) {
  useCiShortcuts({ enabled: true, onToggleFavoritesOnly: onFavoritesToggle });
  const shortcuts = useRegisteredShortcuts();
  return <ul>{shortcuts.map((s) => <li key={s.id}>{s.id}</li>)}</ul>;
}

describe("CI shortcuts", () => {
  it("'c' opens the Checks tab and 'f' toggles favorites-only, both registered for the help dialog", () => {
    useUiStore.setState({ drawerTab: "diff" } as any);
    const toggle = vi.fn();
    const { getByText } = render(<Harness onFavoritesToggle={toggle} />);
    expect(getByText("ci.open-checks")).toBeInTheDocument();
    expect(getByText("ci.favorites-only")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "c" });
    expect(useUiStore.getState().drawerTab).toBe("checks");
    fireEvent.keyDown(window, { key: "f" });
    expect(toggle).toHaveBeenCalled();
  });
  it("ignores keys typed in inputs", () => {
    useUiStore.setState({ drawerTab: "diff" } as any);
    const { container } = render(<><input data-testid="i" /><Harness onFavoritesToggle={vi.fn()} /></>);
    (container.querySelector("input") as HTMLInputElement).focus();
    fireEvent.keyDown(window, { key: "c" });
    expect(useUiStore.getState().drawerTab).toBe("diff");
  });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement**

Export from `ChecksPanel.tsx`:

```tsx
export function useCiShortcuts({ enabled, onToggleFavoritesOnly }: { enabled: boolean; onToggleFavoritesOnly: () => void }) {
  const setDrawerTab = useUiStore((s) => s.setDrawerTab);
  useShortcut({ id: "ci.open-checks", keys: ["c"], display: "c", description: "Open checks for the selected commit", group: "CI" }, () => setDrawerTab("checks"), enabled);
  useShortcut({ id: "ci.favorites-only", keys: ["f"], display: "f", description: "Toggle favorite workflows only", group: "CI" }, onToggleFavoritesOnly, enabled);
}
```

Call `useCiShortcuts` in `CommitDrawer` with `enabled = !!selectedCommitOid && githubStatus?.available` and `onToggleFavoritesOnly` that flips `favoritesOnly` for the active repo via `useCiPrefsStore` (only when `drawerTab === "checks"`).

`SettingsModal.tsx` (Edit tool): add a "CI" section with a checkbox `aria-label="Badges follow favorite workflows"` bound to `badgeFollowsFavorites` for the active repo (default on), so the assumed default is reversible from the UI.

- [ ] **Step 4: Run tests** — `npx vitest run src/__tests__/ciShortcuts.test.tsx`, then the full suite `npx vitest run`, `npx tsc --noEmit`, `cd src-tauri && cargo test`. Expected: all green.

- [ ] **Step 5: Manual verification (needs the real app; cannot be automated here)** — rebuild Tauri and, against a real GitHub repo with Actions:
  1. Badges appear on visible commits within a couple of seconds, and a running workflow's spinner turns to a check/cross on its own (≤30 s).
  2. Checks tab lists workflows failures-first; star, rename, favorites-only behave; badge follows favorites and the Settings checkbox turns that off.
  3. A failed job opens the log at the failing step; search works; a >2 MB log shows "Load full log".
  4. Re-run failed jobs and Cancel work (needs a token with `actions:write`); a token without it shows the error toast.
  5. Scroll a very long history quickly: no request storm (watch the devtools network/`gh` process count) and no UI jank.
  6. **Verify the GraphQL risk from the spec:** confirm `checkSuite.workflowRun.workflow.databaseId` is populated for Actions checks on a real commit; if not, favorites-only badges must fall back to whole-commit state (the `badgeState` fallback already covers empty `byWorkflow`).

- [ ] **Step 6: Checkpoint** — report results, including anything only verifiable manually.

---

## Self-Review

**Spec coverage:** badges on commit rows/branches (Task 5) and PR list (kept as-is, deviation noted in Task 5); checks panel with workflow cards, jobs/steps, other checks, sorting, favorites-only, rename, star (Task 6); log viewer with failed-step open, search, ANSI, cap + full-log, copy, refresh (Task 7); re-run failed/all and cancel with confirm + toasts + re-poll (Tasks 4, 6); prefs per repo persisted, `badgeFollowsFavorites` default on + Settings toggle (Tasks 4, 8); shortcuts `c`/`f` (Task 8); empty/error states incl. no-CI, no-gh, rate-limited, retry (Tasks 3, 6, 7); polling of pending only with backoff-free silent degradation and one toast per streak (Task 4); batching ≤100 and oid validation (Task 1); PR detail reuse (Task 6). The spec's `JobLog.failedStepNumber` is computed client-side from the job's steps (`firstFailedStep`) instead of the backend, since the jobs response already carries step conclusions — a deliberate simplification.

**Placeholder scan:** Task 6's `WorkflowCard`/`ChecksPanel` and Task 7's `LogViewer` are specified by exact behavior, props, aria-labels and test assertions rather than full JSX; the tests in those tasks define the contract precisely. Task 5's BranchTree/CommitGraph wiring is described as anchored edits. No TBD/TODO.

**Type consistency:** `CiState`, `CommitCi`, `WorkflowCi`, `CiWorkflowRun`, `CiJob`, `CiStep`, `CiOtherCheck`, `CommitChecks`, `JobLog` defined in Task 2 and used unchanged in Tasks 3–8; store method names (`request`, `refresh`, `load`, `rerun`, `cancel`, `getPrefs`, `setName`, `toggleFavorite`, `setFavoritesOnly`, `setBadgeFollowsFavorites`) match across tasks and tests; `useUiStore.drawerTab`/`setDrawerTab` introduced in Task 5 and used in Tasks 6 and 8.

**Review Focus:** each line has an owning test — zero-CI (Task 1 `commit_without_checks…`, Task 5 `CiBadge` none, Task 6 no-CI state); blank custom name (Task 3 `workflowTitle`, Task 6 rename test); no failed step (Task 3 `firstFailedStep`, Task 7 opens-at-top test); gh failure modes (Task 3 `classifyCiError`, Task 4 silent degrade, Task 6 no-gh state); favorites-only with none starred (Task 3 `badgeState` fallback, Task 6 hint test); huge log/malformed ANSI (Task 2 cap tests, Task 3 ANSI malformed test, Task 7 truncated test).

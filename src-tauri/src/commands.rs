use crate::branch;
use crate::db::{self, RepoEntry};
use crate::diff::{self, CommitDetail, FileDiff};
use crate::error::AppError;
use crate::github::{self, GithubStatus, PrComment, PrReviewComment, PullRequest, PullRequestDetail, SystemGhRunner};
use crate::graph::{self, GraphCommit};
use crate::pr_diff::{self, PrDiff};
use crate::compare::{self, CompareResult};
use crate::remote;
use crate::repo::{self, BranchInfo, BranchListResult, TagInfo};
use crate::search::{self, SearchHit};
use crate::settings;
use crate::workdir::{self, StatusEntry};
use crate::AppState;
use std::path::Path;
use tauri::State;

async fn run_blocking<T, F>(f: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
    T: Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(f).await {
        Ok(inner) => inner,
        Err(e) => Err(AppError::Operation(format!("task join error: {e}"))),
    }
}

#[tauri::command]
pub async fn list_repos(state: State<'_, AppState>) -> Result<Vec<RepoEntry>, AppError> {
    let db = state.db.clone();
    run_blocking(move || {
        let conn = db.lock().unwrap();
        db::list_repos(&conn)
    })
    .await
}

#[tauri::command]
pub async fn add_repo(state: State<'_, AppState>, path: String) -> Result<RepoEntry, AppError> {
    let db = state.db.clone();
    run_blocking(move || {
        let name = Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());
        let conn = db.lock().unwrap();
        db::add_repo(&conn, &path, &name)
    })
    .await
}

#[tauri::command]
pub async fn remove_repo(state: State<'_, AppState>, id: i64) -> Result<(), AppError> {
    let db = state.db.clone();
    run_blocking(move || {
        let conn = db.lock().unwrap();
        let before = db::list_repos(&conn)?;
        db::remove_repo(&conn, id)?;
        if let Some(removed) = before.iter().find(|r| r.id == id) {
            let remaining: Vec<String> =
                before.iter().filter(|r| r.id != id).map(|r| r.path.clone()).collect();
            // Cache cleanup must never fail the removal itself.
            let _ = search::remove_for_repo(&removed.path, &remaining);
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn get_branches(repo_path: String) -> Result<BranchListResult, AppError> {
    run_blocking(move || repo::list_branches(&repo_path)).await
}

#[tauri::command]
pub async fn get_tags(repo_path: String) -> Result<Vec<TagInfo>, AppError> {
    run_blocking(move || repo::list_tags(&repo_path)).await
}

#[tauri::command]
pub async fn get_commit_graph(repo_path: String, limit: usize) -> Result<Vec<GraphCommit>, AppError> {
    run_blocking(move || graph::get_commit_graph(&repo_path, limit)).await
}

#[tauri::command]
pub async fn ensure_search_index(repo_path: String) -> Result<(), AppError> {
    run_blocking(move || search::ensure_index(&repo_path)).await
}

#[tauri::command]
pub async fn list_search_index_usage() -> Result<Vec<search::IndexUsage>, AppError> {
    run_blocking(search::list_usage).await
}

#[tauri::command]
pub async fn clear_search_index(key: Option<String>) -> Result<(), AppError> {
    run_blocking(move || search::clear(key.as_deref())).await
}

#[tauri::command]
pub async fn search_commits(
    repo_path: String,
    query: String,
    author: Option<String>,
    since: Option<i64>,
    until: Option<i64>,
    commit_id: Option<String>,
    file_path: Option<String>,
) -> Result<Vec<SearchHit>, AppError> {
    run_blocking(move || {
        search::search_commits(
            &repo_path,
            &query,
            author.as_deref(),
            since,
            until,
            commit_id.as_deref(),
            file_path.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub async fn get_github_status(repo_path: String) -> Result<GithubStatus, AppError> {
    run_blocking(move || Ok(github::github_status(&SystemGhRunner, &repo_path))).await
}

#[tauri::command]
pub async fn list_pull_requests(repo_path: String, query: String) -> Result<Vec<PullRequest>, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        github::list_pull_requests(&SystemGhRunner, &owner, &repo, &query)
    })
    .await
}

#[tauri::command]
pub async fn get_pull_request(repo_path: String, number: u64) -> Result<PullRequestDetail, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        github::pr_detail(&SystemGhRunner, &owner, &repo, number)
    })
    .await
}

#[tauri::command]
pub async fn list_pr_comments(repo_path: String, number: u64) -> Result<Vec<PrComment>, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        github::list_pr_comments(&SystemGhRunner, &owner, &repo, number)
    })
    .await
}

#[tauri::command]
pub async fn add_pr_comment(repo_path: String, number: u64, body: String) -> Result<PrComment, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        github::add_pr_comment(&SystemGhRunner, &owner, &repo, number, &body)
    })
    .await
}

#[tauri::command]
pub async fn list_pr_review_comments(repo_path: String, number: u64) -> Result<Vec<PrReviewComment>, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        github::list_pr_review_comments(&SystemGhRunner, &owner, &repo, number)
    })
    .await
}

#[tauri::command]
pub async fn add_pr_review_comment(
    repo_path: String,
    number: u64,
    path: String,
    line: u32,
    side: String,
    body: String,
) -> Result<PrReviewComment, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        let commit_id = pr_diff::resolve_pr_head_oid(&repo_path, number)?;
        github::add_pr_review_comment(&SystemGhRunner, &owner, &repo, number, &commit_id, &path, line, &side, &body)
    })
    .await
}

#[tauri::command]
pub async fn get_pr_diff(repo_path: String, number: u64, base_ref_name: String) -> Result<PrDiff, AppError> {
    run_blocking(move || pr_diff::diff_pr(&repo_path, number, &base_ref_name)).await
}

#[tauri::command]
pub async fn fetch_pr_ref(repo_path: String, number: u64) -> Result<(), AppError> {
    run_blocking(move || remote::fetch_pr_ref(&repo_path, "origin", number)).await
}

#[tauri::command]
pub async fn list_github_branches(repo_path: String) -> Result<Vec<String>, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        github::list_branches(&SystemGhRunner, &owner, &repo)
    })
    .await
}

#[tauri::command]
pub async fn list_commit_pull_requests(
    repo_path: String,
    oid: String,
) -> Result<Vec<github::CommitPullRequest>, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        github::list_commit_pull_requests(&SystemGhRunner, &owner, &repo, &oid)
    })
    .await
}

#[tauri::command]
pub async fn list_assignable_users(repo_path: String) -> Result<Vec<String>, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        github::list_assignable_users(&SystemGhRunner, &owner, &repo)
    })
    .await
}

#[tauri::command]
pub async fn get_status(repo_path: String) -> Result<Vec<StatusEntry>, AppError> {
    run_blocking(move || workdir::get_status(&repo_path)).await
}

#[tauri::command]
pub async fn get_working_diff(
    repo_path: String,
    file_path: String,
    staged: bool,
) -> Result<FileDiff, AppError> {
    run_blocking(move || workdir::get_working_diff(&repo_path, &file_path, staged)).await
}

#[tauri::command]
pub async fn stage_file(repo_path: String, file_path: String) -> Result<(), AppError> {
    run_blocking(move || workdir::stage_file(&repo_path, &file_path)).await
}

#[tauri::command]
pub async fn unstage_file(repo_path: String, file_path: String) -> Result<(), AppError> {
    run_blocking(move || workdir::unstage_file(&repo_path, &file_path)).await
}

#[tauri::command]
pub async fn commit_changes(repo_path: String, message: String) -> Result<String, AppError> {
    run_blocking(move || workdir::commit_changes(&repo_path, &message)).await
}

#[tauri::command]
pub async fn get_commit_diff(repo_path: String, oid: String) -> Result<CommitDetail, AppError> {
    run_blocking(move || diff::get_commit_diff(&repo_path, &oid)).await
}

#[tauri::command]
pub async fn fetch_remote(repo_path: String) -> Result<(), AppError> {
    run_blocking(move || remote::fetch(&repo_path, "origin")).await
}

#[tauri::command]
pub async fn pull_remote(repo_path: String) -> Result<(), AppError> {
    run_blocking(move || remote::pull(&repo_path, "origin")).await
}

#[tauri::command]
pub async fn push_remote(repo_path: String) -> Result<(), AppError> {
    run_blocking(move || remote::push(&repo_path, "origin")).await
}

#[tauri::command]
pub async fn switch_branch(
    repo_path: String,
    branch_name: String,
    is_remote: bool,
) -> Result<(), AppError> {
    run_blocking(move || branch::switch_branch(&repo_path, &branch_name, is_remote)).await
}

#[tauri::command]
pub async fn checkout_tag(repo_path: String, tag_name: String) -> Result<(), AppError> {
    run_blocking(move || branch::checkout_tag(&repo_path, &tag_name)).await
}

#[tauri::command]
pub async fn compare_refs(repo_path: String, base_ref: String, compare_ref: String) -> Result<CompareResult, AppError> {
    run_blocking(move || compare::compare_refs(&repo_path, &base_ref, &compare_ref)).await
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<serde_json::Value, AppError> {
    let path = settings::settings_path(&state.data_dir);
    run_blocking(move || settings::read_or_init_settings(&path)).await
}

#[tauri::command]
pub async fn write_settings(state: State<'_, AppState>, value: serde_json::Value) -> Result<(), AppError> {
    let path = settings::settings_path(&state.data_dir);
    run_blocking(move || settings::write_settings_to_disk(&path, &value)).await
}

#[tauri::command]
pub async fn create_branch(
    repo_path: String,
    branch_name: String,
    oid: String,
) -> Result<(), AppError> {
    run_blocking(move || branch::create_branch(&repo_path, &branch_name, &oid)).await
}

#[tauri::command]
pub async fn get_ahead_behind(repo_path: String) -> Result<Option<branch::AheadBehind>, AppError> {
    run_blocking(move || branch::get_ahead_behind(&repo_path)).await
}

#[tauri::command]
pub async fn cherry_pick_commit(repo_path: String, oid: String) -> Result<String, AppError> {
    run_blocking(move || branch::cherry_pick(&repo_path, &oid)).await
}

#[tauri::command]
pub async fn ci_status_for_commits(repo_path: String, oids: Vec<String>) -> Result<Vec<crate::ci::CommitCi>, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        crate::ci::status_for_commits(&SystemGhRunner, &owner, &repo, &oids)
    })
    .await
}

#[tauri::command]
pub async fn ci_commit_checks(repo_path: String, oid: String) -> Result<crate::ci::CommitChecks, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        crate::ci::commit_checks(&SystemGhRunner, &owner, &repo, &oid)
    })
    .await
}

#[tauri::command]
pub async fn ci_job_log(repo_path: String, job_id: u64, full: bool) -> Result<crate::ci::JobLog, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        crate::ci::job_log(&SystemGhRunner, &owner, &repo, job_id, full)
    })
    .await
}

#[tauri::command]
pub async fn ci_rerun(repo_path: String, run_id: u64, failed_only: bool) -> Result<(), AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        crate::ci::rerun(&SystemGhRunner, &owner, &repo, run_id, failed_only)
    })
    .await
}

#[tauri::command]
pub async fn ci_cancel(repo_path: String, run_id: u64) -> Result<(), AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        crate::ci::cancel(&SystemGhRunner, &owner, &repo, run_id)
    })
    .await
}

#[tauri::command]
pub async fn ci_list_runs(repo_path: String, filters: crate::ci::RunFilters) -> Result<crate::ci::RunsPage, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        crate::ci::list_runs(&SystemGhRunner, &owner, &repo, &filters)
    })
    .await
}

#[tauri::command]
pub async fn ci_list_workflows(repo_path: String) -> Result<Vec<crate::ci::WorkflowInfo>, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        crate::ci::list_workflows(&SystemGhRunner, &owner, &repo)
    })
    .await
}

#[tauri::command]
pub async fn ci_run_jobs(repo_path: String, run_id: u64) -> Result<Vec<crate::ci::Job>, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        crate::ci::run_jobs(&SystemGhRunner, &owner, &repo, run_id)
    })
    .await
}

#[tauri::command]
pub async fn release_notes_commits(
    repo_path: String,
    from: String,
    to: String,
) -> Result<Vec<crate::release_notes::ReleaseNoteCommit>, AppError> {
    run_blocking(move || crate::release_notes::release_notes_commits(&repo_path, &from, &to)).await
}

#[tauri::command]
pub async fn stash_changes(repo_path: String, message: String) -> Result<(), AppError> {
    run_blocking(move || branch::stash_changes(&repo_path, &message)).await
}

#[tauri::command]
pub async fn stash_pop(repo_path: String) -> Result<(), AppError> {
    run_blocking(move || branch::stash_pop(&repo_path)).await
}

#[tauri::command]
pub async fn discard_changes(repo_path: String) -> Result<(), AppError> {
    run_blocking(move || branch::discard_changes(&repo_path)).await
}

#[tauri::command]
pub async fn add_worktree(
    repo_path: String,
    branch_name: String,
    is_remote: bool,
    path: String,
) -> Result<(), AppError> {
    run_blocking(move || branch::add_worktree(&repo_path, &branch_name, is_remote, &path)).await
}

#[tauri::command]
pub async fn get_repo_settings(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<db::RepoSettings, AppError> {
    let db = state.db.clone();
    run_blocking(move || {
        let conn = db.lock().unwrap();
        db::get_repo_settings(&conn, &repo_path)
    })
    .await
}

#[tauri::command]
pub async fn set_repo_settings(
    state: State<'_, AppState>,
    repo_path: String,
    settings: db::RepoSettings,
) -> Result<db::RepoSettings, AppError> {
    let db = state.db.clone();
    run_blocking(move || {
        let conn = db.lock().unwrap();
        db::set_repo_settings(&conn, &repo_path, &settings)
    })
    .await
}

#[tauri::command]
pub async fn reset_repo_settings(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<(), AppError> {
    let db = state.db.clone();
    run_blocking(move || {
        let conn = db.lock().unwrap();
        db::reset_repo_settings(&conn, &repo_path)
    })
    .await
}

#[tauri::command]
pub async fn latest_release_tag(
    repo_path: String,
    pattern: String,
) -> Result<Option<crate::release_notes::ReleaseTag>, AppError> {
    run_blocking(move || crate::release_notes::latest_release_tag(&repo_path, &pattern)).await
}

#[tauri::command]
pub async fn add_release_note(
    state: State<'_, AppState>,
    repo_path: String,
    from_label: String,
    to_label: String,
    text: String,
) -> Result<db::ReleaseNoteEntry, AppError> {
    let db = state.db.clone();
    run_blocking(move || {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let conn = db.lock().unwrap();
        db::add_release_note(&conn, &repo_path, &from_label, &to_label, &text, now)
    })
    .await
}

#[tauri::command]
pub async fn list_release_notes(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<Vec<db::ReleaseNoteEntry>, AppError> {
    let db = state.db.clone();
    run_blocking(move || {
        let conn = db.lock().unwrap();
        db::list_release_notes(&conn, &repo_path)
    })
    .await
}

#[tauri::command]
pub async fn delete_release_note(state: State<'_, AppState>, id: i64) -> Result<(), AppError> {
    let db = state.db.clone();
    run_blocking(move || {
        let conn = db.lock().unwrap();
        db::delete_release_note(&conn, id)
    })
    .await
}

#[tauri::command]
pub async fn list_open_targets(repo_path: String) -> Result<Vec<crate::open_in::OpenTarget>, AppError> {
    run_blocking(move || Ok(crate::open_in::list_open_targets(&repo_path))).await
}

#[tauri::command]
pub async fn open_in(target_id: String, repo_path: String) -> Result<(), AppError> {
    run_blocking(move || crate::open_in::open_in(&target_id, &repo_path)).await
}

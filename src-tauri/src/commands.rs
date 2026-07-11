use crate::branch;
use crate::db::{self, RepoEntry};
use crate::diff::{self, CommitDetail, FileDiff};
use crate::error::AppError;
use crate::graph::{self, GraphCommit};
use crate::remote;
use crate::repo::{self, BranchInfo, TagInfo};
use crate::search::{self, SearchHit};
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
        db::remove_repo(&conn, id)
    })
    .await
}

#[tauri::command]
pub async fn get_branches(repo_path: String) -> Result<Vec<BranchInfo>, AppError> {
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
pub async fn search_commits(
    repo_path: String,
    query: String,
    author: Option<String>,
    since: Option<i64>,
    until: Option<i64>,
) -> Result<Vec<SearchHit>, AppError> {
    run_blocking(move || {
        search::search_commits(&repo_path, &query, author.as_deref(), since, until)
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

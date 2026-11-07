mod error;
mod db;
mod repo;
mod graph;
mod branch;
mod release_notes;
mod open_in;
mod search;
mod workdir;
mod diff;
mod remote;
mod conflicts;
mod github;
mod ci;
mod pr_diff;
mod compare;
mod commands;
mod settings;
mod test_support;

use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use tauri::Emitter;

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub data_dir: std::path::PathBuf,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let data_dir = dirs::data_dir().unwrap().join("bettertree");
    std::fs::create_dir_all(&data_dir).ok();
    let conn = Connection::open(data_dir.join("workspace.db")).expect("failed to open workspace db");
    db::init_db(&conn).expect("failed to init db schema");

    // The pre-v2 search index held whole patches and grew to many GB.
    let legacy_dir = data_dir.clone();
    std::thread::spawn(move || search::remove_legacy_index(&legacy_dir));

    let settings_path = settings::settings_path(&data_dir);
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState { db: Arc::new(Mutex::new(conn)), data_dir: data_dir.clone() })
        .setup(move |app| {
            let handle = app.handle().clone();
            settings::spawn_watcher(settings_path.clone(), move |value| {
                let _ = handle.emit("settings-changed", value);
            });
            Ok(())
        });

    #[cfg(feature = "e2e-testing")]
    {
        builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            commands::list_repos,
            commands::add_repo,
            commands::remove_repo,
            commands::get_branches,
            commands::get_tags,
            commands::get_commit_graph,
            commands::ensure_search_index,
            commands::search_commits,
            commands::list_search_index_usage,
            commands::clear_search_index,
            commands::get_github_status,
            commands::list_pull_requests,
            commands::get_pull_request,
            commands::get_pr_diff,
            commands::list_pr_comments,
            commands::add_pr_comment,
            commands::list_pr_review_comments,
            commands::add_pr_review_comment,
            commands::fetch_pr_ref,
            commands::list_github_branches,
            commands::list_commit_pull_requests,
            commands::ci_status_for_commits,
            commands::ci_commit_checks,
            commands::ci_job_log,
            commands::ci_rerun,
            commands::ci_cancel,
            commands::ci_list_runs,
            commands::ci_list_workflows,
            commands::ci_run_jobs,
            commands::list_assignable_users,
            commands::get_status,
            commands::get_working_diff,
            commands::stage_file,
            commands::unstage_file,
            commands::commit_changes,
            commands::get_commit_diff,
            commands::fetch_remote,
            commands::pull_remote,
            commands::push_remote,
            conflicts::list_conflicted_files,
            conflicts::open_in_editor,
            conflicts::abort_merge,
            conflicts::mark_resolved,
            commands::switch_branch,
            commands::checkout_tag,
            commands::create_branch,
            commands::cherry_pick_commit,
            commands::get_ahead_behind,
            commands::release_notes_commits,
            commands::latest_release_tag,
            commands::add_release_note,
            commands::list_release_notes,
            commands::delete_release_note,
            commands::list_open_targets,
            commands::open_in,
            commands::get_repo_settings,
            commands::set_repo_settings,
            commands::reset_repo_settings,
            commands::stash_changes,
            commands::stash_pop,
            commands::discard_changes,
            commands::add_worktree,
            commands::compare_refs,
            commands::get_settings,
            commands::write_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Bettertree");
}

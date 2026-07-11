mod error;
mod db;
mod repo;
mod graph;
mod branch;
mod search;
mod workdir;
mod diff;
mod remote;
mod commands;
mod test_support;

use rusqlite::Connection;
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let data_dir = dirs::data_dir().unwrap().join("bettertree");
    std::fs::create_dir_all(&data_dir).ok();
    let conn = Connection::open(data_dir.join("workspace.db")).expect("failed to open workspace db");
    db::init_db(&conn).expect("failed to init db schema");

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState { db: Arc::new(Mutex::new(conn)) });

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
            commands::get_status,
            commands::get_working_diff,
            commands::stage_file,
            commands::unstage_file,
            commands::commit_changes,
            commands::get_commit_diff,
            commands::fetch_remote,
            commands::pull_remote,
            commands::push_remote,
            commands::switch_branch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Bettertree");
}

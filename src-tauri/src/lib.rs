mod agent_detector;
mod branch_manager;
mod commands;
mod config_manager;
mod git_manager;
mod github_manager;
mod github_sync;
mod linear_manager;
mod pty_manager;
mod state_server;
mod types;

use tauri::Manager;

use commands::{branch, checks, config, diff, github, linear, pty, repo, session, worktree};
use github_sync::SyncState;
use pty_manager::PtyManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(PtyManager::new())
        .manage(SyncState {
            repo_path: std::sync::Mutex::new(None),
        })
        .setup(|app| {
            // Start the background GitHub PR sync loop
            github_sync::start_sync_loop(app.handle().clone());

            // Start the agent state HTTP server for hook callbacks
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state_handle = state_server::start().await;
                eprintln!("[alfredo] state server listening on port {}", state_handle.port);
                handle.manage(state_handle);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // PTY
            pty::spawn_pty,
            pty::write_pty,
            pty::resize_pty,
            pty::close_pty,
            pty::list_sessions,
            // Worktree
            worktree::create_worktree_from,
            worktree::create_worktree,
            worktree::delete_worktree,
            worktree::list_worktrees,
            worktree::get_worktree_status,
            worktree::set_worktree_column,
            // GitHub
            github::sync_pr_status,
            github::get_pr_for_branch,
            checks::get_check_runs,
            github_sync::set_sync_repo_path,
            // Config
            config::get_config,
            config::save_config,
            config::run_setup_scripts,
            // Repo
            repo::validate_git_repo,
            // Branch mode
            branch::list_branches,
            branch::get_active_branch,
            branch::create_branch,
            branch::switch_branch,
            branch::delete_branch,
            // Linear
            linear::search_linear_issues,
            linear::get_linear_issue,
            linear::list_linear_teams,
            // Diff
            diff::get_diff,
            diff::get_commits,
            diff::get_diff_for_commit,
            // Session persistence
            session::save_session_file,
            session::load_session_file,
            session::delete_session_file,
            session::ensure_alfredo_gitignore,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

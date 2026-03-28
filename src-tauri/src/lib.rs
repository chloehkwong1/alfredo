mod agent_detector;
mod app_config_manager;
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

use commands::{app_config, branch, checks, config, diff, github, github_auth, linear, pr_detail, pty, repo, session, worktree};
use github_sync::SyncState;
use pty_manager::PtyManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .manage(PtyManager::new())
        .manage(SyncState {
            repo_paths: std::sync::Mutex::new(Vec::new()),
        })
        .setup(|app| {
            // Migrate legacy single-repo config to app.json
            let app_data = app.path().app_data_dir()
                .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
            let store_path = app_data.clone();
            tauri::async_runtime::block_on(async {
                app_config_manager::migrate_if_needed(&app_data, &store_path).await.ok();
            });

            // Start the background GitHub PR sync loop
            github_sync::start_sync_loop(app.handle().clone());

            // Start the agent state HTTP server for hook callbacks.
            // block_on ensures the port is bound and StateServerHandle is managed
            // before any PTY commands can run — prevents race with session restore.
            let state_handle = tauri::async_runtime::block_on(state_server::start())
                .map_err(|e| format!("failed to start state server: {e}"))?;
            eprintln!("[alfredo] state server listening on port {}", state_handle.port);
            app.manage(state_handle);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // App Config
            app_config::get_app_config,
            app_config::save_app_config,
            app_config::add_app_repo,
            app_config::remove_app_repo,
            app_config::set_active_repo,
            app_config::set_selected_repos,
            app_config::set_display_name,
            app_config::set_repo_color,
            app_config::set_repo_display_name,
            app_config::has_active_sessions,
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
            worktree::get_worktree_diff_stats,
            worktree::get_worktree_status,
            worktree::set_worktree_column,
            // GitHub
            github::sync_pr_status,
            github::get_pr_for_branch,
            checks::get_check_runs,
            checks::rerun_failed_checks,
            checks::get_workflow_log,
            github_sync::set_sync_repo_paths,
            // PR Detail
            pr_detail::get_pr_detail,
            // GitHub Auth
            github_auth::github_auth_status,
            github_auth::github_auth_token,
            github_auth::github_auth_disconnect,
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
            diff::get_uncommitted_diff,
            diff::get_commits,
            diff::get_default_branch,
            diff::get_diff_for_commit,
            // Session persistence
            session::save_session_file,
            session::load_session_file,
            session::delete_session_file,
            session::ensure_alfredo_gitignore,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("error while running tauri application: {e}");
            std::process::exit(1);
        });
}

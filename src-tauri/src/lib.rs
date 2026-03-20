mod commands;
mod types;

use commands::{config, github, linear, pty, worktree};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
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
            // Config
            config::get_config,
            config::save_config,
            config::run_setup_scripts,
            // Linear
            linear::search_linear_issues,
            linear::get_linear_issue,
            linear::list_linear_teams,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

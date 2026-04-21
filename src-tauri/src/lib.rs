mod agent_detector;
mod platform;
mod app_config_manager;
mod ask_alfredo;
mod branch_manager;
mod commands;
mod config_manager;
mod git_manager;
mod github_manager;
mod github_sync;
mod keychain;
mod linear_manager;
mod linear_oauth;
mod patch_parser;
mod pty_manager;
mod sleep_inhibitor;
mod stack_manager;
mod state_server;
mod types;

use tauri::{Manager, RunEvent};

fn updater_endpoint_urls(receive_beta: bool) -> Vec<url::Url> {
    const STABLE: &str =
        "https://github.com/chloehkwong1/alfredo/releases/latest/download/latest.json";
    const BETA: &str =
        "https://github.com/chloehkwong1/alfredo/releases/download/beta-latest/latest.json";
    let list: &[&str] = if receive_beta { &[BETA, STABLE] } else { &[STABLE] };
    list.iter()
        .filter_map(|s| url::Url::parse(s).ok())
        .collect()
}

use commands::{agents, app_config, app_detection, ask_alfredo as ask_alfredo_cmd, audio, branch, checks, config, diff, external_tools, git_ops, github, github_auth, linear, linear_oauth as linear_oauth_cmds, pr_detail, pty, repo, session, updater as updater_cmds, worktree};
use github_sync::SyncState;
use pty_manager::PtyManager;
use sleep_inhibitor::SleepInhibitor;
use stack_manager::StackState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(PtyManager::new())
        .manage(std::sync::Arc::new(SleepInhibitor::new()))
        .manage(updater_cmds::PendingUpdate::default())
        .manage(SyncState {
            repo_paths: std::sync::Mutex::new(Vec::new()),
            active_branches: std::sync::Mutex::new(std::collections::HashSet::new()),
        })
        .manage(StackState::new())
        .setup(|app| {
            // Migrate legacy single-repo config to app.json
            let app_data = app.path().app_data_dir()
                .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
            let store_path = app_data.clone();
            tauri::async_runtime::block_on(async {
                if let Err(e) = app_config_manager::migrate_if_needed(&app_data, &store_path).await {
                    eprintln!("[alfredo] config migration failed: {e}");
                }
            });

            // Migrate dev-build secrets from JSON file to OS keychain
            keychain::migrate_dev_secrets();

            // Start the background GitHub PR sync loop
            github_sync::start_sync_loop(app.handle().clone());

            // Start the agent state HTTP server for hook callbacks.
            // block_on ensures the port is bound and StateServerHandle is managed
            // before any PTY commands can run — prevents race with session restore.
            let inhibitor = app.state::<std::sync::Arc<SleepInhibitor>>();
            let state_handle = tauri::async_runtime::block_on(
                state_server::start(std::sync::Arc::clone(&inhibitor)),
            )
            .map_err(|e| format!("failed to start state server: {e}"))?;
            eprintln!("[alfredo] state server listening on port {}", state_handle.port);
            app.manage(state_handle);

            // Strip any stale Alfredo hooks left behind by a prior run that
            // didn't shut down cleanly (crash, force-quit). Without this, old
            // hook entries sit in .claude/settings.local.json and fire curl
            // against a dead state_server port on every tool call.
            if let Some(cfg) = app_config_manager::load_sync_best_effort() {
                let mut paths: Vec<String> = Vec::new();
                for repo in &cfg.repos {
                    // Include the primary working tree — git2's worktrees()
                    // only enumerates linked worktrees, not the main one.
                    paths.push(repo.path.clone());
                    match git_manager::list_worktrees(&repo.path, None) {
                        Ok(wts) => paths.extend(wts.into_iter().map(|w| w.path)),
                        Err(e) => eprintln!("[alfredo] startup-cleanup: list_worktrees({}) failed: {e}", repo.path),
                    }
                }
                let manager = app.state::<PtyManager>();
                manager.cleanup_stale_hooks_in_paths(&paths);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Audio
            audio::play_sound,
            // Ask Alfredo
            ask_alfredo_cmd::search_alfredo_docs,
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
            app_config::set_worktree_label,
            app_config::set_comment_chips,
            app_config::has_active_sessions,
            // PTY
            pty::spawn_pty,
            pty::write_pty,
            pty::resize_pty,
            pty::close_pty,
            pty::reattach_pty,
            pty::list_sessions,
            // Worktree
            worktree::create_worktree_from,
            worktree::create_worktree,
            worktree::delete_worktree,
            worktree::list_worktrees,
            worktree::get_worktree_diff_stats,
            worktree::get_worktree_status,
            worktree::set_worktree_column,
            worktree::get_commits_behind_main,
            worktree::rebase_worktree,
            worktree::set_stack_parent,
            worktree::set_worktree_port,
            // GitHub
            github::sync_pr_status,
            github::get_pr_for_branch,
            checks::get_check_runs,
            checks::rerun_failed_checks,
            checks::get_job_log,
            github_sync::set_sync_repo_paths,
            // PR Detail
            pr_detail::get_pr_detail,
            pr_detail::get_pr_files,
            pr_detail::get_pr_commits,
            // GitHub Auth
            github_auth::github_auth_status,
            github_auth::github_auth_token,
            github_auth::github_auth_disconnect,
            // Config
            config::get_config,
            config::save_config,
            config::run_setup_scripts,
            config::run_archive_script,
            config::set_repo_mode,
            // Repo
            repo::validate_git_repo,
            // Branch mode
            branch::list_branches,
            branch::get_active_branch,
            // Linear
            linear::search_linear_issues,
            linear::list_my_linear_issues,
            linear::get_linear_issue,
            linear::list_linear_teams,
            // Linear OAuth
            linear_oauth_cmds::linear_oauth_start,
            linear_oauth_cmds::linear_oauth_disconnect,
            linear_oauth_cmds::linear_oauth_status,
            // Diff
            diff::get_diff,
            diff::get_uncommitted_diff,
            diff::get_commits,
            diff::get_full_commits,
            diff::get_git_user,
            diff::get_default_branch,
            diff::get_diff_for_commit,
            diff::get_file_lines,
            diff::discard_file,
            diff::discard_all_uncommitted,
            // External Tools
            external_tools::open_in_editor,
            external_tools::open_in_terminal,
            // Agent detection
            agents::detect_available_agents,
            // App detection
            app_detection::detect_installed_apps,
            app_detection::open_in_app,
            // Session persistence
            session::save_session_file,
            session::load_session_file,
            session::delete_session_file,
            session::find_claude_session,
            // Git ops
            git_ops::git_merge,
            git_ops::git_push_force_with_lease,
            // Updater
            updater_cmds::check_for_update_filtered,
            updater_cmds::install_pending_update,
        ])
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("error while running tauri application: {e}");
            std::process::exit(1);
        })
        .run(|app, event| {
            if let RunEvent::Exit = event {
                // Remove Alfredo hooks from all worktrees so standalone
                // Claude Code sessions don't inherit stale hook config.
                if let Some(manager) = app.try_state::<PtyManager>() {
                    manager.cleanup_all_hooks();
                }
            }
        });
}

#[cfg(test)]
mod updater_endpoint_tests {
    use super::updater_endpoint_urls;

    #[test]
    fn stable_users_get_only_stable_endpoint() {
        let endpoints = updater_endpoint_urls(false);
        assert_eq!(endpoints.len(), 1);
        assert!(endpoints[0].as_str().contains("/releases/latest/download/"));
    }

    #[test]
    fn beta_users_get_beta_first_with_stable_fallback() {
        let endpoints = updater_endpoint_urls(true);
        assert_eq!(endpoints.len(), 2);
        assert!(endpoints[0].as_str().contains("/beta-latest/"));
        assert!(endpoints[1].as_str().contains("/releases/latest/download/"));
    }
}

#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

mod agent_detector;
mod platform;
mod app_config_manager;
mod ask_alfredo;
mod atomic_write;
mod bounded_lru;
mod branch_manager;
mod commands;
mod config_manager;
mod git_manager;
mod github_manager;
mod github_sync;
mod keychain;
mod linear_manager;
mod linear_oauth;
mod logging;
#[cfg(target_os = "macos")]
mod macos_notifications;
mod patch_parser;
mod pty_manager;
pub mod repo_config;
mod sleep_inhibitor;
mod stack_manager;
mod state_server;
pub mod types;

use tauri::{Manager, RunEvent};

/// In debug builds on macOS, paint the dock icon with a DEV-badged variant so
/// the running dev binary is visually distinct from the installed release
/// build. Must run after `RunEvent::Ready` — Tauri sets its own icon during
/// window initialization, and a `setup` hook would lose the race.
#[cfg(all(debug_assertions, target_os = "macos"))]
fn apply_dev_dock_icon() {
    use objc2::AnyThread;
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::{MainThreadMarker, NSData, NSProcessInfo, NSString};

    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    unsafe {
        let ns_app = NSApplication::sharedApplication(mtm);
        let data = NSData::with_bytes(include_bytes!("../icons/icon-dev.png"));
        if let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) {
            ns_app.setApplicationIconImage(Some(&image));
        }
        NSProcessInfo::processInfo().setProcessName(&NSString::from_str("Alfredo Dev"));
    }
}

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

/// Whether an offered update version may be installed on the current channel.
///
/// Stable-channel clients must refuse prerelease builds even when the feed
/// serves one: GitHub's `latest` pointer can be moved onto a prerelease by a
/// release-process slip, and that must never reach stable users (issue #47).
/// SemVer marks prereleases with a `-suffix` after MAJOR.MINOR.PATCH
/// ("0.16.0-beta.1"); the version core never contains a hyphen.
fn should_offer_version(version: &str, receive_beta: bool) -> bool {
    receive_beta || !version.contains('-')
}

/// Index of the highest version in `candidates` this channel may install.
///
/// `updater_endpoint_urls` hands the plugin an ordered list, but the plugin
/// stops at the first endpoint that returns a parseable release
/// (tauri-plugin-updater 2.10.1, `updater.rs`: "we found a release, break the
/// loop") — it never compares across feeds. So a `beta-latest` pointer left
/// behind by a run of stable-only releases answers first, wins, and pins beta
/// users below current stable while reporting "up to date". Querying each
/// endpoint separately and ranking the answers here is what makes the
/// stable entry reachable for beta users.
///
/// Versions that don't parse as SemVer are skipped rather than fatal: one
/// malformed feed must not sink a check the other feed could satisfy.
fn best_offer_index(candidates: &[String], receive_beta: bool) -> Option<usize> {
    candidates
        .iter()
        .enumerate()
        .filter(|(_, v)| should_offer_version(v, receive_beta))
        .filter_map(|(i, v)| semver::Version::parse(v).ok().map(|parsed| (i, parsed)))
        .max_by(|(_, a), (_, b)| a.cmp(b))
        .map(|(i, _)| i)
}

use commands::{agents, app_config, app_detection, ask_alfredo as ask_alfredo_cmd, audio, branch, checks, claude_registry, clipboard, config, debug_log as debug_log_cmd, diff, dock_badge, external_tools, git_ops, github, github_auth, linear, linear_launch, linear_oauth as linear_oauth_cmds, notes, notification, output_styles, pr_detail, pr_review, pty, repo, session, updater as updater_cmds, worktree};
use github_sync::SyncState;
use pty_manager::PtyManager;
use sleep_inhibitor::SleepInhibitor;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Funnel an inbound open-issue request (argv or `alfredo://` deep link) into
/// the cold-start buffer and — when the webview is already listening — the
/// `linear://open-issue` event. Repo matching is best-effort: a `workdir`-less
/// request (Linear "Custom link" mode) simply yields no `matched_repo_path`.
fn dispatch_open_issue<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    mut req: commands::linear_launch::OpenIssueRequest,
    emit: bool,
) {
    use tauri::{Emitter, Manager};
    let repo_paths: Vec<String> = crate::app_config_manager::load_sync_best_effort()
        .map(|cfg| cfg.repos.into_iter().map(|r| r.path).collect())
        .unwrap_or_default();
    req.matched_repo_path =
        commands::linear_launch::match_workdir_to_repo(&req.workdir, &repo_paths);
    if let Some(state) = app.try_state::<commands::linear_launch::PendingOpenIssue>() {
        if let Ok(mut g) = state.0.lock() {
            *g = Some(req.clone());
        }
    }
    if emit {
        let _ = app.emit("linear://open-issue", req);
    }
}

pub fn run() {
    // Dock/Finder launches have no locale in the environment, and WKWebView
    // falls back to MacRoman as the default C-string encoding — which mojibakes
    // any non-ASCII string crossing the JS→Rust IPC boundary (fetch bodies on
    // the ipc:// protocol get re-decoded as MacRoman inside WebKit). Terminal
    // launches never hit this because the shell exports LANG. Pin a UTF-8
    // locale before the webview (and its XPC children) spawn; respect an
    // existing user locale.
    if std::env::var_os("LANG").is_none() {
        std::env::set_var("LANG", "en_US.UTF-8");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            use tauri::Manager;
            // Strict router: only act on a valid open-issue invocation. Anything
            // else (plain relaunch, updater relaunch) just focuses the window.
            if let Some(req) = commands::linear_launch::parse_open_issue(&argv) {
                dispatch_open_issue(app, req, true);
            }
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(PtyManager::new())
        .manage(std::sync::Arc::new(SleepInhibitor::new()))
        .manage(updater_cmds::PendingUpdate::default())
        .manage(SyncState {
            repo_paths: std::sync::Mutex::new(Vec::new()),
            active_branches: std::sync::Mutex::new(std::collections::HashSet::new()),
        })
        .manage(commands::worktree::PortConfigLock::default())
        .manage(commands::session::ResumeSidecarLock::default())
        .manage(commands::linear_launch::PendingOpenIssue::default())
        .setup(|app| {
            crate::logging::init();
            // Cold-start handling for Linear "open in Alfredo": the
            // single-instance callback only fires for a *second* instance, so a
            // first/fresh instance launched with `open-issue …` args must parse
            // them here and buffer the request for the frontend to drain on mount
            // (via take_pending_open_issue).
            {
                let argv: Vec<String> = std::env::args().collect();
                if let Some(req) = commands::linear_launch::parse_open_issue(&argv) {
                    eprintln!("[linear] cold-start open-issue (argv): branch={}", req.branch);
                    dispatch_open_issue(app.handle(), req, false);
                }
            }
            // Deep-link transport: an `alfredo://open-issue?…` URL opened via the
            // OS (no terminal, unlike the raw-binary custom script). A cold start
            // surfaces the launch URL through get_current; a warm app receives it
            // through on_open_url. Both funnel into the same buffer/event path.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    for url in &urls {
                        if let Some(req) =
                            commands::linear_launch::parse_open_issue_url(url.as_str())
                        {
                            eprintln!("[linear] cold-start open-issue (deep link)");
                            dispatch_open_issue(app.handle(), req, false);
                        }
                    }
                }
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    use tauri::Manager;
                    for url in event.urls() {
                        if let Some(req) =
                            commands::linear_launch::parse_open_issue_url(url.as_str())
                        {
                            dispatch_open_issue(&handle, req, true);
                            if let Some(win) = handle.get_webview_window("main") {
                                let _ = win.set_focus();
                            }
                        }
                    }
                });
            }
            // Warm the shared HTTP client so any TLS-init failure surfaces
            // at startup rather than on the first GitHub interaction.
            crate::github_manager::init_shared_clients();
            // Replace the default macOS menu with one that omits the "Help"
            // submenu. macOS binds ⌘⇧? to the Help menu's search field at the
            // OS level, which swallows our keyboard-shortcuts overlay binding
            // before it reaches the webview.
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::Menu;
                let menu = Menu::default(app.handle())?;
                let items = menu.items()?;
                // Help is always the last submenu in the macOS default menu.
                // Match by title first; fall back to positional removal so
                // non-English locales (Aide, Ayuda, …) still work.
                let help_idx = items
                    .iter()
                    .position(|item| {
                        item.as_submenu()
                            .and_then(|s| s.text().ok())
                            .is_some_and(|t| t == "Help")
                    })
                    .or_else(|| items.len().checked_sub(1));
                if let Some(i) = help_idx {
                    menu.remove_at(i)?;
                }
                app.set_menu(menu)?;
            }


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

            // Hydrate durable NeedsPush/PushFailed state BEFORE the sync loop
            // starts: the first poll's decide_follow_action needs the sticky
            // tiebreaker in place or it can adopt a stale origin copy.
            stack_manager::init_sticky_persistence(&app_data);

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

            // Kill session process trees leaked by a prior run that didn't
            // shut down cleanly (crash, Force Quit). Runs BEFORE the stale-
            // hooks cleanup below: reaping removes the dead sessions' pid
            // files, so the cleanup no longer treats them as live and strips
            // their hooks in the same boot.
            pty_manager::reap_orphan_sessions();

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
            clipboard::set_clipboard_text,
            // Dock badge (macOS/Linux)
            dock_badge::set_dock_badge,
            // Debug logging bridge (frontend → alfredo.log)
            debug_log_cmd::debug_log,
            // Ask Alfredo
            ask_alfredo_cmd::search_alfredo_docs,
            ask_alfredo_cmd::get_whats_new,
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
            app_config::set_repo_short_label,
            app_config::set_worktree_label,
            app_config::set_comment_chips,
            app_config::has_active_sessions,
            app_config::mark_whats_new_seen,
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
            worktree::worktree_dirty_state,
            worktree::list_worktrees,
            worktree::count_worktrees,
            worktree::adopt_worktree,
            worktree::get_worktree_diff_stats,
            worktree::get_worktree_status,
            worktree::set_worktree_column,
            worktree::set_pr_association,
            worktree::clear_pr_association,
            worktree::clear_worktree_column,
            worktree::set_worktree_orders,
            worktree::get_worktree_order,
            worktree::set_worktree_linear_ticket,
            worktree::get_commits_behind_main,
            worktree::get_ahead_behind_origin,
            worktree::rebase_worktree,
            worktree::drop_commit,
            worktree::is_commit_pushed,
            worktree::set_stack_parent,
            worktree::restack_now,
            worktree::push_stack_branch,
            worktree::restack_stack,
            worktree::change_stack_base,
            worktree::resolve_stack_pending,
            worktree::prepare_conflict_handoff,
            worktree::claim_worktree_port,
            worktree::release_worktree_port,
            worktree::take_worktree_port,
            worktree::reconcile_worktree_ports,
            worktree::get_assigned_worktree_port,
            // GitHub
            github::sync_pr_status,
            github::get_pr_by_number,
            github::find_pr_for_branch,
            checks::get_check_runs,
            checks::rerun_failed_checks,
            checks::get_job_log,
            github_sync::set_sync_repo_paths,
            // PR Detail
            pr_detail::get_pr_detail,
            pr_detail::get_pr_files,
            pr_detail::get_pr_commits,
            // PR Review
            pr_review::submit_pr_review,
            pr_review::reply_to_pr_comment,
            pr_review::set_pr_thread_resolved,
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
            config::get_repo_config_layers,
            config::read_alfredo_json,
            config::write_alfredo_json,
            config::reset_repo_overrides,
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
            diff::get_file_content,
            diff::toggle_task_list_item,
            diff::discard_file,
            diff::discard_all_uncommitted,
            // External Tools
            external_tools::open_in_editor,
            external_tools::open_in_terminal,
            // Agent detection
            agents::detect_available_agents,
            // Output styles
            output_styles::list_output_styles,
            // App detection
            app_detection::detect_installed_apps,
            app_detection::open_in_app,
            // Session persistence
            session::save_session_file,
            session::load_session_file,
            session::delete_session_file,
            session::migrate_session_files,
            session::record_resume_session_id,
            session::load_resume_session_ids,
            session::find_claude_session,
            session::list_claude_sessions,
            session::dump_pty_buffer,
            // Claude registry
            claude_registry::poll_claude_registry,
            // Git ops
            git_ops::git_merge,
            git_ops::git_push_force_with_lease,
            git_ops::git_push,
            git_ops::git_pull_rebase,
            git_ops::git_publish_branch,
            // Updater
            updater_cmds::check_for_update_filtered,
            updater_cmds::install_pending_update,
            // Notes
            notes::read_worktree_notes,
            notes::write_worktree_notes,
            // Notifications
            notification::send_app_notification,
            notification::notification_permission_status,
            notification::request_notification_permission,
            // Linear coding-tool
            linear_launch::take_pending_open_issue,
        ])
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("error while running tauri application: {e}");
            std::process::exit(1);
        })
        .run(|app, event| match event {
            RunEvent::Ready => {
                #[cfg(all(debug_assertions, target_os = "macos"))]
                apply_dev_dock_icon();
                #[cfg(target_os = "macos")]
                {
                    crate::macos_notifications::install_presentation_delegate();
                    // Always prompt at startup if the user hasn't decided yet.
                    // Gating on the config-enabled flag turned out to be a footgun
                    // for fresh installs where app.json hasn't been written yet.
                    if matches!(
                        crate::macos_notifications::authorization_status(),
                        crate::macos_notifications::PermissionStatus::Default,
                    ) {
                        std::thread::spawn(|| {
                            let _ = crate::macos_notifications::request_authorization();
                        });
                    }
                }
            }
            RunEvent::Exit => {
                if let Some(manager) = app.try_state::<PtyManager>() {
                    // Kill every session's process tree first — otherwise the
                    // child agents (and their MCP-server stacks) outlive the
                    // app and leak fds until EMFILE. Then remove Alfredo hooks
                    // from all worktrees so standalone Claude Code sessions
                    // don't inherit stale hook config.
                    manager.shutdown_all();
                    manager.cleanup_all_hooks();
                }
            }
            _ => {}
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

#[cfg(test)]
mod best_offer_tests {
    use super::best_offer_index;

    #[test]
    fn beta_channel_prefers_a_newer_stable_over_a_stale_beta() {
        // The real failure: beta-latest still advertised 0.19.0-beta.1 from
        // July while three stable releases shipped after it. The plugin's own
        // endpoint loop stops at the first feed that answers, so beta users
        // were pinned below current stable and told they were up to date.
        let candidates = ["0.19.0-beta.1".to_string(), "0.20.1".to_string()];
        assert_eq!(best_offer_index(&candidates, true), Some(1));
    }

    #[test]
    fn beta_channel_prefers_a_newer_beta_over_stable() {
        let candidates = ["0.21.0-beta.1".to_string(), "0.20.1".to_string()];
        assert_eq!(best_offer_index(&candidates, true), Some(0));
    }

    #[test]
    fn stable_channel_skips_a_higher_prerelease() {
        // Issue #47 again, now that more than one feed is consulted: the
        // prerelease may be the highest version and must still be refused.
        let candidates = ["0.21.0-beta.1".to_string(), "0.20.1".to_string()];
        assert_eq!(best_offer_index(&candidates, false), Some(1));
    }

    #[test]
    fn no_installable_candidate_yields_none() {
        let candidates = ["0.21.0-beta.1".to_string()];
        assert_eq!(best_offer_index(&candidates, false), None);
        assert_eq!(best_offer_index(&[], true), None);
    }

    #[test]
    fn unparseable_versions_are_skipped_not_fatal() {
        let candidates = ["not-a-version".to_string(), "0.20.1".to_string()];
        assert_eq!(best_offer_index(&candidates, true), Some(1));
    }
}

#[cfg(test)]
mod updater_channel_guard_tests {
    use super::should_offer_version;

    #[test]
    fn stable_channel_refuses_prerelease_versions() {
        // The exact scenario from issue #47: a beta wrongly served at the
        // stable `latest` slot must not be offered to a stable user.
        assert!(!should_offer_version("0.16.0-beta.1", false));
        assert!(!should_offer_version("0.17.0-beta.2", false));
    }

    #[test]
    fn stable_channel_accepts_stable_versions() {
        assert!(should_offer_version("0.16.0", false));
    }

    #[test]
    fn stable_channel_accepts_build_metadata() {
        // Build metadata uses `+`, never `-`, so the hyphen heuristic must not
        // mistake a stable build-metadata version for a prerelease.
        assert!(should_offer_version("0.16.0+ci.123", false));
    }

    #[test]
    fn beta_channel_accepts_both() {
        assert!(should_offer_version("0.16.0-beta.1", true));
        assert!(should_offer_version("0.16.0", true));
    }
}

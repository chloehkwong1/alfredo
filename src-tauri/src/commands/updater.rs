use crate::app_config_manager;
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::UpdaterExt;

/// The update most recently offered to the user, kept across a failed install
/// so "Update & restart" can retry, plus whether an install is running now.
#[derive(Default)]
pub struct PendingUpdate {
    pub(crate) update: tokio::sync::Mutex<Option<tauri_plugin_updater::Update>>,
    installing: AtomicBool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub body: Option<String>,
}

impl UpdateInfo {
    fn from_update(update: &tauri_plugin_updater::Update) -> Self {
        Self {
            version: update.version.clone(),
            current_version: update.current_version.clone(),
            body: update.body.clone(),
        }
    }
}

#[tauri::command]
pub async fn check_for_update_filtered(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    // While an install is running, re-report what it is installing rather
    // than answering `None`: the settings button renders `None` as "You're up
    // to date", which is a lie to someone still on the old build (issue #77).
    // Outside an install the feeds are re-queried, so a stored offer that was
    // since yanked or superseded is replaced, not re-asserted.
    if pending.installing.load(Ordering::SeqCst) {
        return Ok(pending
            .update
            .lock()
            .await
            .as_ref()
            .map(UpdateInfo::from_update));
    }

    let receive_beta = app_config_manager::load_sync_best_effort()
        .map(|c| c.receive_beta_updates)
        .unwrap_or(false);

    // Query each endpoint on its own updater instead of handing the plugin the
    // whole list. The plugin's loop stops at the first feed that returns a
    // parseable release, so a `beta-latest` pointer left behind by a run of
    // stable-only releases answers first and hides a newer stable — beta users
    // sit below current stable and are told they are up to date.
    let mut updates = Vec::new();
    let mut any_success = false;
    let mut last_error: Option<String> = None;
    for endpoint in crate::updater_endpoint_urls(receive_beta) {
        let built = app
            .updater_builder()
            .endpoints(vec![endpoint])
            .and_then(tauri_plugin_updater::UpdaterBuilder::build);
        match built {
            Ok(updater) => match updater.check().await {
                Ok(Some(update)) => {
                    any_success = true;
                    updates.push(update);
                }
                Ok(None) => any_success = true,
                Err(e) => last_error = Some(e.to_string()),
            },
            Err(e) => last_error = Some(e.to_string()),
        }
    }

    // Surface an error only when NO feed completed at all: one unreachable
    // feed must not fail a check another feed already answered — a beta user
    // with a dead beta feed but a healthy stable feed that reported
    // up-to-date should see "up to date", not a swallowed error.
    if updates.is_empty() {
        return match last_error {
            // Nothing answered: keep whatever offer we already hold so a
            // retry after a failed install still works offline.
            Some(e) if !any_success => Err(e),
            _ => {
                *pending.update.lock().await = None;
                Ok(None)
            }
        };
    }

    let versions: Vec<String> = updates.iter().map(|u| u.version.clone()).collect();
    match crate::best_offer_index(&versions, receive_beta) {
        Some(i) => {
            let update = updates.swap_remove(i);
            let info = UpdateInfo::from_update(&update);
            *pending.update.lock().await = Some(update);
            Ok(Some(info))
        }
        // Every candidate was a prerelease on the stable channel — the issue
        // #47 anomaly. Refuse and log so a release-process slip stays visible.
        None => {
            eprintln!(
                "[updater] refused prerelease(s) {} on stable channel (issue #47)",
                versions.join(", ")
            );
            *pending.update.lock().await = None;
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn install_pending_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = pending
        .update
        .lock()
        .await
        .clone()
        .ok_or_else(|| "no pending update".to_string())?;

    // Where the plugin will rename the bundle out of and back into. `None`
    // outside macOS: the plugin installs AppImages via $APPIMAGE and deb/rpm
    // via the package manager, neither of which touches the exe's directory.
    let install_dir = install_dir();
    if let Some(dir) = install_dir.as_deref() {
        if dir_is_read_only(dir) {
            let reason = read_only_install_message(dir);
            tracing::warn!("refusing update install: {reason}");
            return Err(reason);
        }
    }

    let app_for_progress = app.clone();
    let app_for_finished = app.clone();
    pending.installing.store(true, Ordering::SeqCst);
    let result = update
        .download_and_install(
            move |chunk_length, content_length| {
                let _ = app_for_progress.emit(
                    "updater://progress",
                    serde_json::json!({
                        "chunkLength": chunk_length,
                        "contentLength": content_length,
                    }),
                );
            },
            move || {
                if let Err(e) = app_for_finished.emit("updater://finished", ()) {
                    eprintln!("[updater] failed to emit finished event: {e}");
                }
            },
        )
        .await;
    pending.installing.store(false, Ordering::SeqCst);

    result.map_err(|e| {
        tracing::error!("failed to download/install update: {e}");
        match install_dir.as_deref() {
            Some(dir) => friendly_install_error(&e, dir),
            None => e.to_string(),
        }
    })?;

    // Only clear the stored update on success so a retry is possible on failure.
    *pending.update.lock().await = None;

    Ok(())
}

/// The directory the updater plugin needs to be writable on macOS: it renames
/// the running `.app` out of its parent and the new one in (issue #77: a copy
/// launched from a mounted DMG or a Gatekeeper-translocated path fails that
/// rename with a bare "Read-only file system (os error 30)" after the whole
/// download). Resolved with the plugin's own path logic so the two agree.
#[cfg(target_os = "macos")]
fn install_dir() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let bundle = tauri_plugin_updater::extract_path_from_executable(&exe).ok()?;
    bundle.parent().map(Path::to_path_buf)
}

#[cfg(not(target_os = "macos"))]
fn install_dir() -> Option<std::path::PathBuf> {
    None
}

/// True only when creating a file in `dir` fails with EROFS. Every other
/// failure (missing dir, permissions) is left for the real install to report.
#[cfg(target_os = "macos")]
fn dir_is_read_only(dir: &Path) -> bool {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let probe = dir.join(format!(".alfredo-update-probe-{}-{nanos}", std::process::id()));
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
    {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            false
        }
        Err(e) => e.kind() == std::io::ErrorKind::ReadOnlyFilesystem,
    }
}

#[cfg(not(target_os = "macos"))]
fn dir_is_read_only(_dir: &Path) -> bool {
    false
}

/// The plugin's error, reworded when it is the read-only failure the preflight
/// exists to catch — so a mismatch between the preflight's path and the
/// plugin's never sends the raw errno back to the user.
fn friendly_install_error(err: &tauri_plugin_updater::Error, install_dir: &Path) -> String {
    match err {
        tauri_plugin_updater::Error::Io(io)
            if io.kind() == std::io::ErrorKind::ReadOnlyFilesystem =>
        {
            read_only_install_message(install_dir)
        }
        _ => err.to_string(),
    }
}

fn read_only_install_message(dir: &Path) -> String {
    let s = dir.to_string_lossy();
    if s.contains("/AppTranslocation/") {
        "macOS is running Alfredo from a quarantine copy, so it can't update itself. Drag Alfredo into your Applications folder using Finder and open it from there, then try again.".to_string()
    } else if s.starts_with("/Volumes/") {
        format!("Alfredo is running from a read-only volume ({s}), usually the downloaded disk image, so it can't update itself. Eject it and open Alfredo from your Applications folder, then try again.")
    } else {
        format!("Alfredo is running from a read-only location ({s}), so it can't update itself. Move it to your Applications folder and open it from there, then try again.")
    }
}

#[cfg(all(test, target_os = "macos"))]
mod install_location_tests {
    use super::{dir_is_read_only, friendly_install_error, read_only_install_message};
    use std::path::Path;

    #[test]
    fn message_hints_at_the_disk_image_for_a_volumes_mount_without_asserting_it() {
        // /Volumes/ is usually the downloaded DMG, but can also be a read-only
        // external drive — name the path and suggest, don't insist.
        let msg = read_only_install_message(Path::new("/Volumes/Alfredo"));
        assert!(msg.contains("/Volumes/Alfredo"), "{msg}");
        assert!(msg.contains("disk image"), "{msg}");
        assert!(msg.contains("Applications"), "{msg}");
    }

    #[test]
    fn message_names_quarantine_for_a_translocated_copy() {
        let msg = read_only_install_message(Path::new(
            "/private/var/folders/x1/abc/T/AppTranslocation/3F2A-1B/d",
        ));
        assert!(msg.contains("quarantine"), "{msg}");
        assert!(msg.contains("Applications"), "{msg}");
    }

    #[test]
    fn message_falls_back_to_a_generic_read_only_hint() {
        let msg = read_only_install_message(Path::new("/opt/somewhere"));
        assert!(msg.contains("read-only"), "{msg}");
        assert!(msg.contains("/opt/somewhere"), "{msg}");
        assert!(msg.contains("Applications"), "{msg}");
    }

    #[test]
    fn writable_dir_is_not_read_only() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!dir_is_read_only(dir.path()));
        // The probe must not leave anything behind.
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn missing_dir_is_not_reported_as_read_only() {
        // Only EROFS counts; any other failure is left for the real install to surface.
        assert!(!dir_is_read_only(Path::new("/definitely/not/a/dir")));
    }

    #[test]
    fn sealed_system_volume_is_read_only() {
        // `/` is the sealed system volume on macOS 10.15+; creating a file there
        // yields EROFS even for a non-root user, the same error a mounted DMG gives.
        assert!(dir_is_read_only(Path::new("/")));
    }

    #[test]
    fn plugin_read_only_io_error_gets_the_friendly_message() {
        // Defence in depth: if the preflight's idea of the install path ever
        // disagrees with the plugin's, the raw errno must still not reach the user.
        let err = tauri_plugin_updater::Error::Io(std::io::Error::from(
            std::io::ErrorKind::ReadOnlyFilesystem,
        ));
        let msg = friendly_install_error(&err, Path::new("/Volumes/Alfredo"));
        assert!(msg.contains("Applications"), "{msg}");
        assert!(!msg.contains("os error"), "{msg}");
    }

    #[test]
    fn other_plugin_errors_pass_through_unchanged() {
        let err = tauri_plugin_updater::Error::Io(std::io::Error::from(
            std::io::ErrorKind::PermissionDenied,
        ));
        assert_eq!(
            friendly_install_error(&err, Path::new("/Applications")),
            err.to_string()
        );
    }
}

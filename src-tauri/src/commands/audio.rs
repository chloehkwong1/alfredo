use std::io::BufReader;
use std::fs::File;
use tauri::{AppHandle, Manager};

use crate::types::AppError;

/// Play a bundled sound by id. Non-blocking: spawns a dedicated thread that
/// owns the OutputStream + Sink for the lifetime of the playback, then exits.
///
/// A fresh OutputStream is created per call on purpose — the same zombie-state
/// class of bug that affects WKWebView's AudioContext (macOS sleep/wake,
/// audio device changes) can affect cached rodio streams too. Opening fresh
/// each call is cheap for sub-second clips.
#[tauri::command]
pub async fn play_sound(app: AppHandle, id: String) -> Result<(), AppError> {
    if id == "none" || id.is_empty() {
        return Ok(());
    }

    // Allow-list the id to defend against path traversal via the wav filename.
    if !id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()) {
        return Err(AppError::Config(format!("invalid sound id: {id}")));
    }

    let path = app
        .path()
        .resolve(format!("sounds/{id}.wav"), tauri::path::BaseDirectory::Resource)
        .map_err(|e| AppError::Config(format!("failed to resolve sound path: {e}")))?;

    if !path.exists() {
        return Err(AppError::Config(format!("sound not found: {id}")));
    }

    // Spawn blocking thread so the command returns immediately.
    std::thread::spawn(move || {
        if let Err(e) = play_blocking(&path) {
            eprintln!("[audio] playback failed for {}: {e}", path.display());
        }
    });

    Ok(())
}

fn play_blocking(path: &std::path::Path) -> Result<(), Box<dyn std::error::Error>> {
    let (_stream, handle) = rodio::OutputStream::try_default()?;
    let sink = rodio::Sink::try_new(&handle)?;
    let file = BufReader::new(File::open(path)?);
    let source = rodio::Decoder::new_wav(file)?;
    sink.append(source);
    sink.sleep_until_end();
    // _stream and sink drop here, releasing the audio device.
    Ok(())
}

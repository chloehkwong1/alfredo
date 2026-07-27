use std::process::Command;

use crate::platform::augmented_path;
use crate::types::AppError;

fn editor_command(
    editor: &str,
    path: &str,
    custom_path: Option<&str>,
    line: Option<u32>,
    col: Option<u32>,
) -> Result<(String, Vec<String>), AppError> {
    // `path:line[:col]` for editors whose CLI accepts the suffix form.
    let with_line = match (line, col) {
        (Some(l), Some(c)) => format!("{path}:{l}:{c}"),
        (Some(l), None) => format!("{path}:{l}"),
        _ => path.to_string(),
    };
    match editor {
        "vscode" => Ok(("code".into(), vec!["--goto".into(), with_line])),
        "cursor" => Ok(("cursor".into(), vec!["--goto".into(), with_line])),
        "zed" => Ok(("zed".into(), vec![with_line])),
        "vim" => {
            let mut args = Vec::new();
            if let Some(l) = line {
                args.push(format!("+{l}"));
            }
            args.push(path.into());
            Ok(("nvim".into(), args))
        }
        "custom" => {
            let cmd = custom_path
                .ok_or_else(|| AppError::Config("Custom editor path not set".into()))?;
            Ok((cmd.into(), vec![path.into()]))
        }
        _ => Err(AppError::Config(format!("Unknown editor: {editor}"))),
    }
}

fn terminal_command(terminal: &str, path: &str, custom_path: Option<&str>) -> Result<(String, Vec<String>), AppError> {
    match terminal {
        "iterm" => Ok(("open".into(), vec!["-a".into(), "iTerm".into(), path.into()])),
        "terminal" => Ok(("open".into(), vec!["-a".into(), "Terminal".into(), path.into()])),
        "warp" => Ok(("open".into(), vec!["-a".into(), "Warp".into(), path.into()])),
        "ghostty" => Ok(("open".into(), vec!["-a".into(), "Ghostty".into(), path.into()])),
        "custom" => {
            let cmd = custom_path
                .ok_or_else(|| AppError::Config("Custom terminal path not set".into()))?;
            Ok((cmd.into(), vec![path.into()]))
        }
        _ => Err(AppError::Config(format!("Unknown terminal: {terminal}"))),
    }
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn open_in_editor(
    path: String,
    editor: String,
    custom_path: Option<String>,
    line: Option<u32>,
    col: Option<u32>,
) -> Result<(), AppError> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(AppError::Config(format!("Path does not exist: {path}")));
    }

    let (cmd, args) = editor_command(&editor, &path, custom_path.as_deref(), line, col)?;

    Command::new(&cmd)
        .args(&args)
        .env("PATH", augmented_path())
        .spawn()
        .map_err(|e| AppError::Config(format!("Failed to open editor ({cmd}): {e}")))?;

    Ok(())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn open_in_terminal(
    path: String,
    terminal: String,
    custom_path: Option<String>,
) -> Result<(), AppError> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(AppError::Config(format!("Path does not exist: {path}")));
    }

    let (cmd, args) = terminal_command(&terminal, &path, custom_path.as_deref())?;

    Command::new(&cmd)
        .args(&args)
        .env("PATH", augmented_path())
        .spawn()
        .map_err(|e| AppError::Config(format!("Failed to open terminal ({cmd}): {e}")))?;

    Ok(())
}

use std::path::Path;

/// Check if a directory is a git repository (has .git dir or .git file).
#[tauri::command]
pub fn validate_git_repo(path: String) -> Result<bool, String> {
    let p = Path::new(&path);
    if !p.is_dir() {
        return Ok(false);
    }
    let git_path = p.join(".git");
    // .git can be a directory (normal repo) or a file (worktree)
    Ok(git_path.exists())
}

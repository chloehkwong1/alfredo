use std::io::Write;
use std::path::{Path, PathBuf};
use tokio::fs;

use crate::types::AppError;

type Result<T> = std::result::Result<T, AppError>;

const NOTES_REL_PATH: &str = ".alfredo/notes.md";
const GITIGNORE_LINE: &str = ".alfredo/notes.md";

fn notes_path(worktree_path: &str) -> PathBuf {
    Path::new(worktree_path).join(NOTES_REL_PATH)
}

/// Read the notes file for a worktree. Returns "" if the file does not exist.
#[tauri::command]
pub async fn read_worktree_notes(worktree_path: String) -> Result<String> {
    let path = notes_path(&worktree_path);
    match fs::read_to_string(&path).await {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.into()),
    }
}

/// Write the notes file for a worktree. Creates `.alfredo/` if needed,
/// writes atomically (tmp + rename), and ensures `.gitignore` covers the file.
#[tauri::command]
pub async fn write_worktree_notes(worktree_path: String, content: String) -> Result<()> {
    let path = notes_path(&worktree_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    atomic_write(&path, content.as_bytes()).await?;
    ensure_gitignore(Path::new(&worktree_path)).await?;
    Ok(())
}

async fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("md.tmp");
    fs::write(&tmp, bytes).await?;
    fs::rename(&tmp, path).await?;
    Ok(())
}

/// Append `.alfredo/notes.md` to the worktree's root `.gitignore` if no
/// matching pattern is already present. Idempotent.
async fn ensure_gitignore(worktree_root: &Path) -> std::io::Result<()> {
    let gitignore = worktree_root.join(".gitignore");
    let existing = match fs::read_to_string(&gitignore).await {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e),
    };
    if gitignore_covers(&existing, GITIGNORE_LINE) {
        return Ok(());
    }
    let mut new_contents = existing.clone();
    if !new_contents.is_empty() && !new_contents.ends_with('\n') {
        new_contents.push('\n');
    }
    new_contents.push_str(GITIGNORE_LINE);
    new_contents.push('\n');
    let tmp = gitignore.with_file_name(".gitignore.tmp");
    let mut f = std::fs::File::create(&tmp)?;
    f.write_all(new_contents.as_bytes())?;
    f.sync_all()?;
    std::fs::rename(&tmp, &gitignore)?;
    Ok(())
}

/// True if `gitignore_text` already contains a line that matches `pattern`.
/// Matching is exact-line, ignoring leading/trailing whitespace and inline
/// `#` comments. Negation lines (`!foo`) do not count as coverage.
fn gitignore_covers(gitignore_text: &str, pattern: &str) -> bool {
    for raw in gitignore_text.lines() {
        let line = raw.split('#').next().unwrap_or("").trim();
        if line.is_empty() || line.starts_with('!') {
            continue;
        }
        if line == pattern {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn read_returns_empty_when_missing() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        let got = read_worktree_notes(path).await.unwrap();
        assert_eq!(got, "");
    }

    #[tokio::test]
    async fn write_creates_alfredo_dir_and_persists() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        write_worktree_notes(path.clone(), "hello".into()).await.unwrap();
        let got = read_worktree_notes(path).await.unwrap();
        assert_eq!(got, "hello");
        assert!(dir.path().join(".alfredo/notes.md").exists());
    }

    #[tokio::test]
    async fn write_appends_gitignore_when_missing() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        write_worktree_notes(path, "x".into()).await.unwrap();
        let gi = std::fs::read_to_string(dir.path().join(".gitignore")).unwrap();
        assert!(gi.lines().any(|l| l.trim() == ".alfredo/notes.md"));
    }

    #[tokio::test]
    async fn write_does_not_duplicate_gitignore_line() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join(".gitignore"), "node_modules\n.alfredo/notes.md\n").unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        write_worktree_notes(path, "x".into()).await.unwrap();
        let gi = std::fs::read_to_string(dir.path().join(".gitignore")).unwrap();
        let count = gi.lines().filter(|l| l.trim() == ".alfredo/notes.md").count();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn write_preserves_existing_gitignore_contents() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join(".gitignore"), "node_modules\ndist\n").unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        write_worktree_notes(path, "x".into()).await.unwrap();
        let gi = std::fs::read_to_string(dir.path().join(".gitignore")).unwrap();
        assert!(gi.contains("node_modules"));
        assert!(gi.contains("dist"));
        assert!(gi.lines().any(|l| l.trim() == ".alfredo/notes.md"));
    }

    #[tokio::test]
    async fn write_handles_gitignore_without_trailing_newline() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join(".gitignore"), "node_modules").unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        write_worktree_notes(path, "x".into()).await.unwrap();
        let gi = std::fs::read_to_string(dir.path().join(".gitignore")).unwrap();
        assert!(gi.contains("node_modules\n"));
        assert!(gi.lines().any(|l| l.trim() == ".alfredo/notes.md"));
    }

    #[test]
    fn gitignore_covers_ignores_comments_and_negations() {
        assert!(gitignore_covers("foo\n.alfredo/notes.md\nbar\n", ".alfredo/notes.md"));
        assert!(gitignore_covers(".alfredo/notes.md # personal\n", ".alfredo/notes.md"));
        assert!(!gitignore_covers("!.alfredo/notes.md\n", ".alfredo/notes.md"));
        assert!(!gitignore_covers("alfredo/notes.md\n", ".alfredo/notes.md"));
        assert!(!gitignore_covers("", ".alfredo/notes.md"));
    }
}

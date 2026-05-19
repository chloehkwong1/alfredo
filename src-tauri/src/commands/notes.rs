use std::io::Write;
use std::path::{Path, PathBuf};
use tokio::fs;

use crate::types::AppError;

type Result<T> = std::result::Result<T, AppError>;

const NOTES_REL_PATH: &str = ".alfredo/notes.md";
const EXCLUDE_PATTERN: &str = ".alfredo/notes.md";

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
/// writes atomically (tmp + rename), and ensures the notes file is ignored
/// via the worktree's local `.git/info/exclude` (never tracked or shared).
#[tauri::command]
pub async fn write_worktree_notes(worktree_path: String, content: String) -> Result<()> {
    let path = notes_path(&worktree_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    atomic_write(&path, content.as_bytes()).await?;
    ensure_notes_excluded(Path::new(&worktree_path))?;
    Ok(())
}

async fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("md.tmp");
    fs::write(&tmp, bytes).await?;
    fs::rename(&tmp, path).await?;
    Ok(())
}

/// Resolve the worktree's local exclude file (`<commondir>/info/exclude`).
/// Returns `None` when the path isn't a git repo. For linked worktrees the
/// common dir is shared, so a single entry covers every worktree of the repo.
fn local_exclude_path(worktree_root: &Path) -> Option<PathBuf> {
    let repo = git2::Repository::open(worktree_root).ok()?;
    Some(repo.commondir().join("info").join("exclude"))
}

/// Add `.alfredo/notes.md` to the worktree's local `.git/info/exclude` if not
/// already covered. This keeps the notes file out of `git status` without
/// touching the project's tracked `.gitignore` — it is never committed and
/// never shared with other clones. Idempotent; a no-op outside a git repo.
fn ensure_notes_excluded(worktree_root: &Path) -> std::io::Result<()> {
    let exclude = match local_exclude_path(worktree_root) {
        Some(p) => p,
        None => return Ok(()),
    };
    if let Some(parent) = exclude.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let existing = match std::fs::read_to_string(&exclude) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e),
    };
    if gitignore_covers(&existing, EXCLUDE_PATTERN) {
        return Ok(());
    }
    let mut new_contents = existing.clone();
    if !new_contents.is_empty() && !new_contents.ends_with('\n') {
        new_contents.push('\n');
    }
    new_contents.push_str(EXCLUDE_PATTERN);
    new_contents.push('\n');
    let tmp = exclude.with_file_name("exclude.tmp");
    let mut f = std::fs::File::create(&tmp)?;
    f.write_all(new_contents.as_bytes())?;
    f.sync_all()?;
    std::fs::rename(&tmp, &exclude)?;
    Ok(())
}

/// True if `ignore_text` already contains a line that matches `pattern`.
/// Matching is exact-line, ignoring leading/trailing whitespace and inline
/// `#` comments. Negation lines (`!foo`) do not count as coverage. Used for
/// both `.gitignore` and `.git/info/exclude` (same syntax).
fn gitignore_covers(ignore_text: &str, pattern: &str) -> bool {
    for raw in ignore_text.lines() {
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

    /// `git init` a temp dir and return (TempDir, path-to-info/exclude).
    fn init_repo() -> (TempDir, PathBuf) {
        let dir = TempDir::new().unwrap();
        git2::Repository::init(dir.path()).unwrap();
        let exclude = dir.path().join(".git").join("info").join("exclude");
        (dir, exclude)
    }

    #[tokio::test]
    async fn write_adds_exclude_when_in_git_repo() {
        let (dir, exclude) = init_repo();
        let path = dir.path().to_string_lossy().into_owned();
        write_worktree_notes(path, "x".into()).await.unwrap();
        let ex = std::fs::read_to_string(&exclude).unwrap();
        assert!(ex.lines().any(|l| l.trim() == ".alfredo/notes.md"));
    }

    #[tokio::test]
    async fn write_skips_exclude_outside_git_repo() {
        // Bare temp dir is not a git repo — the exclude step is a no-op, but
        // the notes file must still be written.
        let dir = TempDir::new().unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        write_worktree_notes(path.clone(), "x".into()).await.unwrap();
        assert_eq!(read_worktree_notes(path).await.unwrap(), "x");
        assert!(!dir.path().join(".git/info/exclude").exists());
    }

    #[tokio::test]
    async fn write_does_not_duplicate_exclude_line() {
        let (dir, exclude) = init_repo();
        std::fs::write(&exclude, "node_modules\n.alfredo/notes.md\n").unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        write_worktree_notes(path, "x".into()).await.unwrap();
        let ex = std::fs::read_to_string(&exclude).unwrap();
        let count = ex.lines().filter(|l| l.trim() == ".alfredo/notes.md").count();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn write_preserves_existing_exclude_contents() {
        let (dir, exclude) = init_repo();
        std::fs::write(&exclude, "node_modules\ndist\n").unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        write_worktree_notes(path, "x".into()).await.unwrap();
        let ex = std::fs::read_to_string(&exclude).unwrap();
        assert!(ex.contains("node_modules"));
        assert!(ex.contains("dist"));
        assert!(ex.lines().any(|l| l.trim() == ".alfredo/notes.md"));
    }

    #[tokio::test]
    async fn write_handles_exclude_without_trailing_newline() {
        let (dir, exclude) = init_repo();
        std::fs::write(&exclude, "node_modules").unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        write_worktree_notes(path, "x".into()).await.unwrap();
        let ex = std::fs::read_to_string(&exclude).unwrap();
        assert!(ex.contains("node_modules\n"));
        assert!(ex.lines().any(|l| l.trim() == ".alfredo/notes.md"));
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

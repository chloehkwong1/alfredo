//! Crash-safe JSON writers.
//!
//! Why this module exists: a plain `fs::write` truncates the destination
//! before re-filling it. If the process is killed (or the machine power-cut)
//! between the truncate and the final byte, the user's config file is left
//! zero-byte or partial, and the next startup silently loses repo entries,
//! per-repo overrides, or migrated keychain tokens.
//!
//! The fix is the classic "write-to-tmp + rename" pattern, but **rename
//! alone is not enough**. POSIX `rename` is atomic at the directory-entry
//! level — after the syscall returns, the dirent points at either the old
//! inode or the new one, never neither. But the new file's *data blocks*
//! and the new *dirent itself* may both still be sitting in the OS page
//! cache. A crash in that window can leave a freshly-renamed dirent
//! pointing at an empty inode. Two `fsync` calls close the window:
//!
//! 1. `fsync` on the temp file before rename — guarantees the contents
//!    are durable on disk.
//! 2. `fsync` on the parent directory after rename — guarantees the
//!    new dirent itself is durable. This step is the one most "atomic
//!    write" snippets miss; on APFS (macOS) and ext4 with `data=ordered`
//!    (Linux) it is required for crash safety.

use std::io;
use std::path::Path;

/// Asynchronously write `contents` to `path` crash-safely.
///
/// Sequence: write `<path>.tmp` → fsync tmp file → rename → fsync parent dir.
/// Both fsyncs are load-bearing; rename alone is not enough on APFS/ext4
/// (see module-level docs). On any failure, the stale `.tmp` is removed
/// on a best-effort basis.
pub async fn write_json_atomic(path: &Path, contents: &str) -> io::Result<()> {
    let tmp_path = tmp_path_for(path);

    // Run the full sequence inside a closure so we can clean up `.tmp` on any error.
    let result: io::Result<()> = async {
        // 1. Write contents to <path>.tmp.
        tokio::fs::write(&tmp_path, contents).await?;

        // 2. Re-open and fsync the tmp file so its data + metadata are durable.
        let file = tokio::fs::OpenOptions::new()
            .write(true)
            .open(&tmp_path)
            .await?;
        file.sync_all().await?;
        drop(file);

        // 3. Atomic dirent swap.
        tokio::fs::rename(&tmp_path, path).await?;

        // 4. fsync the parent directory so the new dirent is durable.
        //    Without this, a crash after rename can still leave the new
        //    dirent in cache and lose the swap (APFS / ext4 data=ordered).
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                let dir = tokio::fs::File::open(parent).await?;
                dir.sync_all().await?;
            }
        }
        Ok(())
    }
    .await;

    if result.is_err() {
        // Best-effort cleanup; ignore any error here so we surface the original.
        let _ = tokio::fs::remove_file(&tmp_path).await;
    }
    result
}

/// Synchronous equivalent of [`write_json_atomic`] for sync-only callers
/// (e.g. the keychain dev-secrets writer).
///
/// Same five-step sequence: tmp write → fsync tmp → rename → fsync parent dir
/// → cleanup tmp on error. The parent-dir fsync is unusual on macOS but
/// load-bearing for APFS dirent durability — without it a crash after
/// rename can still lose the swap.
pub fn write_json_atomic_sync(path: &Path, contents: &[u8]) -> io::Result<()> {
    let tmp_path = tmp_path_for(path);

    let result: io::Result<()> = (|| {
        // 1. Write contents to <path>.tmp.
        std::fs::write(&tmp_path, contents)?;

        // 2. Re-open and fsync the tmp file.
        let file = std::fs::OpenOptions::new().write(true).open(&tmp_path)?;
        file.sync_all()?;
        drop(file);

        // 3. Atomic dirent swap.
        std::fs::rename(&tmp_path, path)?;

        // 4. fsync the parent directory so the new dirent is durable.
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                let dir = std::fs::File::open(parent)?;
                dir.sync_all()?;
            }
        }
        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&tmp_path);
    }
    result
}

/// Compute the temp path: `foo.json` → `foo.json.tmp`.
fn tmp_path_for(path: &Path) -> std::path::PathBuf {
    let mut os = path.as_os_str().to_owned();
    os.push(".tmp");
    std::path::PathBuf::from(os)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn async_write_creates_file_with_contents() -> io::Result<()> {
        let dir = tempfile::TempDir::new()?;
        let path = dir.path().join("out.json");
        write_json_atomic(&path, "{\"a\":1}").await?;
        let got = tokio::fs::read_to_string(&path).await?;
        assert_eq!(got, "{\"a\":1}");
        Ok(())
    }

    #[tokio::test]
    async fn async_write_replaces_existing_file() -> io::Result<()> {
        let dir = tempfile::TempDir::new()?;
        let path = dir.path().join("out.json");
        tokio::fs::write(&path, "old contents").await?;
        write_json_atomic(&path, "new contents").await?;
        let got = tokio::fs::read_to_string(&path).await?;
        assert_eq!(got, "new contents");
        Ok(())
    }

    #[tokio::test]
    async fn async_write_leaves_no_tmp_on_success() -> io::Result<()> {
        let dir = tempfile::TempDir::new()?;
        let path = dir.path().join("out.json");
        write_json_atomic(&path, "hello").await?;
        let tmp = tmp_path_for(&path);
        assert!(!tmp.exists(), "expected {tmp:?} to be cleaned up");
        Ok(())
    }

    #[tokio::test]
    async fn async_write_round_trips_multiline_json() -> io::Result<()> {
        let dir = tempfile::TempDir::new()?;
        let path = dir.path().join("nested.json");
        let body = "{\n  \"k\": [1, 2, 3],\n  \"s\": \"hi\\nworld\"\n}\n";
        write_json_atomic(&path, body).await?;
        let got = tokio::fs::read_to_string(&path).await?;
        assert_eq!(got, body);
        Ok(())
    }

    #[test]
    fn sync_write_creates_file_with_contents() -> io::Result<()> {
        let dir = tempfile::TempDir::new()?;
        let path = dir.path().join("out.json");
        write_json_atomic_sync(&path, b"{\"a\":1}")?;
        let got = std::fs::read_to_string(&path)?;
        assert_eq!(got, "{\"a\":1}");
        Ok(())
    }

    #[test]
    fn sync_write_replaces_existing_file() -> io::Result<()> {
        let dir = tempfile::TempDir::new()?;
        let path = dir.path().join("out.json");
        std::fs::write(&path, b"old")?;
        write_json_atomic_sync(&path, b"new")?;
        let got = std::fs::read_to_string(&path)?;
        assert_eq!(got, "new");
        Ok(())
    }

    #[test]
    fn sync_write_leaves_no_tmp_on_success() -> io::Result<()> {
        let dir = tempfile::TempDir::new()?;
        let path = dir.path().join("out.json");
        write_json_atomic_sync(&path, b"hello")?;
        let tmp = tmp_path_for(&path);
        assert!(!tmp.exists(), "expected {tmp:?} to be cleaned up");
        Ok(())
    }
}

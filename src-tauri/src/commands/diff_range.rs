// Symbols are unused until Task 7 wires get_diff into the resolver; remove this allow then.
#![allow(dead_code)]

//! Resolves the (base, head) commit range for a worktree's diff.
//!
//! Most worktrees diff cleanly against `merge_base(base_branch, HEAD)`, but a
//! merged worktree (HEAD ancestor of base) collapses that range to nothing.
//! This module centralises the ancestor-detection + merge-commit-lookup logic
//! so `get_diff`, `get_commits`, and the badge stat path all agree.

use crate::types::AppError;
use git2::{Oid, Repository};

/// The resolved commit range for a worktree's diff/commits view.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DiffRange {
    /// The "base" side of the range — what HEAD is being compared against.
    pub base: Oid,
    /// The "head" side of the range — the tip of the work being shown.
    pub head: Oid,
}

/// Resolve the diff range for a worktree.
///
/// `base_oid` is the resolved default branch tip (origin/main or equivalent).
/// `head_oid` is the worktree's current HEAD.
/// `merge_commit_sha` is `pr.mergeCommitSha` if known, else None.
pub fn resolve_diff_range(
    _repo: &Repository,
    base_oid: Oid,
    head_oid: Oid,
    _merge_commit_sha: Option<&str>,
) -> Result<DiffRange, AppError> {
    Ok(DiffRange { base: base_oid, head: head_oid })
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::Repository;
    use tempfile::TempDir;

    fn init_repo() -> (TempDir, Repository) {
        let dir = tempfile::tempdir().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Test").unwrap();
        cfg.set_str("user.email", "t@t").unwrap();
        (dir, repo)
    }

    fn commit_file(repo: &Repository, name: &str, content: &str, msg: &str) -> Oid {
        let dir = repo.workdir().unwrap();
        std::fs::write(dir.join(name), content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(name)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = repo.signature().unwrap();
        let parents: Vec<git2::Commit> = repo.head().ok()
            .and_then(|h| h.peel_to_commit().ok())
            .map(|c| vec![c]).unwrap_or_default();
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &parent_refs).unwrap()
    }

    #[test]
    fn passes_through_when_head_is_ahead_of_base() {
        let (_dir, repo) = init_repo();
        let base = commit_file(&repo, "a", "1", "init");
        let head = commit_file(&repo, "a", "2", "feature work");

        let range = resolve_diff_range(&repo, base, head, None).unwrap();

        assert_eq!(range.base, base);
        assert_eq!(range.head, head);
    }
}

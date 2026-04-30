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

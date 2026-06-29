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
///
/// Returns the (base, head) pair to feed into a tree-to-tree diff or a
/// `revwalk.push(head).hide(base)` walk. `base` is **never** the raw default
/// branch tip in the non-ancestor arm — it's the merge-base, so callers don't
/// need to anchor it themselves. Caller-side merge-base resolution is what
/// regressed in `b56184f` (Changes panel showed upstream commits as deletions
/// after origin/main advanced past the fork point); centralising it here
/// keeps the three callers from drifting.
pub fn resolve_diff_range(
    repo: &Repository,
    base_oid: Oid,
    head_oid: Oid,
    merge_commit_sha: Option<&str>,
    main_oid: Option<Oid>,
) -> Result<DiffRange, AppError> {
    // HEAD has commits unique to itself — return (merge_base, head). A raw
    // base_oid here would make tree-to-tree diff misattribute upstream-only
    // commits as deletions in the branch.
    let head_is_ancestor = repo
        .graph_descendant_of(base_oid, head_oid)
        .map_err(|e| AppError::Git(format!("ancestor check failed: {e}")))?;
    if !head_is_ancestor {
        let mb = repo
            .merge_base(base_oid, head_oid)
            .map_err(|e| AppError::Git(format!("merge_base failed: {e}")))?;
        let base = clamp_to_main_fork(repo, mb, head_oid, main_oid)?;
        return Ok(DiffRange { base, head: head_oid });
    }

    // HEAD is contained in base. PR metadata wins when present: a rebase-merged
    // worktree's HEAD sits on base's first-parent trunk (the precheck below
    // would collapse it to empty), so we must consult merge_commit_sha first.
    if let Some(sha) = merge_commit_sha {
        if let Ok(oid) = Oid::from_str(sha) {
            if let Ok(commit) = repo.find_commit(oid) {
                if let Some(parent) = commit.parents().next() {
                    return Ok(DiffRange { base: parent.id(), head: oid });
                }
            }
        }
    }

    // No PR hint. If HEAD sits on base's first-parent trunk it has no commits
    // of its own — there is no merge commit to find, and any merge commit on
    // the trunk above HEAD belongs to an unrelated branch. Collapse to empty.
    if head_is_on_first_parent_ancestry(repo, base_oid, head_oid)? {
        return Ok(DiffRange { base: head_oid, head: head_oid });
    }

    // No usable hint — walk first-parent ancestry of base looking for the
    // merge commit whose second parent contains HEAD. This handles
    // manually-merged-then-dragged-to-Done cases where the PR metadata is
    // missing or stale.
    if let Some(found) = find_merge_commit_on_ancestry(repo, base_oid, head_oid)? {
        if let Ok(commit) = repo.find_commit(found) {
            if let Some(parent) = commit.parents().next() {
                return Ok(DiffRange { base: parent.id(), head: found });
            }
        }
    }

    // Branch is contained in base but no merge commit found (e.g. squash with
    // no PR metadata). Caller will see base==head and render an explicit
    // "branch fully contained in base" empty state.
    Ok(DiffRange { base: head_oid, head: head_oid })
}

/// Advance the diff base past default-branch drift for a stacked/sibling branch.
///
/// `mb` is `merge_base(base, head)`. When `head` is stacked on a *sibling* that
/// forked from the default branch at an older point than `head` did, `mb` reaches
/// back past where `head` itself forked from the default branch — so default-branch
/// commits between the two fork points get miscounted as `head`'s own work. When
/// the default-branch fork point (`merge_base(main, head)`) is strictly newer than
/// `mb` (a descendant of it), use that instead.
///
/// Returns `mb` unchanged (no clamp) when:
/// - `main_oid` is absent — non-stacked worktree, where the diff is already taken
///   against the default branch, so there's nothing to clamp;
/// - main shares no history with `head` (`merge_base` errors);
/// - the two fork points are equal or incomparable (e.g. merge commits in `head`'s
///   history), where "newer" is undefined;
/// - `head` is fully contained in the default branch, where clamping would
///   collapse the range to empty and erase the branch's work.
fn clamp_to_main_fork(
    repo: &Repository,
    mb: Oid,
    head: Oid,
    main_oid: Option<Oid>,
) -> Result<Oid, AppError> {
    let Some(main_oid) = main_oid else { return Ok(mb) };
    let mb_main = match repo.merge_base(main_oid, head) {
        Ok(m) => m,
        Err(_) => return Ok(mb),
    };
    // `mb_main == head` means HEAD is fully contained in the default branch
    // (already landed): clamping there would collapse the range to empty and
    // erase the branch's work, so decline and keep the stack-parent merge-base.
    // The `graph_descendant_of` check fails safe to the unclamped `mb` on error,
    // mirroring the `merge_base` arm above (corrupt-repo robustness).
    if mb_main != mb
        && mb_main != head
        && repo.graph_descendant_of(mb_main, mb).unwrap_or(false)
    {
        Ok(mb_main)
    } else {
        Ok(mb)
    }
}

/// True iff `head` is reachable from `base` by following first parents.
/// When this holds, HEAD has zero commits unique to itself — it sits on the
/// trunk leading up to base — so any merge commit between them belongs to an
/// unrelated branch, not to HEAD.
fn head_is_on_first_parent_ancestry(
    repo: &Repository,
    base: Oid,
    head: Oid,
) -> Result<bool, AppError> {
    let mut cursor = base;
    for _ in 0..2000 {
        if cursor == head {
            return Ok(true);
        }
        let commit = repo.find_commit(cursor)
            .map_err(|e| AppError::Git(format!("find commit failed: {e}")))?;
        let first_parent = match commit.parents().next() {
            Some(p) => p,
            None => return Ok(false),
        };
        // Once first-parent ancestry passes head's position, head isn't on the trunk.
        let head_still_reachable = first_parent.id() == head
            || repo.graph_descendant_of(first_parent.id(), head)
                .map_err(|e| AppError::Git(format!("ancestor check failed: {e}")))?;
        if !head_still_reachable {
            return Ok(false);
        }
        cursor = first_parent.id();
    }
    Ok(false)
}

/// Walk first-parent ancestry of `base` until the next commit's first parent
/// would skip past `head`. Among those commits, return the merge commit (≥2
/// parents) whose non-first parent has `head` as ancestor — that's the merge
/// of HEAD into base.
fn find_merge_commit_on_ancestry(
    repo: &Repository,
    base: Oid,
    head: Oid,
) -> Result<Option<Oid>, AppError> {
    let mut cursor = base;
    // Bound the walk — defensive cap for huge histories.
    for _ in 0..2000 {
        // HEAD itself is the branch tip, never the merge commit. Stop here.
        if cursor == head {
            return Ok(None);
        }
        let commit = repo.find_commit(cursor)
            .map_err(|e| AppError::Git(format!("find commit failed: {e}")))?;

        let first_parent = match commit.parents().next() {
            Some(p) => p,
            None => return Ok(None),
        };

        // If this commit is a merge AND its non-first parent contains HEAD
        // as ancestor, this is the merge commit we want.
        if commit.parent_count() >= 2 {
            for parent in commit.parents().skip(1) {
                let contains_head = parent.id() == head
                    || repo.graph_descendant_of(parent.id(), head)
                        .map_err(|e| AppError::Git(format!("ancestor check failed: {e}")))?;
                if contains_head {
                    return Ok(Some(commit.id()));
                }
            }
        }

        // If first-parent ancestry would skip past HEAD, stop.
        let first_parent_descendant_of_head = first_parent.id() == head
            || repo.graph_descendant_of(first_parent.id(), head)
                .map_err(|e| AppError::Git(format!("ancestor check failed: {e}")))?;
        if !first_parent_descendant_of_head {
            return Ok(None);
        }
        cursor = first_parent.id();
    }
    Ok(None)
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

    /// Commit on top of an explicit parent (or as a root when `parent` is None),
    /// without moving any ref. Only the commit graph matters for range
    /// resolution, so the unique `content` per call just keeps oids distinct.
    fn commit_on(repo: &Repository, parent: Option<Oid>, content: &str, msg: &str) -> Oid {
        let dir = repo.workdir().unwrap();
        std::fs::write(dir.join("f"), content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("f")).unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = repo.signature().unwrap();
        let parents: Vec<git2::Commit> =
            parent.map(|p| vec![repo.find_commit(p).unwrap()]).unwrap_or_default();
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
        repo.commit(None, &sig, &sig, msg, &tree, &parent_refs).unwrap()
    }

    #[test]
    fn returns_merge_base_when_head_is_ahead_of_base() {
        let (_dir, repo) = init_repo();
        let base = commit_file(&repo, "a", "1", "init");
        let head = commit_file(&repo, "a", "2", "feature work");

        let range = resolve_diff_range(&repo, base, head, None, None).unwrap();

        // base is itself the fork point here (head's parent), so merge_base == base.
        assert_eq!(range.base, base);
        assert_eq!(range.head, head);
    }

    #[test]
    fn returns_fork_point_when_origin_main_advanced_past_branch() {
        // Real-world scenario from ROS-2161: branch has 3 unique commits on top
        // of an older main; origin/main has since advanced with unrelated work.
        // Pre-fix the resolver returned (origin_main_tip, head) and the panel
        // misattributed upstream commits as deletions in the branch.
        let (_dir, repo) = init_repo();
        let fork = commit_file(&repo, "shared", "0", "fork point");

        // Branch: 3 unique commits off the fork.
        let branch_c1 = commit_file(&repo, "branch", "1", "branch commit 1");
        let _branch_c2 = commit_file(&repo, "branch", "2", "branch commit 2");
        let head = commit_file(&repo, "branch", "3", "branch commit 3");

        // Reset HEAD back to fork to lay down unrelated upstream commits.
        let sig = repo.signature().unwrap();
        let fork_commit = repo.find_commit(fork).unwrap();
        repo.reset(fork_commit.as_object(), git2::ResetType::Hard, None).unwrap();

        // Origin/main: 7 unrelated commits past the fork.
        let mut upstream_tip = fork;
        for i in 0..7 {
            let path = format!("upstream-{i}");
            std::fs::write(repo.workdir().unwrap().join(&path), format!("u{i}")).unwrap();
            let mut idx = repo.index().unwrap();
            idx.add_path(std::path::Path::new(&path)).unwrap();
            idx.write().unwrap();
            let tree = repo.find_tree(idx.write_tree().unwrap()).unwrap();
            let parent = repo.find_commit(upstream_tip).unwrap();
            upstream_tip = repo
                .commit(Some("HEAD"), &sig, &sig, &format!("upstream {i}"), &tree, &[&parent])
                .unwrap();
        }

        let range = resolve_diff_range(&repo, upstream_tip, head, None, None).unwrap();

        assert_eq!(range.base, fork, "base must be the fork point, not origin/main tip");
        assert_eq!(range.head, head);
        assert_ne!(range.base, upstream_tip, "raw base tip would regress b56184f");
        // Sanity-check we actually constructed a non-ancestor scenario.
        assert!(!repo.graph_descendant_of(upstream_tip, head).unwrap());
        // And that the unique-to-head set is exactly the 3 branch commits.
        let mut walk = repo.revwalk().unwrap();
        walk.push(head).unwrap();
        walk.hide(range.base).unwrap();
        let unique: Vec<_> = walk.map(|o| o.unwrap()).collect();
        assert_eq!(unique.len(), 3, "branch should have exactly 3 unique commits");
        assert!(unique.contains(&branch_c1));
    }

    #[test]
    fn uses_merge_commit_sha_when_head_is_ancestor() {
        let (_dir, repo) = init_repo();
        // Set up: branch_tip is a feature branch; main fast-forward-merges it,
        // then advances. HEAD (branch_tip) becomes ancestor of main.
        let fork = commit_file(&repo, "a", "0", "fork point");
        let branch_tip = commit_file(&repo, "a", "1", "feature");
        // Simulate a merge commit: parents = [fork, branch_tip]
        let sig = repo.signature().unwrap();
        let merge_tree = repo.find_commit(branch_tip).unwrap().tree().unwrap();
        let merge_commit = repo.commit(
            None, &sig, &sig, "Merge PR",
            &merge_tree,
            &[
                &repo.find_commit(fork).unwrap(),
                &repo.find_commit(branch_tip).unwrap(),
            ],
        ).unwrap();
        // Advance "main" past the merge commit
        let post_merge_tree = repo.find_commit(merge_commit).unwrap().tree().unwrap();
        let main_tip = repo.commit(
            None, &sig, &sig, "after merge",
            &post_merge_tree,
            &[&repo.find_commit(merge_commit).unwrap()],
        ).unwrap();

        // base_oid = main_tip; head_oid = branch_tip (ancestor of main_tip).
        let range = resolve_diff_range(
            &repo, main_tip, branch_tip,
            Some(&merge_commit.to_string()), None,
        ).unwrap();

        // Want: base = merge_commit^1 (the fork point on main), head = merge_commit (or branch_tip).
        assert_eq!(range.base, fork, "base should be merge_commit^1");
        assert_eq!(range.head, merge_commit, "head should be the merge commit");
    }

    #[test]
    fn finds_merge_commit_via_ancestry_path_when_no_pr_hint() {
        let (_dir, repo) = init_repo();
        let fork = commit_file(&repo, "a", "0", "fork point");
        let branch_tip = commit_file(&repo, "a", "1", "feature");
        let sig = repo.signature().unwrap();
        let merge_tree = repo.find_commit(branch_tip).unwrap().tree().unwrap();
        let merge_commit = repo.commit(
            None, &sig, &sig, "Merge PR",
            &merge_tree,
            &[
                &repo.find_commit(fork).unwrap(),
                &repo.find_commit(branch_tip).unwrap(),
            ],
        ).unwrap();
        let post_merge_tree = repo.find_commit(merge_commit).unwrap().tree().unwrap();
        let main_tip = repo.commit(
            None, &sig, &sig, "after merge",
            &post_merge_tree,
            &[&repo.find_commit(merge_commit).unwrap()],
        ).unwrap();

        // No merge_commit_sha provided — must discover via ancestry-path walk.
        let range = resolve_diff_range(&repo, main_tip, branch_tip, None, None).unwrap();

        assert_eq!(range.base, fork);
        assert_eq!(range.head, merge_commit);
    }

    #[test]
    fn returns_empty_range_when_head_contained_but_no_merge_commit_found() {
        let (_dir, repo) = init_repo();
        let _fork = commit_file(&repo, "a", "0", "fork point");
        let head = commit_file(&repo, "a", "1", "feature");
        // Advance "main" linearly *past* head (e.g. squash merge with branch deleted
        // and metadata gone). No merge commit on the ancestry path.
        let sig = repo.signature().unwrap();
        let post_tree = repo.find_commit(head).unwrap().tree().unwrap();
        let main_tip = repo.commit(
            None, &sig, &sig, "linear advance",
            &post_tree,
            &[&repo.find_commit(head).unwrap()],
        ).unwrap();

        let range = resolve_diff_range(&repo, main_tip, head, None, None).unwrap();

        // Caller sees base == head → renders empty state.
        assert_eq!(range.base, range.head);
        assert_eq!(range.base, head, "empty range should collapse to head, not base");
    }

    #[test]
    fn unrelated_merge_on_main_does_not_match_pure_behind_head() {
        // Pure-behind worktree: HEAD sits on main's first-parent ancestry with
        // zero commits unique to this branch. An unrelated PR has been merged
        // into main since HEAD. The resolver must NOT treat that unrelated
        // merge as if it merged HEAD's branch — it should collapse to empty.
        let (_dir, repo) = init_repo();
        let head = commit_file(&repo, "a", "0", "old main tip — also our HEAD");

        // Unrelated feature branch off `head`, then merged into main.
        let sig = repo.signature().unwrap();
        let unrelated_tree = repo.find_commit(head).unwrap().tree().unwrap();
        let unrelated_tip = repo
            .commit(
                None,
                &sig,
                &sig,
                "unrelated feature commit",
                &unrelated_tree,
                &[&repo.find_commit(head).unwrap()],
            )
            .unwrap();
        let merge_tree = repo.find_commit(unrelated_tip).unwrap().tree().unwrap();
        let merge_commit = repo
            .commit(
                None,
                &sig,
                &sig,
                "Merge unrelated PR",
                &merge_tree,
                &[
                    &repo.find_commit(head).unwrap(),
                    &repo.find_commit(unrelated_tip).unwrap(),
                ],
            )
            .unwrap();
        let post_merge_tree = repo.find_commit(merge_commit).unwrap().tree().unwrap();
        let main_tip = repo
            .commit(
                None,
                &sig,
                &sig,
                "after merge",
                &post_merge_tree,
                &[&repo.find_commit(merge_commit).unwrap()],
            )
            .unwrap();

        let range = resolve_diff_range(&repo, main_tip, head, None, None).unwrap();

        // HEAD has no commits of its own — the unrelated PR's merge must not
        // be misattributed to it. Range collapses to (head, head).
        assert_eq!(
            range.base, range.head,
            "pure-behind HEAD must collapse to empty; got base={} head={}",
            range.base, range.head,
        );
        assert_eq!(range.base, head, "empty range should anchor on head");
    }

    #[test]
    fn rebase_merged_head_on_trunk_uses_merge_commit_sha() {
        // Rebase-merge: the PR's commits get replayed onto main's first-parent
        // trunk, then the local branch's HEAD ends up pointing at one of those
        // replayed commits. HEAD is now on base's trunk — the precheck would
        // collapse to empty — but PR metadata names the merge SHA, so we must
        // consult it first and surface the merged work.
        let (_dir, repo) = init_repo();
        let fork = commit_file(&repo, "a", "0", "fork point");
        // Replayed PR commits become first-parent on main:
        let merged = commit_file(&repo, "a", "1", "feature commit (rebased onto main)");
        // Main advances past the merged commit:
        let sig = repo.signature().unwrap();
        let post_tree = repo.find_commit(merged).unwrap().tree().unwrap();
        let main_tip = repo
            .commit(
                None,
                &sig,
                &sig,
                "post-merge main commit",
                &post_tree,
                &[&repo.find_commit(merged).unwrap()],
            )
            .unwrap();

        // Worktree HEAD = the rebased commit on main's first-parent trunk.
        let range = resolve_diff_range(&repo, main_tip, merged, Some(&merged.to_string()), None).unwrap();

        assert_eq!(range.base, fork, "base should be merge_commit^1 (fork point)");
        assert_eq!(range.head, merged, "head should be the named merge commit");
    }

    #[test]
    fn clamps_to_main_fork_for_sibling_stacked_branch() {
        // PRO-5615 topology: base (stack parent) and head are siblings — both
        // forked from the default branch, but at *different* points. head forked
        // from a newer main commit than base did, so merge_base(base, head) is an
        // old common ancestor. Without clamping, every default-branch commit
        // between the two fork points gets counted as head's work.
        let (_dir, repo) = init_repo();
        let m0 = commit_on(&repo, None, "m0", "m0");
        let m1 = commit_on(&repo, Some(m0), "m1", "m1");
        let m2 = commit_on(&repo, Some(m1), "m2", "m2");
        let m3 = commit_on(&repo, Some(m2), "m3", "m3"); // default-branch tip

        // base (stack parent): forks off the old m0.
        let b1 = commit_on(&repo, Some(m0), "b1", "b1");
        let base = commit_on(&repo, Some(b1), "b2", "b2");

        // head (our branch): forks off the newer m2.
        let h1 = commit_on(&repo, Some(m2), "h1", "h1");
        let head = commit_on(&repo, Some(h1), "h2", "h2");

        // Sanity: the un-clamped merge-base is the old m0.
        assert_eq!(repo.merge_base(base, head).unwrap(), m0);

        let range = resolve_diff_range(&repo, base, head, None, Some(m3)).unwrap();

        assert_eq!(
            range.base, m2,
            "base must clamp to where head forked from main (m2), not the old merge-base m0",
        );
        assert_eq!(range.head, head);

        // Unique-to-head is exactly head's own two commits — no main drift.
        let mut walk = repo.revwalk().unwrap();
        walk.push(head).unwrap();
        walk.hide(range.base).unwrap();
        let unique: Vec<_> = walk.map(|o| o.unwrap()).collect();
        assert_eq!(unique.len(), 2, "only h1+h2 should be unique to head");
        assert!(unique.contains(&h1));
        assert!(!unique.contains(&m1), "main drift m1 must not be attributed to head");
        assert!(!unique.contains(&m2), "main drift m2 must not be attributed to head");
    }

    #[test]
    fn does_not_clamp_proper_stack_descended_from_base() {
        // A real stack: head descends from base, which descends from main. The
        // merge-base with base is already base's tip, so the clamp must be a
        // no-op — clamping to the main fork would wrongly drop base's commits.
        let (_dir, repo) = init_repo();
        let main_tip = commit_on(&repo, None, "m0", "m0");
        let b1 = commit_on(&repo, Some(main_tip), "b1", "b1");
        let base = commit_on(&repo, Some(b1), "b2", "b2");
        let head = commit_on(&repo, Some(base), "h1", "h1");

        let range = resolve_diff_range(&repo, base, head, None, Some(main_tip)).unwrap();

        assert_eq!(range.base, base, "proper stack must diff against base's tip");
        assert_eq!(range.head, head);
    }

    #[test]
    fn does_not_clamp_when_main_oid_absent() {
        // Same sibling topology, but no main oid supplied → behaviour is the
        // pre-clamp merge-base (proves the clamp is gated on main_oid).
        let (_dir, repo) = init_repo();
        let m0 = commit_on(&repo, None, "m0", "m0");
        let m1 = commit_on(&repo, Some(m0), "m1", "m1");
        let m2 = commit_on(&repo, Some(m1), "m2", "m2");
        let b1 = commit_on(&repo, Some(m0), "b1", "b1");
        let base = commit_on(&repo, Some(b1), "b2", "b2");
        let h1 = commit_on(&repo, Some(m2), "h1", "h1");
        let head = commit_on(&repo, Some(h1), "h2", "h2");

        let range = resolve_diff_range(&repo, base, head, None, None).unwrap();

        assert_eq!(range.base, m0, "without main_oid the base stays the raw merge-base");
        assert_eq!(range.head, head);
    }

    #[test]
    fn does_not_clamp_to_empty_when_head_already_merged_into_main() {
        // A stacked worktree whose branch has already landed on the default
        // branch (HEAD is fully contained in main), while its sibling stack
        // parent has not caught up. merge_base(main, head) == head, so clamping
        // would collapse the range to (head, head) and erase the branch's work
        // from the panel/badge. The clamp must decline and keep the stack-parent
        // merge-base so the user still sees HEAD's commits.
        let (_dir, repo) = init_repo();
        let m0 = commit_on(&repo, None, "m0", "m0");

        // head's own work off m0.
        let h1 = commit_on(&repo, Some(m0), "h1", "h1");
        let head = commit_on(&repo, Some(h1), "h2", "h2");

        // main advances past head (head is now an ancestor of main_tip).
        let main_tip = commit_on(&repo, Some(head), "m-after", "main past head");

        // stack parent: a sibling off m0 that has not absorbed head.
        let base = commit_on(&repo, Some(m0), "b1", "b1");

        // Sanity: head is contained in main, so its main fork point is head itself.
        assert_eq!(repo.merge_base(main_tip, head).unwrap(), head);

        let range = resolve_diff_range(&repo, base, head, None, Some(main_tip)).unwrap();

        assert_ne!(range.base, range.head, "clamp must not collapse a real range to empty");
        assert_eq!(range.base, m0, "should keep the stack-parent merge-base, not clamp to head");
        assert_eq!(range.head, head);
    }

    #[test]
    fn does_not_clamp_when_main_shares_no_history_with_head() {
        // main_oid points at a disconnected root (no merge-base with head). The
        // clamp must fail safe to the original merge-base, not error.
        let (_dir, repo) = init_repo();
        let unrelated_main = commit_on(&repo, None, "main-root", "unrelated main");
        let shared = commit_on(&repo, None, "shared-root", "shared root");
        let base = commit_on(&repo, Some(shared), "b1", "b1");
        let head = commit_on(&repo, Some(shared), "h1", "h1");

        let range = resolve_diff_range(&repo, base, head, None, Some(unrelated_main)).unwrap();

        assert_eq!(range.base, shared, "no shared history with main → keep merge-base");
        assert_eq!(range.head, head);
    }
}

# Smart Sorting for Worktree Creation Pickers

## Problem

The Create Worktree dialog's three picker tabs (PRs, Branches, Linear Issues) return items in arbitrary order. This forces the user to scroll or search to find the most relevant item — typically their own recent work.

## Solution

Apply backend sorting to each tab so the most relevant items appear first. The sorting strategy is: **my stuff first, then by recency**.

## PRs Tab

### Sort order

1. **PRs assigned to me for review** (GH username appears in `requested_reviewers`)
2. **My non-draft PRs** (author matches authenticated GH username, case-insensitive)
3. **My draft PRs**
4. **Others' non-draft PRs**
5. **Others' draft PRs**

Within each group: sort by `updated_at` descending (most recently updated first).

### Changes

- `github_manager.rs`: When fetching PRs via octocrab, the response already includes `requested_reviewers` — extract reviewer logins and store them on `PrStatus`.
- Add `requested_reviewers: Vec<String>` to `PrStatus` in `types.rs`.
- `github_sync.rs` / `github_manager.rs`: The `sync_pr_status` command already calls `resolve_github_username()`. Pass the resolved username back alongside the PR list so the sort function can use it, or sort before returning.
- Add a sort function that partitions by review-assigned / ownership / draft status, then sorts each partition by `updated_at`.

## Branches Tab

### Sort order

1. **My branches** (last commit author matches local git `user.name`)
2. **Others' branches**

Within each group: sort by `last_commit_epoch` descending.

Filter out `main`/`master` from the list — these are never useful as worktree sources.

### Changes

- `branch_manager.rs`: Extract the commit author name when peeling to commit (already done for epoch — add `c.author().name()`). Add a new field to `Worktree` or use a local-only sort field.
- Read `user.name` from repo git config via `repo.config()?.get_string("user.name")`.
- Sort the worktree list before returning.
- Add `last_commit_author: Option<String>` to `Worktree` struct (or keep it internal to the sort — doesn't need to reach the frontend).

## Linear Issues Tab

### Sort order

1. **Assigned to me** (assignee name matches authenticated Linear viewer name)
2. **Others / unassigned**

Within each group: sort by `updatedAt` descending.

### Changes

**GraphQL query** (`linear_manager.rs`):
- Add `updatedAt` field to the `searchIssues` query.
- Add `updatedAt` field to the `issue` query (for consistency).

**Viewer query** (`linear_manager.rs`):
- Add a new `get_viewer(api_key)` function that queries `{ viewer { id name email } }`.
- Cache the viewer name in memory (it won't change during a session).

**Type changes** (`types.rs`):
- Add `updated_at: Option<String>` to `LinearTicket`.

**Sort function**:
- Compare `assignee` against cached viewer name (case-insensitive).
- Secondary sort by `updated_at` descending.

## Data Flow

```
PR Tab:
  syncPrStatus(repoPath)
    -> github_manager fetches PRs
    -> resolve_github_username() for "me" context
    -> sort: mine first, then recency
    -> return sorted list to frontend

Branches Tab:
  listBranches(repoPath)
    -> branch_manager lists branches via git2
    -> extract last_commit_author from commit object
    -> read user.name from git config for "me" context
    -> sort: mine first, then recency
    -> filter out main/master
    -> return sorted list to frontend

Linear Tab:
  searchLinearIssues(query)
    -> linear_manager searches via GraphQL (now includes updatedAt)
    -> get_viewer() for "me" context (cached)
    -> sort: assigned-to-me first, then recency
    -> return sorted list to frontend
```

## Non-goals

- No UI changes to the picker components (sorting is transparent).
- No user-configurable sort options — this is opinionated defaults.
- No changes to the New Branch tab (manual entry, nothing to sort).

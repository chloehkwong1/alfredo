# GitHub API PR Diff

## Problem

The Changes tab computes diffs locally using `git2` merge-base calculations. When the local `origin/<base_branch>` ref is stale (not recently fetched), the merge base is further back than GitHub's, inflating the file count and commit count beyond what the PR actually contains. For example, a PR with 5 commits / 14 files on GitHub showed 22 commits / 29 files in Alfredo.

## Solution

When a PR exists, fetch file diffs and commits from GitHub's API instead of computing locally. This guarantees the Changes tab matches what GitHub shows.

When no PR exists, keep the current local git diff behavior unchanged.

## Design

### Rust Backend: New GitHub Manager Methods

Two new methods on `GithubManager`:

**`get_pr_files(owner, repo, pr_number) -> Vec<DiffFile>`**
- Calls `GET /repos/{owner}/{repo}/pulls/{number}/files`
- Handles pagination (GitHub caps at 100 files per page)
- Parses GitHub's unified diff `patch` field into existing `DiffFile`/`DiffHunk`/`DiffLine` types
- Files where `patch` is absent (GitHub truncation) are returned with empty hunks and `truncated: true`

**`get_pr_commits(owner, repo, pr_number) -> Vec<CommitInfo>`**
- Calls `GET /repos/{owner}/{repo}/pulls/{number}/commits`
- Returns `Vec<CommitInfo>` matching the existing type

Both exposed as Tauri commands that resolve `owner`/`repo` from the repo path, following the same pattern as existing PR commands in `commands/pr_detail.rs`.

### Type Changes

Add `truncated: bool` field to `DiffFile` (Rust and TypeScript), defaulting to `false`. This signals the frontend that a file's patch was too large for GitHub to return.

### Patch Parser

A function in Rust that parses GitHub's unified diff format into `DiffHunk`/`DiffLine` types:
- Parse `@@ -old_start,old_count +new_start,new_count @@` headers
- Categorize lines by `+`/`-`/` ` prefix as addition/deletion/context
- Compute line numbers from hunk headers

Lives alongside the GitHub manager code since it's specific to GitHub's response format. The local diff parser in `diff.rs` uses `git2` callbacks — different input format, same output types, no shared parsing logic.

### Truncation Fallback

When GitHub truncates a file's patch:
1. `get_pr_files` returns the file with `truncated: true` and empty hunks
2. Frontend detects truncated files after receiving the response
3. Frontend calls existing `getDiff(repoPath, baseBranch)` locally for just those files
4. Replaces truncated entries with the full local versions

This keeps the fallback on the frontend, reusing existing local diff infrastructure.

### Frontend Integration

**`api.ts`** — Add two new invoke wrappers:
- `getPrFiles(repoPath: string, prNumber: number): Promise<DiffFile[]>`
- `getPrCommits(repoPath: string, prNumber: number): Promise<CommitInfo[]>`

**`useChangesData.ts`** — Branch on PR existence:
- PR exists: call `getPrFiles` + `getPrCommits` instead of `getDiff` + `getCommits`
- No PR: call existing `getDiff` + `getCommits` (unchanged)
- `getUncommittedDiff` always runs regardless (unchanged)
- After receiving PR files, check for truncated entries and fall back to local diff for those
- `displayFiles` merge logic unchanged: uncommitted files take precedence, then committed/PR files

**No changes to:** `ChangesView.tsx`, `FileSidebar.tsx`, `DiffFileCard.tsx`, or any other UI components. The data shape is identical.

## Decisions

- **On-demand fetch, no caching** — Same pattern as `get_pr_detail`. Single API call, minimal latency (<200ms typical). Avoids cache staleness complexity.
- **Uncommitted files always local** — GitHub doesn't know about unpushed local changes. These merge into the view alongside PR files (uncommitted takes precedence on path conflicts).
- **Commits from GitHub when PR exists** — Matches GitHub's commit count exactly, avoiding the inflated local count.

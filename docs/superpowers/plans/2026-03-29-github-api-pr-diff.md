# GitHub API PR Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace local git diff computation with GitHub API data when a PR exists, so the Changes tab matches GitHub exactly.

**Architecture:** Add two new methods to `GithubManager` that fetch PR files and commits from GitHub's REST API, parse the unified diff patches into existing `DiffFile` types, and expose them as Tauri commands. Frontend branches on PR existence to call either GitHub API or local git commands.

**Tech Stack:** Rust (octocrab, reqwest, serde), TypeScript/React

---

### Task 1: Add `truncated` field to DiffFile types

**Files:**
- Modify: `src-tauri/src/commands/diff.rs:12-18` (Rust DiffFile struct)
- Modify: `src/types.ts:176-182` (TypeScript DiffFile interface)

- [ ] **Step 1: Add `truncated` field to Rust DiffFile**

In `src-tauri/src/commands/diff.rs`, add a `truncated` field to the `DiffFile` struct:

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub additions: usize,
    pub deletions: usize,
    pub hunks: Vec<DiffHunk>,
    #[serde(default)]
    pub truncated: bool,
}
```

Update every place that constructs a `DiffFile` in `diff.rs` to include `truncated: false`. There is one constructor at line 139:

```rust
files.push(DiffFile {
    path: file_path,
    old_path: old_path_field,
    status: status.to_string(),
    additions: 0,
    deletions: 0,
    hunks: Vec::new(),
    truncated: false,
});
```

- [ ] **Step 2: Add `truncated` field to TypeScript DiffFile**

In `src/types.ts`, add the field:

```typescript
export interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  truncated?: boolean;
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && cargo clippy --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5`
Expected: No errors

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/diff.rs src/types.ts
git commit -m "feat: add truncated field to DiffFile for GitHub API fallback"
```

---

### Task 2: Add unified diff patch parser

**Files:**
- Create: `src-tauri/src/patch_parser.rs`
- Modify: `src-tauri/src/main.rs` or `src-tauri/src/lib.rs` (add `mod patch_parser;`)

This parser converts GitHub's unified diff `patch` strings into the existing `DiffHunk`/`DiffLine` types from `commands/diff.rs`.

- [ ] **Step 1: Create the patch parser module**

Create `src-tauri/src/patch_parser.rs`:

```rust
use crate::commands::diff::{DiffHunk, DiffLine};

/// Parse a GitHub unified diff patch string into a list of DiffHunks.
///
/// GitHub returns patches like:
/// ```
/// @@ -1,4 +1,5 @@
///  import { foo } from "bar";
/// +import { baz } from "qux";
///
///  const x = 1;
/// ```
pub fn parse_patch(patch: &str) -> Vec<DiffHunk> {
    let mut hunks: Vec<DiffHunk> = Vec::new();
    let mut current_hunk: Option<DiffHunk> = None;
    let mut old_line: u32 = 0;
    let mut new_line: u32 = 0;

    for raw_line in patch.lines() {
        if raw_line.starts_with("@@") {
            // Flush previous hunk
            if let Some(h) = current_hunk.take() {
                hunks.push(h);
            }

            // Parse: @@ -old_start,old_count +new_start,new_count @@
            let (old_start, new_start) = parse_hunk_header(raw_line);
            old_line = old_start;
            new_line = new_start;

            current_hunk = Some(DiffHunk {
                header: raw_line.to_string(),
                old_start,
                new_start,
                lines: Vec::new(),
            });
            continue;
        }

        let Some(ref mut hunk) = current_hunk else {
            continue;
        };

        if let Some(content) = raw_line.strip_prefix('+') {
            hunk.lines.push(DiffLine {
                line_type: "addition".to_string(),
                content: content.to_string(),
                old_line_number: None,
                new_line_number: Some(new_line),
            });
            new_line += 1;
        } else if let Some(content) = raw_line.strip_prefix('-') {
            hunk.lines.push(DiffLine {
                line_type: "deletion".to_string(),
                content: content.to_string(),
                old_line_number: Some(old_line),
                new_line_number: None,
            });
            old_line += 1;
        } else {
            // Context line — may or may not have a leading space
            let content = raw_line.strip_prefix(' ').unwrap_or(raw_line);
            hunk.lines.push(DiffLine {
                line_type: "context".to_string(),
                content: content.to_string(),
                old_line_number: Some(old_line),
                new_line_number: Some(new_line),
            });
            old_line += 1;
            new_line += 1;
        }
    }

    // Flush last hunk
    if let Some(h) = current_hunk {
        hunks.push(h);
    }

    hunks
}

/// Extract old_start and new_start from a hunk header like `@@ -10,5 +12,7 @@`.
fn parse_hunk_header(header: &str) -> (u32, u32) {
    // Strip the @@ markers and split
    let inner = header
        .trim_start_matches("@@")
        .trim_end_matches("@@")
        // There may be trailing context after the second @@
        .split("@@")
        .next()
        .unwrap_or("")
        .trim();

    let mut old_start: u32 = 1;
    let mut new_start: u32 = 1;

    for part in inner.split_whitespace() {
        if let Some(rest) = part.strip_prefix('-') {
            old_start = rest.split(',').next()
                .and_then(|s| s.parse().ok())
                .unwrap_or(1);
        } else if let Some(rest) = part.strip_prefix('+') {
            new_start = rest.split(',').next()
                .and_then(|s| s.parse().ok())
                .unwrap_or(1);
        }
    }

    (old_start, new_start)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_patch() {
        let patch = "@@ -1,3 +1,4 @@\n import { foo } from \"bar\";\n+import { baz } from \"qux\";\n \n const x = 1;";
        let hunks = parse_patch(patch);

        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].old_start, 1);
        assert_eq!(hunks[0].new_start, 1);
        assert_eq!(hunks[0].lines.len(), 4);
        assert_eq!(hunks[0].lines[0].line_type, "context");
        assert_eq!(hunks[0].lines[1].line_type, "addition");
        assert_eq!(hunks[0].lines[1].content, "import { baz } from \"qux\";");
        assert_eq!(hunks[0].lines[1].new_line_number, Some(2));
    }

    #[test]
    fn test_parse_multi_hunk_patch() {
        let patch = "@@ -1,2 +1,2 @@\n-old line\n+new line\n context\n@@ -10,2 +10,3 @@\n context\n+added\n context";
        let hunks = parse_patch(patch);

        assert_eq!(hunks.len(), 2);
        assert_eq!(hunks[0].old_start, 1);
        assert_eq!(hunks[1].old_start, 10);
        assert_eq!(hunks[1].lines.len(), 3);
    }

    #[test]
    fn test_parse_hunk_header_with_context() {
        // GitHub often includes function context after the second @@
        let (old, new) = parse_hunk_header("@@ -10,5 +12,7 @@ fn main() {");
        assert_eq!(old, 10);
        assert_eq!(new, 12);
    }

    #[test]
    fn test_empty_patch() {
        let hunks = parse_patch("");
        assert!(hunks.is_empty());
    }
}
```

- [ ] **Step 2: Register the module**

In `src-tauri/src/lib.rs`, add the module declaration alongside the existing ones:

```rust
mod patch_parser;
```

Find the existing `mod` block and add `mod patch_parser;` after the last entry.

- [ ] **Step 3: Make DiffHunk and DiffLine types public across modules**

The `DiffHunk` and `DiffLine` types are currently defined inside `commands/diff.rs`. The patch parser needs to use them. Verify that `commands/diff.rs` already uses `pub` on these structs (it does — lines 21 and 30). Verify the `commands` module re-exports them or that `crate::commands::diff::DiffHunk` is accessible.

Check if `src-tauri/src/commands/mod.rs` exists and has `pub mod diff;`. If so, no changes needed. If `commands` is declared differently, adjust the import path in `patch_parser.rs` accordingly.

- [ ] **Step 4: Run the tests**

Run: `cd /Users/chloe/dev/alfredo/src-tauri && cargo test patch_parser 2>&1`
Expected: 4 tests pass

- [ ] **Step 5: Run clippy**

Run: `cd /Users/chloe/dev/alfredo && cargo clippy --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/patch_parser.rs src-tauri/src/lib.rs
git commit -m "feat: add unified diff patch parser for GitHub API responses"
```

---

### Task 3: Add `get_pr_files` and `get_pr_commits` to GithubManager

**Files:**
- Modify: `src-tauri/src/github_manager.rs`

- [ ] **Step 1: Add `get_pr_files` method**

Add this method to the `impl GithubManager` block in `src-tauri/src/github_manager.rs`. Place it after the existing `get_pr_detail` method. This uses reqwest directly (same pattern as `download_workflow_log` at line 483) because octocrab's PR files endpoint doesn't return the raw patch data we need.

```rust
    /// Fetch the list of files changed in a PR, with parsed diff hunks.
    /// Uses the GitHub REST API: GET /repos/{owner}/{repo}/pulls/{number}/files
    pub async fn get_pr_files(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<Vec<crate::commands::diff::DiffFile>, AppError> {
        let mut all_files = Vec::new();
        let mut page: u32 = 1;
        let client = reqwest::Client::new();

        loop {
            let url = format!(
                "https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/files?per_page=100&page={page}"
            );

            let response = client
                .get(&url)
                .header("Authorization", format!("Bearer {}", self.token()))
                .header("User-Agent", "alfredo")
                .header("Accept", "application/vnd.github+json")
                .send()
                .await
                .map_err(|e| AppError::Github(format!("failed to fetch PR files: {e}")))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(AppError::Github(format!(
                    "GitHub PR files API returned {status}: {body}"
                )));
            }

            let files: Vec<GithubPrFile> = response
                .json()
                .await
                .map_err(|e| AppError::Github(format!("failed to parse PR files response: {e}")))?;

            let count = files.len();

            for file in files {
                let status = match file.status.as_str() {
                    "added" => "added",
                    "removed" => "deleted",
                    "renamed" => "renamed",
                    _ => "modified",
                };

                let (hunks, truncated) = if let Some(ref patch) = file.patch {
                    (crate::patch_parser::parse_patch(patch), false)
                } else {
                    (Vec::new(), true)
                };

                let additions = file.additions;
                let deletions = file.deletions;

                all_files.push(crate::commands::diff::DiffFile {
                    path: file.filename,
                    old_path: file.previous_filename,
                    status: status.to_string(),
                    additions,
                    deletions,
                    hunks,
                    truncated,
                });
            }

            if count < 100 {
                break;
            }
            page += 1;
        }

        Ok(all_files)
    }

    /// Fetch commits for a PR from the GitHub API.
    /// Uses: GET /repos/{owner}/{repo}/pulls/{number}/commits
    pub async fn get_pr_commits(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<Vec<crate::commands::diff::CommitInfo>, AppError> {
        let mut all_commits = Vec::new();
        let mut page: u32 = 1;
        let client = reqwest::Client::new();

        loop {
            let url = format!(
                "https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/commits?per_page=100&page={page}"
            );

            let response = client
                .get(&url)
                .header("Authorization", format!("Bearer {}", self.token()))
                .header("User-Agent", "alfredo")
                .header("Accept", "application/vnd.github+json")
                .send()
                .await
                .map_err(|e| AppError::Github(format!("failed to fetch PR commits: {e}")))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(AppError::Github(format!(
                    "GitHub PR commits API returned {status}: {body}"
                )));
            }

            let commits: Vec<GithubPrCommit> = response
                .json()
                .await
                .map_err(|e| AppError::Github(format!("failed to parse PR commits response: {e}")))?;

            let count = commits.len();

            for commit in commits {
                let hash = commit.sha.clone();
                let short_hash = hash[..7.min(hash.len())].to_string();
                all_commits.push(crate::commands::diff::CommitInfo {
                    hash,
                    short_hash,
                    message: commit.commit.message,
                    author: commit.commit.author.name,
                    timestamp: parse_github_timestamp(&commit.commit.author.date),
                });
            }

            if count < 100 {
                break;
            }
            page += 1;
        }

        Ok(all_commits)
    }
```

- [ ] **Step 2: Add serde structs for GitHub API responses**

Add these structs at the top of `github_manager.rs` (after the imports, before `GithubManager`). These are private — only used for deserialization.

```rust
#[derive(serde::Deserialize)]
struct GithubPrFile {
    filename: String,
    status: String,
    additions: usize,
    deletions: usize,
    patch: Option<String>,
    previous_filename: Option<String>,
}

#[derive(serde::Deserialize)]
struct GithubPrCommit {
    sha: String,
    commit: GithubCommitDetail,
}

#[derive(serde::Deserialize)]
struct GithubCommitDetail {
    message: String,
    author: GithubCommitAuthor,
}

#[derive(serde::Deserialize)]
struct GithubCommitAuthor {
    name: String,
    date: String,
}

/// Parse a GitHub ISO 8601 timestamp (e.g. "2026-03-29T10:30:00Z") into epoch seconds.
fn parse_github_timestamp(date: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(date)
        .map(|dt| dt.timestamp())
        .unwrap_or(0)
}
```

- [ ] **Step 3: Add `chrono` dependency if needed**

Check `src-tauri/Cargo.toml` for `chrono`. If it's not present, add it:

```bash
cd /Users/chloe/dev/alfredo/src-tauri && cargo add chrono --features serde
```

If `chrono` is already a dependency, skip this step.

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && cargo clippy --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/github_manager.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: add get_pr_files and get_pr_commits to GithubManager"
```

---

### Task 4: Add Tauri commands for PR files and commits

**Files:**
- Modify: `src-tauri/src/commands/pr_detail.rs`
- Modify: `src-tauri/src/lib.rs` (command registration)

- [ ] **Step 1: Add commands to pr_detail.rs**

Add these two commands to `src-tauri/src/commands/pr_detail.rs`, after the existing `get_pr_detail` command:

```rust
/// Fetch PR file diffs from GitHub API.
#[tauri::command]
pub async fn get_pr_files(
    repo_path: String,
    pr_number: u64,
) -> Result<Vec<crate::commands::diff::DiffFile>> {
    let (manager, owner, repo) = github_manager::github_context(&repo_path).await?;
    manager.get_pr_files(&owner, &repo, pr_number).await
}

/// Fetch PR commits from GitHub API.
#[tauri::command]
pub async fn get_pr_commits(
    repo_path: String,
    pr_number: u64,
) -> Result<Vec<crate::commands::diff::CommitInfo>> {
    let (manager, owner, repo) = github_manager::github_context(&repo_path).await?;
    manager.get_pr_commits(&owner, &repo, pr_number).await
}
```

- [ ] **Step 2: Register commands in lib.rs**

In `src-tauri/src/lib.rs`, find the `pr_detail::get_pr_detail` line in the `.invoke_handler(tauri::generate_handler![...])` block and add the two new commands after it:

```rust
            pr_detail::get_pr_detail,
            pr_detail::get_pr_files,
            pr_detail::get_pr_commits,
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && cargo clippy --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/pr_detail.rs src-tauri/src/lib.rs
git commit -m "feat: expose get_pr_files and get_pr_commits as Tauri commands"
```

---

### Task 5: Add frontend API wrappers and update useChangesData

**Files:**
- Modify: `src/api.ts`
- Modify: `src/hooks/useChangesData.ts`

- [ ] **Step 1: Add API wrappers in api.ts**

Add these two functions in the `// ── Diff` section of `src/api.ts`, after the existing `getDiffForCommit`:

```typescript
export function getPrFiles(
  repoPath: string,
  prNumber: number,
): Promise<DiffFile[]> {
  return invoke("get_pr_files", { repoPath, prNumber });
}

export function getPrCommits(
  repoPath: string,
  prNumber: number,
): Promise<CommitInfo[]> {
  return invoke("get_pr_commits", { repoPath, prNumber });
}
```

- [ ] **Step 2: Update useChangesData to branch on PR existence**

Replace the contents of `src/hooks/useChangesData.ts` with:

```typescript
import { useEffect, useMemo, useState } from "react";
import { getDiff, getUncommittedDiff, getCommits, getDiffForCommit, getPrFiles, getPrCommits } from "../api";
import type { DiffFile, CommitInfo } from "../types";
import type { ViewMode } from "../components/changes/FileSidebar";

interface UseChangesDataReturn {
  uncommittedFiles: DiffFile[];
  committedFiles: DiffFile[];
  commits: CommitInfo[];
  commitFiles: DiffFile[];
  displayFiles: DiffFile[];
}

export function useChangesData(
  repoPath: string,
  viewMode: ViewMode,
  selectedCommitIndex: number | null,
  baseBranch?: string,
  prNumber?: number,
): UseChangesDataReturn {
  const [uncommittedFiles, setUncommittedFiles] = useState<DiffFile[]>([]);
  const [committedFiles, setCommittedFiles] = useState<DiffFile[]>([]);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [commitFiles, setCommitFiles] = useState<DiffFile[]>([]);

  // Always load uncommitted files (no viewMode guard)
  useEffect(() => {
    let cancelled = false;
    getUncommittedDiff(repoPath)
      .then((files) => { if (!cancelled) setUncommittedFiles(files); })
      .catch((err) => console.error("Failed to load uncommitted diff:", err));
    return () => { cancelled = true; };
  }, [repoPath]);

  // Load committed files and commits — from GitHub API when PR exists, local git otherwise
  useEffect(() => {
    let cancelled = false;

    if (prNumber) {
      // PR exists: fetch from GitHub API
      getPrFiles(repoPath, prNumber)
        .then(async (files) => {
          if (cancelled) return;

          // Handle truncated files: fall back to local git diff for those
          const truncated = files.filter((f) => f.truncated);
          if (truncated.length > 0) {
            try {
              const localFiles = await getDiff(repoPath, baseBranch);
              const localByPath = new Map(localFiles.map((f) => [f.path, f]));
              const merged = files.map((f) => {
                if (f.truncated) {
                  return localByPath.get(f.path) ?? f;
                }
                return f;
              });
              setCommittedFiles(merged);
            } catch {
              // If local fallback fails, show what GitHub gave us (empty hunks for truncated)
              setCommittedFiles(files);
            }
          } else {
            setCommittedFiles(files);
          }
        })
        .catch((err) => console.error("Failed to load PR files:", err));

      getPrCommits(repoPath, prNumber)
        .then((list) => { if (!cancelled) setCommits(list); })
        .catch((err) => console.error("Failed to load PR commits:", err));
    } else {
      // No PR: use local git diff
      getDiff(repoPath, baseBranch)
        .then((files) => { if (!cancelled) setCommittedFiles(files); })
        .catch((err) => console.error("Failed to load committed diff:", err));
      getCommits(repoPath, baseBranch)
        .then((list) => { if (!cancelled) setCommits(list); })
        .catch((err) => console.error("Failed to load commits:", err));
    }

    return () => { cancelled = true; };
  }, [repoPath, baseBranch, prNumber]);

  useEffect(() => {
    if (viewMode !== "commits" || selectedCommitIndex === null || commits.length === 0) {
      setCommitFiles([]);
      return;
    }
    let cancelled = false;
    const commit = commits[selectedCommitIndex];
    if (!commit) return;
    getDiffForCommit(repoPath, commit.hash)
      .then((files) => { if (!cancelled) setCommitFiles(files); })
      .catch((err) => console.error("Failed to load commit diff:", err));
    return () => { cancelled = true; };
  }, [viewMode, selectedCommitIndex, commits, repoPath]);

  const displayFiles = useMemo(() => {
    switch (viewMode) {
      case "changes": {
        // Deduplicate: uncommitted (local edits) take precedence over committed version
        const uncommittedPaths = new Set(uncommittedFiles.map((f) => f.path));
        const uniqueCommitted = committedFiles.filter((f) => !uncommittedPaths.has(f.path));
        return [...uncommittedFiles, ...uniqueCommitted];
      }
      case "commits": return selectedCommitIndex !== null ? commitFiles : [];
    }
  }, [viewMode, uncommittedFiles, committedFiles, commitFiles, selectedCommitIndex]);

  return { uncommittedFiles, committedFiles, commits, commitFiles, displayFiles };
}
```

- [ ] **Step 3: Update ChangesView to pass prNumber**

In `src/components/changes/ChangesView.tsx`, update the `useChangesData` call (line 73-75) to pass `pr?.number`:

Change:
```typescript
  const { uncommittedFiles, committedFiles, commits, displayFiles } = useChangesData(
    repoPath, viewMode, selectedCommitIndex, pr?.baseBranch,
  );
```

To:
```typescript
  const { uncommittedFiles, committedFiles, commits, displayFiles } = useChangesData(
    repoPath, viewMode, selectedCommitIndex, pr?.baseBranch, pr?.number,
  );
```

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/api.ts src/hooks/useChangesData.ts src/components/changes/ChangesView.tsx
git commit -m "feat: use GitHub API for PR diffs, fall back to local git when no PR"
```

---

### Task 6: Manual verification

- [ ] **Step 1: Build and run**

Run: `cd /Users/chloe/dev/alfredo && cargo tauri dev 2>&1`

- [ ] **Step 2: Test with a PR worktree**

Open a worktree that has an associated PR. Check:
- The Changes tab file count matches what GitHub shows
- The Commits tab commit count matches what GitHub shows
- Diff content renders correctly (additions, deletions, context lines)
- Line numbers are correct in the diff view

- [ ] **Step 3: Test without a PR**

Open a worktree that has no PR. Check:
- The Changes tab still works with local git diff (unchanged behavior)
- Commits tab still works

- [ ] **Step 4: Test uncommitted changes**

Make a local edit in a PR worktree. Check:
- The uncommitted file appears in the Changes view
- If it overlaps with a PR file, the uncommitted version takes precedence

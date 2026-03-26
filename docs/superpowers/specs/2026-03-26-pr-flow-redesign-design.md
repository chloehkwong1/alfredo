# PR Flow Redesign — Design Spec

**Goal:** Get PRs merged ASAP. Surface every blocker and give the fastest path to unblock — without trying to replace GitHub.

**Context:** Alfredo's PR feature is currently read-only observability (view PR status, see check runs, click through to GitHub). This redesign adds depth where it matters: CI failure diagnosis, review awareness, and one-click handoff to Claude for fixes.

**User context:** Chloe uses PRs for work repos with team review. Personal projects (like Alfredo) don't use PRs. The flow must handle: CI failures, waiting on reviewers, review feedback, and merge conflicts.

---

## 1. PR Tab — Blocker Dashboard

The PR tab becomes a merge readiness dashboard. The header shows PR title, number, state, and a merge readiness summary (e.g., "2 of 4 blockers resolved").

Below the header, three collapsible sections:

### 1.1 Checks

- List of CI check runs with status icons (pass/fail/pending/running)
- **Failed checks expanded by default**, showing the failing step's log excerpt (not full log — just the relevant failure output from the GitHub Actions log zip)
- Passed/pending checks collapsed by default
- Actions per failed check:
  - **Re-run** — triggers GitHub Actions re-run API (`POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs`)
  - **Ask Claude to fix** — see Section 3

### 1.2 Reviews

- Per-reviewer status: approved, changes requested, pending, dismissed
- Unresolved comment count per reviewer
- "Changes requested" reviewers sorted to top

### 1.3 Comments (Summary)

- List of unresolved comments showing: author, file:line reference, and comment text
- Each item is clickable — jumps to the inline comment in the Changes/diff tab (see Section 2)
- General (non-line-specific) comments shown at the top of the list
- Resolved comments hidden by default (toggle to show)

### 1.4 Conflicts

- Shows merge conflict status from GitHub PR API (`mergeable` field)
- If conflicts exist: warning banner with list of conflicting files
- No in-app resolution — conflicts handled in git/editor as usual

---

## 2. Inline Comments on Diff

The Changes tab diff viewer gets PR review comment annotations when a worktree has a PR with comments.

- **Comment indicators** on the gutter/line number area for lines with review comments (speech bubble icon or similar)
- Clicking the indicator **expands the comment thread inline** below the code line, similar to GitHub's PR review UI
- Each comment shows: author, timestamp, body, resolved/unresolved status
- **"Open on GitHub" link** on each thread for replying
- Comment threads **collapsed by default** — indicator signals presence without cluttering the diff
- **General comments** (not attached to a line) show as a banner at the top of the diff, or in the PR tab only
- **Comment count badge** on the Changes tab label when there are unresolved comments

---

## 3. Ask Claude to Fix — Triage-Then-Fix Flow

One-click handoff from failing CI checks to the Claude agent in that worktree.

### Flow

1. User clicks "Ask Claude to fix" on a failing check (or on the section header to send all failures)
2. Alfredo gathers **all failing check log excerpts**
3. Identifies the **active Claude session** for that worktree (or opens a new Claude tab if none exists)
4. Composes and sends a prompt to the Claude terminal containing:
   - All failing check names and their log excerpts
   - The PR branch name for context
   - Instructions to **triage before fixing**:
     - For each failure: is this a real bug in my code, a flaky test, or a test that needs updating?
     - Skip flaky tests (timing issues, network flakes, known instability) — flag and move on
     - Diagnose before fixing: if the test is correct and code is wrong, fix the code; if code is correct and test is wrong, fix the test; report which
     - Report back before pushing: what was found, what's being fixed, what's being skipped
5. User lands on the Claude tab seeing the agent already working

### Log Extraction

- GitHub Actions API: download workflow run logs as zip
- Extract the failing job's log, parse out the relevant failure section (last N lines before step failure)
- Cache the extracted log so re-opening the PR tab doesn't re-download

### Nice-to-have (not required)

- "Ask Claude to fix" on individual review comments (send comment + code context to Claude)

---

## 4. Sidebar PR Status Indicators

Each worktree in the sidebar shows PR blocker status via **small Lucide icon badges on the right side** of the worktree row, alongside the PR number.

### Indicators

| Icon | Color | Meaning |
|------|-------|---------|
| `CheckCircle` | green | All checks passed |
| `XCircle` + count | red | N checks failing |
| `Loader` | yellow | Checks running |
| `RefreshCw` | orange | Changes requested |
| `MessageCircle` + count | muted | N unresolved comments |
| `Eye` | muted | Awaiting review |

### Behavior

- Agent status text ("Idle", "Thinking...", "Waiting for input") **preserved** below the worktree name — user iterates on code after PR is open, so agent state remains important
- PR indicators sit on the top row next to the worktree name and PR number
- Icons are 12px with 6px gaps — compact enough to fit 3-4 indicators without crowding
- When a worktree has no PR, the row displays exactly as today (agent status only)

### Data

The sync loop fetches summary data for all worktrees with PRs: check run status counts, review decisions, unresolved comment counts, and mergeable state.

---

## 5. Backend Changes

### New GitHub API Calls

| Endpoint | Purpose |
|----------|---------|
| `GET /repos/{owner}/{repo}/pulls/{number}/reviews` | Review status per reviewer |
| `GET /repos/{owner}/{repo}/pulls/{number}/comments` | Line-level review comments |
| `GET /repos/{owner}/{repo}/issues/{number}/comments` | General PR comments |
| `GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs` | Download workflow run logs (zip) |
| `POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs` | Re-run failed checks |
| PR response `mergeable` field | Already in PR API response, just not captured |

### Expanded `PrStatus` Type

Add to existing struct:
- `head_sha: String` — fixes stale check runs issue (use SHA instead of branch name for check run queries)
- `mergeable: Option<bool>` — merge conflict detection
- `review_decision: Option<String>` — "approved", "changes_requested", "review_required"
- `review_summary: Vec<PrReview>` — per-reviewer breakdown
- `unresolved_comment_count: u32` — for sidebar badge
- `failing_check_count: u32` — for sidebar badge

### New Types

```
PrReview {
  reviewer: String,
  state: String,        // "approved", "changes_requested", "pending", "dismissed"
  submitted_at: Option<String>,
}

PrComment {
  id: u64,
  author: String,
  body: String,
  path: Option<String>,       // file path (None for general comments)
  line: Option<u32>,          // line number (None for general comments)
  resolved: bool,
  created_at: String,
  updated_at: String,
}

WorkflowRunLog {
  run_id: u64,
  job_name: String,
  step_name: String,
  log_excerpt: String,        // parsed failure section
}
```

### Sync Loop Changes

- The 30s poll continues to fetch PR status (open/merged/draft)
- **On-demand fetching** for heavier data: reviews, comments, and logs are fetched when the PR tab is opened or when the user explicitly refreshes — not every 30s
- Summary counts (failing checks, unresolved comments, review decision) **are** fetched in the sync loop for sidebar indicators — these are lightweight API calls
- Log extraction (zip download + parse) only happens when user expands a failing check or clicks "Ask Claude to fix"

### Tech Debt Addressed

- `head_sha` added to `PrStatus` — resolves the stale check runs issue (existing follow-up item)
- `parse_github_owner_repo` should be extracted to a shared location as part of this work (existing follow-up item)

---

## 6. Out of Scope

- **Replying to PR comments from Alfredo** — GitHub stays the conversation venue
- **In-app merge conflict resolution** — use git/editor
- **Creating PRs from Alfredo** — separate feature
- **Webhook/realtime updates** — polling-based for now
- **Auto-fix on review comments** — nice-to-have, not in this spec

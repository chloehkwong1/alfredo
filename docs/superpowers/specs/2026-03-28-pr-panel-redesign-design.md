# PR Panel Redesign

## Problem

The PR panel is only visible when clicking the Changes tab for a worktree with a PR. This means you can't see PR status (checks, reviews, comments) while working in the Claude or Terminal tabs, and the left sidebar doesn't surface enough PR info to tell whether action is needed at a glance.

## Design Decisions

- **Sidebar density approach:** Icon row (option A) — adds a new row below the status line for PR stats, separated by a subtle border. Keeps agent status text visible since it remains important during PR back-and-forth.
- **Panel placement:** Persistent right sidebar (option A) — visible across all tabs, not just Changes.
- **Changes tab integration:** Merged (option A) — the Changes tab reuses the same right panel. Comment cards gain jump-to-file behavior when the Changes tab is active.
- **Collapsed state:** Icon rail (option A) — slim ~36px strip with badge-count icons for checks/reviews/comments. Glanceable summary even when collapsed.

## Section 1: Sidebar PR Stats (Icon Row)

When a worktree has a PR, a new row appears below the status line in `AgentItem`, separated by a subtle `border-top`.

**Contents:**
- **Check status** — green checkmark + count if all passing; red X + failing count if any fail
- **Review decision** — icon + label: "Approved" (green), "Changes requested" (red), "N pending" (amber). Omitted if no reviewers.
- **Comment count** — speech bubble icon + count, only shown if > 0
- **Mergeable indicator** — only shown when notable: "Conflict" (red) or "Ready" (green). Omitted for normal/unknown states.

**Data source:** Already available via `prSummary` in the workspace store — `failingCheckCount`, `unresolvedCommentCount`, `reviewDecision`, `mergeable`. No new backend calls needed.

No-PR worktrees are unaffected.

## Section 2: Persistent PR Panel (Right Sidebar)

The PR panel moves from Changes-tab-only to a persistent right sidebar visible across all tabs.

**Structure (top to bottom):**
1. **Header** — "PR #N" title, collapse toggle button, external link to GitHub
2. **Description** — PR body text, truncated with "show more" expand. New addition.
3. **Checks** — check run rows with status dot, name, duration, log link (same as current)
4. **Reviews** — reviewer avatar, name, approval state, timestamp (same as current)
5. **Comments** — comment cards with author, file path, body preview (same as current)
6. **Merge Status Banner** — sticky at bottom: "Ready to merge", "Conflict", "Changes requested", etc. (same as current)

**Collapsed state:** Icon rail (~36px wide) with vertically stacked icons for checks/reviews/comments, each with a small badge count. Click any icon or the expand button to open the full panel.

**Panel state** stored per-worktree via existing `prPanelState` in workspace store. Defaults to "open" when a PR exists.

**Changes tab integration:** Same panel is reused. Clicking a comment card triggers jump-to-file scroll in the diff view when Changes tab is active. On other tabs, clicking a comment card is a no-op (does not navigate to the Changes tab).

**No-PR worktrees:** Right panel doesn't render. Full width goes to center content.

## Section 3: Data & Wiring

### PR Description field
- Add `body: Option<String>` to `PrStatus` struct in Rust (`src-tauri/src/types.rs`)
- Populate during `sync_prs()` in `github_manager.rs` — the GitHub API response already includes `body`, just not extracted
- Add `body?: string` to frontend `PrStatus` type in `src/types.ts`
- No new API call needed

### PR panel data fetching
- Currently `PrPanel` fetches check runs and PR detail on mount (and every 30s) inside `ChangesView`
- Move fetch logic up to the worktree-level layout so it runs regardless of active tab
- Workspace store already caches `checkRuns` and `prDetail` per worktree — no store changes needed

### Component restructure
- Extract `PrPanel` from `ChangesView` into the main worktree layout (the component rendering the tab bar + content area)
- `ChangesView` passes `onJumpToComment` callback to the shared panel when it's the active tab
- Other tabs: panel renders identically but comment clicks are no-ops

### No new polling or background sync
Existing 30s refresh in `PrPanel` and `sync_prs` background loop cover everything.

## Section 4: Scope & Non-Goals

**In scope:**
- Sidebar icon row for PR stats in `AgentItem`
- Persistent right PR panel with description, checks, reviews, comments, merge status
- Collapsible icon rail
- `body` field addition to `PrStatus`
- Moving PR panel out of `ChangesView` into shared layout

**Out of scope:**
- PR actions (merge button, approve, request changes)
- Editing PR description from within Alfredo
- Resolving/unresolving comments
- Comment replies
- Split diff view improvements

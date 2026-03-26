# Agent Settings, Session Resume & CI Integration

Three features to improve the daily workflow: configurable Claude CLI settings with global defaults and per-worktree overrides, auto-resume of Claude conversations on app restart, and GitHub Actions CI integration with sidebar status badges and an actionable detail popover.

## Feature 1: Agent Settings

### Overview

A new "Agent" tab in the Global Settings dialog that configures how Claude CLI sessions are launched. Settings apply as CLI flags or config file entries when Alfredo spawns a new PTY session. Per-worktree overrides are accessible via a gear icon in the status bar.

### Global Defaults (Settings Dialog → Agent Tab)

A banner at the top reads: "Default settings for all new sessions — Override per worktree using the gear icon in the status bar."

Settings are grouped into three sections:

**Model & Performance:**

| Setting | Control | Values | CLI mapping |
|---------|---------|--------|-------------|
| Model | Dropdown | Opus 4.6 (1M context), Sonnet 4.6 (200K context), Haiku 4.5 (200K context) | `--model <id>` |

Note: The model list is hardcoded for now. If Claude releases new models, the dropdown values need updating. A future enhancement could fetch available models dynamically.
| Effort | Segmented control | Low, Medium, High, Max | `--effort <level>` |

**Permissions:**

| Setting | Control | Values | CLI mapping |
|---------|---------|--------|-------------|
| Permission Mode | Dropdown | Default, Accept Edits, Plan, Auto | `--permission-mode <mode>` |
| Skip Permissions | Toggle (off by default) | Boolean | `--dangerously-skip-permissions` |

**Output:**

| Setting | Control | Values | Config mapping |
|---------|---------|--------|----------------|
| Output Style | Segmented control | Default, Explanatory, Learning | `outputStyle` in settings file via `--settings` |
| Verbose | Toggle (off by default) | Boolean | `--verbose` |

Footer displays: "Applies to new sessions · existing sessions keep their settings."

### Per-Worktree Overrides (Status Bar Popover)

A gear icon is added to the right side of the existing status bar (after the annotation count badge). Clicking it opens a compact popover floating above the status bar.

The popover displays a subset of settings that are commonly changed per task:
- Model (dropdown)
- Effort (segmented control)
- Output Style (segmented control)
- Permission Mode (dropdown)

**Override UX:**
- Fields using the global default show a "Default" label on the right
- Fields that have been overridden show a purple border, purple text for the selected value, and a "Reset" link
- "Reset all" link in the footer clears all overrides
- Footer shows "Requires session restart" with a "Restart now" button that closes and respawns the session with updated settings

### Per-Worktree Override Rationale

Only Model, Effort, Output Style, and Permission Mode are overridable per worktree. Skip Permissions and Verbose are excluded intentionally: Skip Permissions is a safety-critical setting that should be uniform across the workspace, and Verbose is low-value as a per-task toggle.

### Data Model

New fields added to the existing `AppConfig` type (both Rust `types.rs` and TypeScript `types.ts`):

```json
{
  "claudeDefaults": {
    "model": "claude-opus-4-6",
    "effort": "high",
    "permissionMode": "default",
    "dangerouslySkipPermissions": false,
    "outputStyle": "Default",
    "verbose": false
  },
  "worktreeOverrides": {
    "<branch-name>": {
      "model": "claude-sonnet-4-6"
    }
  },
  "prCommand": "/open-pr"
}
```

Implementation note: `claudeDefaults`, `worktreeOverrides`, and `prCommand` must be added to `AppConfig` in `src-tauri/src/types.rs`, `ConfigFile` in `src-tauri/src/config_manager.rs`, and the frontend `AppConfig` in `src/types.ts`. All new fields should be `Option<T>` / optional with sensible defaults so existing config files remain valid.

Overrides are keyed by **branch name** (not worktree ID) so they survive worktree deletion and recreation. This matches the existing PR-to-worktree mapping pattern.

Only overridden fields are stored in `worktreeOverrides`. When spawning a session, the resolved config is: global defaults merged with any branch-specific overrides.

### How Settings Are Applied

`SessionManager.getOrSpawn()` is responsible for resolving settings and building the CLI args array. The flow:

1. Read `claudeDefaults` from config
2. Look up `worktreeOverrides[branchName]` and merge any overrides
3. Build CLI flags: `--model`, `--effort`, `--permission-mode`, `--verbose`, `--dangerously-skip-permissions`
4. For `outputStyle`: write a temporary settings file to `<app-data-dir>/tmp/claude-settings-<session-id>.json` containing `{ "outputStyle": "<value>" }` and pass via `--settings <path>`. Clean up the temp file when the session closes (in `SessionManager.closeSession()`). On app startup, clear any stale temp files from prior crashes.
5. Pass the assembled args to `spawnPty()` (which currently takes an empty args array)

### UI Placement

- Global defaults: Global Settings dialog → new "Agent" tab (after Shortcuts)
- Per-worktree: Gear icon in the status bar → popover

### Session Restart via Settings

When the user changes per-worktree settings and clicks "Restart now" in the override popover, the session is killed and respawned immediately with the new resolved settings. No confirmation banner — the user explicitly requested the restart.

---

## Feature 1b: Session Auto-Resume

### Overview

When Alfredo restarts, Claude tabs are restored with their saved scrollback and a compact overlay prompting the user to resume or start fresh. This bridges the gap between session persistence (already implemented) and conversation continuity (new).

### Restore Flow

On app startup, when restoring Claude tabs from saved session data:

1. Load saved scrollback into the xterm buffer (existing behavior)
2. Do NOT spawn a PTY process — leave the terminal in a "disconnected" state
3. Render a `SessionResumeOverlay` component anchored to the bottom of the terminal viewport
4. Wait for user interaction before spawning

Shell tabs (`type: "shell"`) continue to spawn immediately as today — auto-resume only applies to Claude tabs.

### Resume Overlay

A React component (`SessionResumeOverlay`) rendered as an absolute-positioned bar at the bottom of the `TerminalView` container. It appears only when the tab is in disconnected state.

**Layout:** Compact bar (~60px), full width, semi-transparent background with backdrop blur and a subtle purple top border.
- Left side: "Previous session ended" text
- Right side: Two buttons — "Resume conversation" (primary/purple) and "Start fresh" (secondary/ghost)

**Keyboard:** Enter triggers "Resume conversation" for quick restart. Escape dismisses the overlay without spawning (leaves scrollback visible). The overlay can be re-shown by clicking a small "Session options" link that appears in the terminal's status area after dismissal, or by closing and reopening the tab.

**Settings changed detection:** The overlay compares the saved `claudeSettings` snapshot against the current resolved settings (global defaults + worktree overrides). If they differ, the bar shows an additional note: "Settings changed (model: Opus → Sonnet)" so the user is informed before resuming.

### Resume Actions

**"Resume conversation":**
1. Remove the tab from `disconnectedTabs` in the workspace store
2. Spawn `claude --continue` with the current resolved settings (global defaults + worktree overrides, NOT the saved snapshot — if settings changed, the new settings are used)
3. Terminal already has scrollback loaded, so Claude's resumed output appears seamlessly below the existing history

**"Start fresh":**
1. Remove the tab from `disconnectedTabs`
2. Clear the terminal buffer
3. Spawn `claude` (no `--continue`) with the current resolved settings

### Data Model Changes

`WorkspaceTab` gains new optional fields to support restore:

```typescript
export interface WorkspaceTab {
  id: string;
  type: TabType;
  label: string;
  // New fields for session restore:
  command?: string;          // "claude" or "/bin/zsh"
  args?: string[];           // CLI args at spawn time (e.g., ["--model", "claude-sonnet-4-6"])
  claudeSettings?: {         // Resolved settings snapshot at spawn time
    model?: string;
    effort?: string;
    permissionMode?: string;
    outputStyle?: string;
  };
}
```

These fields are persisted via the existing `SessionPersistence` system (which already writes `tabs: WorkspaceTab[]` to `.alfredo/sessions/{worktreeId}.json`). No changes to `SessionData` itself are needed.

`command` and `args` record what was running so we can distinguish Claude tabs from shell tabs at restore time (beyond just `type`). `claudeSettings` captures the resolved settings at spawn time for change detection in the overlay.

### State Management

New field in the workspace store:

```typescript
disconnectedTabs: Set<string>;  // Tab IDs awaiting resume/fresh decision
addDisconnectedTab: (tabId: string) => void;
removeDisconnectedTab: (tabId: string) => void;
```

On app restore, all Claude tabs are added to `disconnectedTabs`. The overlay renders when `disconnectedTabs.has(tab.id)` is true. Clicking either button removes the tab from the set and spawns the PTY.

### Implementation Touchpoints

**Frontend changes:**
- `WorkspaceTab` type in `types.ts` — add `command`, `args`, `claudeSettings`
- `sessionManager.ts` — accept args in `getOrSpawn()`, build CLI flags from resolved settings, support disconnected mode (load scrollback without spawning PTY)
- New `SessionResumeOverlay` component — compact bar with Resume/Start fresh buttons
- `TerminalView.tsx` — render overlay when tab is in disconnected state
- `workspaceStore.ts` — add `disconnectedTabs` set
- `AppShell.tsx` — on restore, mark Claude tabs as disconnected instead of immediately spawning

**No Rust/backend changes needed** — `pty_manager.rs` already accepts `args: Vec<String>`, and session persistence already handles the `WorkspaceTab` structure.

---

## Feature 2: CI Integration

### Overview

GitHub Actions CI status displayed on sidebar worktree cards as chip badges. Clicking a badge opens a GitHub-branded popover with check details, failure logs, and action buttons (auto-fix, open PR, re-run).

### Sidebar CI Badges

Each worktree card in the sidebar shows a chip badge on the right side of the branch name row, indicating CI check status.

**Badge states:**

| State | Appearance | Example |
|-------|-----------|---------|
| All passing | Green pill with checkmark icon + count | ✓ 4/4 |
| Some failing | Red pill with X icon + count | ✗ 3/4 |
| Running | Yellow pill with spinner icon + count | ⟳ 2/4 |
| No CI runs | No badge shown | (empty) |

**Badge design:**
- Pill shape with `border-radius: 10px`
- Tinted background matching the status color at 12% opacity
- Small icon (8px) + count text (9px, font-weight 600, tabular-nums)
- Padding: 1px 6px
- Running state: spinner icon animates

Badges are clickable — clicking opens the CI detail popover.

### CI Detail Popover

Opens when clicking a CI badge on any sidebar card. Anchored to the badge position.

**Header:**
- GitHub logo (octicon) + "GitHub Actions" title
- Workflow name, commit SHA (abbreviated, monospace), and time since run
- External link to the full run on GitHub

**Summary bar:**
- Tinted background (red if any failures, green if all pass)
- Text: "1 failed · 3 passed" (counts)

**Check list:**
Each check shows:
- Status icon (circle-check green, circle-x red, spinner yellow)
- Check name (e.g. "Tests", "Lint", "Type Check", "Build")
- Duration
- Expand/collapse chevron

**Failed checks (expanded):**
- Monospace code block showing the last ~50 lines of the failed step output
- "Send to agent to fix" button (purple accent, full width)

**Passed checks:**
- Collapsed by default, expandable to see logs if needed

**Footer actions:**
- "Open PR" button — runs the configured PR command in the worktree's terminal
- "Re-run" button — re-triggers the GitHub Actions workflow

### "Send to Agent to Fix" Flow

1. User clicks "Send to agent to fix" on a failed check
2. Alfredo fetches the full failure log via `gh run view <run-id> --log-failed`
3. Formats a prompt: "The CI check '[check name]' failed. Here's the error output:\n\n```\n[failure log]\n```\n\nPlease diagnose and fix the issue."
4. Checks session state before sending:
   - **No session running:** Spawn a new session first (using resolved agent settings), then send the prompt
   - **Agent is idle/waiting for input:** Send the prompt directly
   - **Agent is busy:** Show a confirmation: "Agent is currently working. Queue this fix prompt for when it finishes?" (Queue by holding the prompt and sending it when state transitions to idle/waiting)
5. Sends the prompt to the worktree's PTY (types it into the terminal)
6. Popover closes, user can watch the agent work in the terminal

### "Open PR" Action

Runs a configurable command in the worktree's terminal. Default: `/open-pr`.

Configurable in Workspace Settings as a new "PR Command" field (stored as `prCommand` in `AppConfig`). This is a workspace-level setting (not per-worktree) since teams typically use the same PR workflow.

The button only appears when the worktree does not already have an associated PR (based on the existing GitHub sync data).

### "Re-run" Action

Re-triggers the workflow via `gh run rerun <run-id>` using the CLI (leverages the user's `gh` auth rather than requiring `actions:write` scope on the stored GitHub token). If the user's `gh` CLI is not authenticated, the button shows an error tooltip.

### CI Badge Error State

If the GitHub API call fails (rate limit, network error, token issue), the badge shows no change — it keeps the last known state. A subtle warning icon appears on the sidebar footer if any CI poll fails, with a tooltip explaining the issue.

### Data Flow

**Polling:** Extend the existing GitHub sync loop (30s interval) to also fetch check run status per branch via the GitHub API (`gh api repos/{owner}/{repo}/commits/{sha}/check-runs`). Only fetch check runs for branches that have a remote tracking branch (skip local-only branches with no pushed commits). With 8 active worktrees this adds ~8 API calls per cycle; GitHub's authenticated rate limit (5000/hr) accommodates this comfortably at one cycle per 30s (~960 calls/hr).

**State:** Add to the workspace store:
```typescript
interface CIStatus {
  runId: number;
  sha: string;
  status: 'completed' | 'in_progress' | 'queued';
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | null;
  checks: Check[];
  updatedAt: string;
}

interface Check {
  name: string;
  status: 'completed' | 'in_progress' | 'queued';
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | null;
  durationMs: number | null;
  failedStep: string | null; // name of the failed step, for log fetching
}
```

CI status is keyed by branch name (matched to worktrees via the same branch-name mapping used for PRs). When multiple workflow runs exist for a branch, only the most recent run is stored.

**Rust backend:** New Tauri command `get_check_runs(owner, repo, sha)` that calls the GitHub API via `octocrab`. The existing `github_sync` background loop is extended to fetch check runs alongside PR status.

**Events:** The existing `github:pr-update` Tauri event is extended (or a new `github:ci-update` event is added) to broadcast CI status changes to the frontend.

### Workspace Settings Addition

New field in Workspace Settings → Repository tab:

| Setting | Control | Default |
|---------|---------|---------|
| PR Command | Text input | `/open-pr` |

Helper text: "Command to run in the terminal when opening a PR."

Stored as `prCommand` in `AppConfig` (add to Rust and TS types as `Option<String>` / optional, defaulting to `/open-pr`).

---

## Design Mockups

Visual mockups are saved in `.superpowers/brainstorm/` from the design session:
- `agent-settings-v3.html` — Global settings dialog + per-worktree popover
- `ci-integration-v2.html` — Sidebar with CI chips + GitHub Actions popover
- `ci-badges-comparison.html` — Badge style comparison (chips selected)
- `resume-overlay.html` — Session resume overlay options (compact bar selected)

---

## Open Questions

1. **Failure log length:** How many lines of failure output to show in the popover? Proposed: last 50 lines, scrollable.
2. **Multiple workflow runs:** If a branch has multiple workflow runs (e.g. push + PR), which one to show? Proposed: most recent.
3. **CI polling vs webhooks:** Current design uses polling (30s). If latency matters, could explore GitHub webhooks via a local listener, but polling is simpler to start.

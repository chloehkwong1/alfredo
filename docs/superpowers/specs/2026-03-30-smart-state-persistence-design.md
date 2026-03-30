# Smart State Persistence

## Overview

Extend the existing session file + app config persistence infrastructure to remember more UI state across restarts. Also add auto-resume for Claude conversations.

## Motivation

Currently many UI preferences reset on restart — diff view mode, kanban column collapses, manual column overrides, sidebar state. Users have to manually run `/resume` in Claude tabs to continue conversations. This creates friction on every app restart.

## Architecture

No new infrastructure. All changes extend the two existing persistence layers:

- **Session files** (`.alfredo/sessions/{worktreeId}.json`) — per-worktree state, saved every 30s + on quit
- **GlobalAppConfig** (Tauri app data dir) — global preferences, saved on change

## New Per-Worktree State (Session Files)

Added to the `SessionData` interface:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `diffViewMode` | `"split" \| "unified"` | From global `defaultDiffViewMode` | Last-used diff view for this worktree |
| `columnOverride` | `{ column: KanbanColumn, githubStateWhenSet: string } \| null` | `null` | Manual column pin with state tracking |
| `prPanelState` | `"open" \| "collapsed"` | `"open"` | Whether PR panel was expanded |
| `changesViewMode` | `string` | TBD based on current implementation | Commit vs all-files view mode |
| `seenWorktree` | `boolean` | `false` | Whether user has dismissed the idle indicator |

## New Global State (App Config)

Added to `GlobalAppConfig`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `defaultDiffViewMode` | `"split" \| "unified"` | `"split"` | Default diff view for new worktrees |
| `autoResume` | `boolean` | `true` | Auto-run `/resume` on Claude tab focus |
| `collapsedKanbanColumns` | `string[]` | `[]` | Which kanban column groups are collapsed |
| `sidebarCollapsed` | `boolean` | `false` | Whether sidebar starts collapsed |

## Auto-Resume Behaviour

When the user clicks into a Claude tab that has previous scrollback but no active PTY:

1. Spawn the PTY as normal (existing behaviour)
2. If `autoResume` is enabled, wait for the shell prompt to be ready
3. Automatically send `/resume` to the PTY
4. Previous scrollback remains visible above; resumed conversation continues below

**Edge cases:**
- If the worktree's branch has been deleted/merged, `/resume` still runs — Claude Code handles this gracefully
- Only the clicked Claude tab gets auto-resumed (not all tabs across worktrees)
- The existing "disconnected tab" UI can be simplified since resume is automatic
- A small delay before sending `/resume` ensures PTY readiness

## Column Override Persistence

**Data shape** in session file:
```typescript
{
  columnOverride: {
    column: KanbanColumn,        // e.g. "in_progress"
    githubStateWhenSet: string   // PR state when override was set (e.g. "open")
  } | null
}
```

**Clearing logic on each GitHub sync:**
1. Fetch current PR state (open, draft, merged, closed)
2. If `columnOverride` exists and `githubStateWhenSet` matches current state -> keep override
3. If GitHub state has changed to something different -> clear override, use new auto-detected column

This replaces the existing in-memory `columnOverrides` in `usePrStore`.

## Collapsed Kanban Columns

- Stored globally in `GlobalAppConfig` (layout preference, not branch-specific)
- `StatusGroup` component reads initial state from config instead of defaulting to expanded
- On collapse/expand toggle, update the app config

## Sidebar Collapsed State

- Moved from `useWorkspaceStore` (memory-only) to `GlobalAppConfig`
- Read on app load, write on toggle

## Intentionally Not Persisted

- **Annotations** — temporary by nature
- **Remote control sessions** — ephemeral
- **PR reviews/comments/check runs** — fetched fresh from GitHub, should always be current
- **Agent status** — detected from PTY output, not historical state

## Migration

No migration needed. All new fields have sensible defaults. Missing fields in existing session files are handled by falling back to defaults during deserialization.

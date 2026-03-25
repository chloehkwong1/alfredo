# Worktree Lifecycle & Session Persistence

## Overview

Three related features to improve worktree management and session continuity in Alfredo:

1. **Worktree deletion** — right-click context menu to delete worktrees + local branches
2. **Session persistence** — save and restore tab layout + terminal scrollback across app restarts
3. **Archive section** — auto-archive merged worktrees with bulk cleanup

## Feature 1: Worktree Delete & Context Menu

### Active Worktrees (In Progress / Blocked / Draft PR / Open PR)

Right-click on any `AgentItem` opens a Radix `DropdownMenu` with "Delete worktree..." which opens a confirmation `Dialog`:

> "Delete worktree and local branch `branch-name`? This cannot be undone."

Confirm (danger button) triggers this sequence:
1. Close PTY session via `sessionManager.closeSession()`
2. `git worktree remove --force <path>`
3. `git branch -D <branch>`
4. Delete session file (`.alfredo/sessions/{id}.json`)
5. Remove from workspace store

### Done Worktrees

Same context menu as active worktrees, plus an additional "Archive" option that moves the worktree to the Archive section.

### Backend Changes

Update `delete_worktree` Rust command to:
- Accept a `force: bool` parameter (always true when called from UI, since the confirmation dialog is consent)
- Delete the local branch after removing the worktree (`git branch -D`)
- Return an error if the branch is checked out elsewhere

## Feature 2: Session Persistence

### Storage

Session data stored as JSON files in `.alfredo/sessions/` within the repo directory. Add `.alfredo/` to `.gitignore`.

File: `.alfredo/sessions/{worktree-id}.json`
```json
{
  "tabs": [
    { "id": "claude-1", "type": "claude", "label": "Claude" },
    { "id": "changes-1", "type": "changes", "label": "Changes" }
  ],
  "activeTabId": "claude-1",
  "terminals": {
    "claude-1": { "scrollback": "raw terminal output..." }
  },
  "savedAt": "2026-03-25T10:30:00Z"
}
```

### Save Triggers

- **On app quit:** Tauri's `before_exit` hook iterates all active sessions, dumps each terminal's buffer to its session file.
- **Debounced auto-save:** Every 30 seconds if there's new terminal output, to guard against crashes.

### Restore Flow (on startup)

1. Load repo path from Tauri store
2. Discover worktrees from git
3. For each worktree, check for `.alfredo/sessions/{id}.json`
4. If found: restore tab layout and active tab selection. When a terminal tab is opened, replay saved scrollback into xterm before spawning a new PTY.
5. If not found: create default tabs (Claude + Changes) as today.

### Cleanup

When a worktree is deleted, its session file is deleted too. Implemented as part of the delete sequence in Feature 1.

## Feature 3: Archive Section

### Placement

Below all kanban columns in the sidebar, separated with a subtle visual divider. Collapsed by default.

### Header

"Archive" label with a count badge and a "Delete all" button (ghost danger variant).

### Items

Simplified rendering — branch name only. No diff stats, no status dot, no drag-and-drop. Each item shows a trash icon on hover for one-click delete (no confirmation needed — already merged).

### Auto-Archive

- **Setting:** `archiveAfterDays: number`, default `2`
- **Location:** Persisted in `.alfredo/settings.json` (or app preferences UI)
- **Logic:** On each GitHub sync cycle (every 30s), check Done worktrees. If `mergedAt + archiveAfterDays` has elapsed, set `archived: true`.
- **`mergedAt` source:** GitHub PR data already fetched by the sync loop.

### Data Model

Add `archived: boolean` field to the `Worktree` type. Archived worktrees are filtered out of kanban columns and rendered exclusively in the Archive section.

### Bulk Delete

"Delete all" on the Archive header iterates all archived worktrees and runs the same delete sequence (force remove worktree + delete branch + delete session file + remove from store).

## Component & File Impact

### Frontend
- `AgentItem.tsx` — add right-click handler, render context menu
- `Sidebar.tsx` — add Archive section below kanban columns, filter archived worktrees from columns
- `workspaceStore.ts` — add `archived` field, `archiveWorktree()` action, `archiveAfterDays` setting, session save/restore logic
- `sessionManager.ts` — add methods to serialize/deserialize terminal buffers
- `AppShell.tsx` — restore sessions on startup, save on quit
- New: `ArchiveSection.tsx` — simplified sidebar section for archived worktrees
- New: `SessionPersistence.ts` — service for reading/writing `.alfredo/sessions/` files

### Backend (Rust)
- `commands/worktree.rs` — update `delete_worktree` to accept `force` param and delete local branch
- `git_manager.rs` — add `delete_branch()` function, update `delete_worktree()` to support force mode
- `lib.rs` — register updated command signature

### New Files
- `.alfredo/sessions/*.json` — per-worktree session state (gitignored)
- `.alfredo/settings.json` — app settings like `archiveAfterDays` (gitignored)

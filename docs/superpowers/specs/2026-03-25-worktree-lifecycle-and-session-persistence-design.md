# Worktree Lifecycle & Session Persistence

## Overview

Three related features to improve worktree management and session continuity in Alfredo:

1. **Worktree deletion** — context menu to delete worktrees + local branches
2. **Session persistence** — save and restore tab layout + terminal scrollback across app restarts
3. **Archive section** — auto-archive merged worktrees with bulk cleanup

## Feature 1: Worktree Delete & Context Menu

### Interaction

Right-click on any `AgentItem` opens a Radix **ContextMenu** (not DropdownMenu — ContextMenu is the correct Radix primitive for right-click menus). Install `@radix-ui/react-context-menu` if not already present.

### Active Worktrees (In Progress / Blocked / Draft PR / Open PR)

Context menu shows "Delete worktree..." which opens a confirmation `Dialog`:

> "Delete worktree and local branch `branch-name`? This cannot be undone."

Confirm (danger button) triggers this sequence:
1. **Remove from workspace store first** (prevents sync loop race — the 30s GitHub sync loop iterates `state.worktrees` and would error if the filesystem path is gone but the store entry remains)
2. Close PTY session via `sessionManager.closeSession()`
3. `git worktree remove --force <path>`
4. `git branch -D <branch>` (git itself prevents deleting a branch checked out in another worktree — rely on git's built-in error rather than a pre-check)
5. Delete session file (`.alfredo/sessions/{id}.json`)
6. Clean up orphaned store state: `tabs`, `activeTabId`, `annotations`, `checkRuns`, `columnOverrides`, `seenWorktrees` for the deleted worktree ID

### Done Worktrees

Same context menu as active worktrees, plus an additional "Archive" option that moves the worktree to the Archive section.

### Backend Changes

Update `delete_worktree` Rust command to:
- Accept a `force: bool` parameter (always true when called from UI, since the confirmation dialog is consent)
- Delete the local branch after removing the worktree (`git branch -D`)

## Feature 2: Session Persistence

### Storage Location

Session data stored in `.alfredo/sessions/` **in the main repo directory** (not per-worktree — worktrees are siblings of the repo directory, and centralizing avoids scattered `.alfredo/` dirs). Add `.alfredo/` to the main repo's `.gitignore`.

### File Format

File: `.alfredo/sessions/{worktree-id}.json`
```json
{
  "tabs": [
    { "id": "claude-1", "type": "claude", "label": "Claude" },
    { "id": "changes-1", "type": "changes", "label": "Changes" }
  ],
  "activeTabId": "claude-1",
  "terminals": {
    "claude-1": { "scrollback": "base64-encoded-terminal-output" }
  },
  "savedAt": "2026-03-25T10:30:00Z"
}
```

**Scrollback encoding:** Terminal output contains ANSI escape sequences that are not valid JSON strings. Base64-encode the raw buffer before writing to JSON. On restore, decode and write to xterm.

**Scrollback source:** Use the existing 50KB circular buffer (`getBufferedOutput()` in `sessionManager.ts`). This is already the replay mechanism used when re-attaching to a running session — reuse it for persistence too. The 50KB limit per session is a natural cap on file size.

### Save Triggers

- **On app quit:** The frontend listens for the window close event via `@tauri-apps/api/window`'s `onCloseRequested()`. This fires a handler that serializes all terminal buffers and writes session files via a Tauri filesystem command, then allows the close to proceed. (Session data lives in the JS process — xterm buffers cannot be accessed from Rust.)
- **Debounced auto-save:** Every 30 seconds if there's new terminal output, to guard against crashes.

### Restore Flow (on startup)

1. Load repo path from Tauri store
2. Discover worktrees from git
3. For each worktree, check for `.alfredo/sessions/{id}.json`
4. If found: restore tab layout and active tab selection. When a terminal tab is opened, replay saved scrollback (base64-decoded) into xterm before spawning a new PTY.
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

- **Setting:** `archive_after_days: u32`, default `2`. Added to the existing `AppConfig` Rust struct (in `types.rs`) — no separate settings file. Persisted via the existing `config_manager`.
- **Sync loop change:** Update `sync_prs` in `github_manager.rs` to fetch `State::All` (not just `State::Open`) with a date filter for recently closed PRs. Add `merged_at: Option<String>` to the `PrStatus` struct so the frontend can compute auto-archive timing.
- **Frontend logic:** On each GitHub sync event, check Done worktrees. If `mergedAt` is set and `now - mergedAt >= archiveAfterDays`, set `archived: true` on the worktree.

### Data Model

Add `archived: boolean` field to the frontend `Worktree` type (managed in the workspace store, not the Rust struct — `archived` is a UI concern that doesn't need backend persistence since it's derived from `mergedAt` + the auto-archive setting each time the app runs).

### Bulk Delete

"Delete all" on the Archive header iterates all archived worktrees and runs the same delete sequence. Show a progress indicator if >3 worktrees (e.g., "Deleting 3/10...").

## Component & File Impact

### Frontend
- `AgentItem.tsx` — add `onContextMenu` handler, wrap in Radix `ContextMenu`
- `Sidebar.tsx` — add Archive section below kanban columns, filter archived worktrees from columns
- `workspaceStore.ts` — add `archived` field to `Worktree`, `archiveWorktree()` action, extend `removeWorktree()` to clean up all related state (tabs, annotations, checkRuns, columnOverrides, seenWorktrees)
- `sessionManager.ts` — add `serializeBuffer()` / `deserializeBuffer()` methods using base64
- `AppShell.tsx` — restore sessions on startup, wire `onCloseRequested` to save sessions on quit
- New: `ArchiveSection.tsx` — simplified sidebar section for archived worktrees
- New: `SessionPersistence.ts` — service for reading/writing `.alfredo/sessions/` files
- New: `ContextMenu.tsx` — Radix ContextMenu UI component (following existing DropdownMenu pattern)

### Backend (Rust)
- `commands/worktree.rs` — update `delete_worktree` to accept `force` param and delete local branch
- `git_manager.rs` — add `delete_branch()` function, update `delete_worktree()` to support force mode
- `github_manager.rs` — update `sync_prs` to fetch `State::All`, add `merged_at` to `PrStatus`
- `types.rs` — add `archive_after_days` to `AppConfig`, add `merged_at` to `PrStatus`
- `lib.rs` — register updated command signatures

### New Files
- `.alfredo/sessions/*.json` — per-worktree session state (gitignored)

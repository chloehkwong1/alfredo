# First-Run UX Redesign

**Date:** 2026-03-24
**Status:** Draft

## Problem

The current first-time user experience has two separate screens (WelcomeScreen → EmptyWorkspace) with styling issues: cramped spacing, premature tips, a confusing empty sidebar showing "IN PROGRESS" with no content, and a TODO-stubbed directory picker. The flow feels disjointed for power users who already understand git worktrees and AI agents.

## Design

Replace the two-screen flow with a **single OnboardingScreen component** that evolves in-place. The sidebar is completely hidden during onboarding and only appears once the first worktree is created.

### States

**State 1 — Welcome (no repo configured):**
- Full-width layout, no sidebar
- Centered content: cat logo (72px, 0.7 opacity) → 32px gap → title "Welcome to Alfredo" (26px semibold) → 12px gap → single-line description "Manage your AI coding agents across git worktrees." (15px, text-secondary) → 36px gap → primary button "Open a repository" (15px, 12px/24px padding, accent-primary with subtle shadow) → 20px gap → hint "or drag a folder here" (13px, text-tertiary)
- Entire window is a folder drop target; dashed border appears on drag-over
- Button opens native OS directory picker via `@tauri-apps/plugin-dialog`

**State 2 — Create worktree (repo configured, no worktrees):**
- Same full-width layout, no sidebar
- Centered content: cat logo (same) → repo confirmation card (bg-secondary, border-default, rounded-10px; green checkmark + repo name bold + mono path + "Change" link in accent-primary) → 32px gap → heading "Create your first worktree" (20px semibold) → 10px gap → description "Each worktree gets its own branch, terminal, and agent." (14px, text-secondary) → 32px gap → primary button "Create a worktree"
- "Change" link re-opens the directory picker
- Button opens the existing `CreateWorktreeDialog`
- Returning users land here directly if the persisted repo path is valid (see Repo Path Persistence below)

**Transition between states:**
- Content crossfades in-place using Framer Motion (already a dependency)
- Cat logo stays anchored as a stable element
- Duration: 200ms ease (matches `--transition-normal`)

**After first worktree is created:**
- Sidebar slides in from the left (200ms ease)
- Main area transitions to normal TabBar + TerminalView layout
- App enters standard operating mode

### Removed from current design
- `WelcomeScreen.tsx` — replaced by OnboardingScreen State 1
- `EmptyWorkspace.tsx` — replaced by OnboardingScreen State 2
- "Branch → Agent → Terminal" flow hint — unnecessary for power users
- Setup scripts tip — premature; discoverable via workspace settings
- Empty sidebar with "IN PROGRESS" header during onboarding
- Duplicate "New worktree" CTA in sidebar footer during empty state

### New dependency
- `@tauri-apps/plugin-dialog` — for native OS directory picker (`open({ directory: true })`)
- Corresponding Rust-side plugin: `tauri-plugin-dialog` in Cargo.toml
- Plugin must be registered in `src-tauri/src/lib.rs` and permitted in Tauri capabilities

### Component structure

```
OnboardingScreen (new)
├── State 1: Welcome view
│   ├── Cat logo
│   ├── Title + description
│   ├── "Open a repository" button → Tauri directory picker
│   └── Drag-and-drop zone (entire window)
└── State 2: Create worktree view
    ├── Cat logo
    ├── Repo confirmation card (name, path, "Change" link)
    ├── Title + description
    └── "Create a worktree" button → CreateWorktreeDialog
```

### AppShell changes

```
// worktrees.length === 0 && !repoPath → State 1 (welcome)
// worktrees.length === 0 && repoPath  → State 2 (create worktree)
if (worktrees.length === 0) {
  // No sidebar rendered at all
  return <OnboardingScreen repoPath={repoPath} onRepoSelected={setRepoPath} onCreateWorktree={openDialog} />
}
// else: normal layout with sidebar
```

### Repo path persistence

The current `repoPath` is held in React state only — it is lost on app restart. The selected repo path must be persisted to the app's data directory using `tauri-plugin-store` (or a simple JSON file via Tauri's `app_data_dir`). This is separate from `.alfredo.json`, which lives inside the repo and stores workspace-level config.

On app launch:
1. Read persisted repo path from app-level store
2. If path exists on disk and contains a `.git` directory → go to State 2
3. If path is missing, invalid, or not a git repo → go to State 1 (silently discard the stale path)

On repo selection (via picker or drop):
1. Validate the directory exists and contains `.git/` (or `.git` file for worktrees)
2. Persist the path to app-level store
3. Transition to State 2

### Directory validation

All paths — whether from the native picker, drag-and-drop, or persisted store — go through the same validation:
1. Must be a directory (not a file)
2. Must contain a `.git` directory or `.git` file (i.e., is a git repository or worktree)
3. On failure: show a brief inline error below the button / drop zone: "This folder isn't a git repository." (14px, text-secondary with status-error color). Error clears on next interaction.

### Drag-and-drop

- Listen for `dragover`/`drop` events on the onboarding screen container
- On drag-over: show dashed border (2px dashed border-hover) around a 16px-inset zone
- On drop: extract path from the dropped item. If it's a file (not a directory), ignore silently. If it's a directory, run validation (see above).
- On drag-leave: hide border
- Keyboard users rely on the "Open a repository" button — drag-and-drop is an enhancement, not the primary path

### Error handling

- **User cancels native picker:** No-op. Remain in current state.
- **Dropped item is a file:** Ignored silently (no error).
- **Dropped/picked directory is not a git repo:** Inline error message (see Directory Validation above).
- **Persisted repo path is stale on return:** Silently discard, show State 1.

## Scope

- New `OnboardingScreen` component with two states
- Install and wire up `@tauri-apps/plugin-dialog` (JS + Rust + capabilities)
- Update `AppShell` to hide sidebar during onboarding
- Framer Motion transitions between states and sidebar reveal
- Folder drag-and-drop support on the onboarding screen
- Persist selected repo path to app-level store (survives app restart)
- Delete `WelcomeScreen.tsx` and `EmptyWorkspace.tsx`

## Out of scope

- Theme changes (design uses CSS custom properties, works with all existing themes)
- Onboarding tutorial or interactive walkthrough
- Changes to the CreateWorktreeDialog itself
- Settings or configuration changes

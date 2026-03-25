# Multi-Repo Onboarding & Sidebar Redesign

## Problem

Alfredo currently supports a single repository. The onboarding flow is a one-time wizard that collects repo path + configuration in a two-step process. Users need to manage multiple repositories — some with worktrees, some with just branches — and switch between them fluidly.

## Goals

- Support multiple repositories in the app
- Each repo can be in **worktree mode** (full worktree management) or **branch mode** (just branches, no worktree config)
- Clean first-launch experience that guides users to add their first repo
- Lightweight flow for adding subsequent repos
- Repo switching via sidebar without losing context

## Non-Goals

- Per-repo theme or notification settings (these stay global)
- Concurrent worktree views across repos (one active repo at a time)
- Repo grouping or folders

---

## Data Model

### App-Level State

New file: `~/.alfredo/app.json` (Tauri app data directory)

```json
{
  "repos": [
    { "path": "/Users/chloe/dev/alfredo", "mode": "worktree" },
    { "path": "/Users/chloe/dev/my-api", "mode": "worktree" },
    { "path": "/Users/chloe/dev/design-system", "mode": "branch" }
  ],
  "activeRepo": "/Users/chloe/dev/alfredo",
  "theme": "warm-dark",
  "notifications": {}
}
```

**Fields:**
- `repos` — ordered array of tracked repositories with their mode
- `activeRepo` — path of the currently selected repo
- `theme` — moved from per-repo to app-level (global preference)
- `notifications` — moved from per-repo to app-level (global preference)

### Per-Repo Config

Unchanged. Each repo keeps its own `.alfredo.json` in the repo root:

```json
{
  "setupScripts": [{ "name": "Setup", "command": "npm install", "runOn": "create" }],
  "githubToken": "ghp_xxxxx",
  "linearApiKey": "lin_api_xxxxx",
  "branchMode": false,
  "columnOverrides": {},
  "worktreeBasePath": "/Users/chloe/worktrees",
  "archiveAfterDays": 2
}
```

`githubToken` and `linearApiKey` stay per-repo since users may have different accounts for different repos (e.g., work vs personal).

### `branchMode` Source of Truth

`app.json` owns the `mode` field per repo. The existing `branchMode` field in `.alfredo.json` is deprecated and ignored. During migration it is read once to set the initial `mode` in `app.json`, then never consulted again.

### Migration

On first launch with the new code, if `app.json` doesn't exist:

1. Check `tauri-plugin-store`'s `app-settings.json` for the previously persisted `repoPath`
2. If found, check for `.alfredo.json` in that repo
3. Create `app.json` with:
   - The existing repo (mode derived from `.alfredo.json`'s `branchMode`, defaulting to `"worktree"`)
   - `theme` and `notifications` moved from `.alfredo.json` to `app.json`
4. The old `app-settings.json` store file is no longer read after migration — `app.json` fully replaces it

---

## Frontend State Management

### Store Scoping Strategy

The `workspaceStore` (Zustand) holds state for **one repo at a time**. On repo switch:

1. Save current repo's sessions to disk (`saveAllSessions`)
2. Clear the store entirely
3. Load the new repo's worktrees, config, and sessions from disk

This is the simplest approach — no keyed multi-repo state in memory. The tradeoff is a brief reload when switching repos, but it avoids the complexity of keeping all repos' state synchronized in memory.

### GitHub Sync Across Repos

The sync loop runs **only for the active repo**. Background repos do not get PR status updates while inactive. When switching to a repo, the sync loop restarts for that repo.

The activity dot on repo pills is scoped to **PTY sessions** — `PtyManager` already tracks all running sessions by worktree path, so we can check if any PTY sessions exist for a given repo's worktrees without needing the sync loop. This means the dot shows "has running agents" (observable from PTY state) not "has PR activity" (which would require background sync).

### Session Lifecycle on Repo Switch

When switching repos:
1. `saveAllSessions()` for the current repo (same as app quit)
2. Clear workspace store
3. `loadSession()` for the new repo's worktrees

This ensures no session data is lost when switching between repos.

---

## Flow 1: First Launch (No Repos)

### Screen: Welcome

Full-screen view (no sidebar visible):

- Alfredo logo
- Heading: "Add your first repository"
- Large drag-and-drop zone for folders
- "Open a repository" button below the drop zone
- Validates selection is a git repo (error message if not)

**Design reference:** `designs/multi-repo-sidebar.html`

### After Repo Selected

1. Repo is added to `app.json` with `mode: "branch"` initially
2. Sidebar appears with the repo as a pill
3. Repo Setup Dialog opens immediately

---

## Flow 2: Repo Setup Dialog

A single modal dialog that opens after selecting any new repo (first or subsequent). Not tabbed — one scrollable form.

### Fields

1. **GitHub connection** (optional)
   - Device authorization flow (same as current onboarding)
   - For subsequent repos: shows "Connected as @username" if a previous repo has a token, with option to reuse or connect a different account
   - Can be skipped

2. **Linear connection** (optional)
   - API key input
   - Same pre-fill logic: if a previous repo has a key, offer to reuse it
   - Can be skipped

3. **Worktree base path** (optional)
   - Text input + folder picker button
   - Defaults to repo's parent directory
   - Only relevant if user chooses worktree mode

4. **Setup scripts** (optional)
   - Shell command input for scripts to run on worktree creation
   - e.g., `npm install`, `bundle install`

### Actions

- **"Save & create first worktree"** (primary button) — saves config with `mode: "worktree"`, opens CreateWorktreeDialog
- **"Skip — just use branches"** (secondary button) — saves repo with `mode: "branch"`, closes dialog

### Pre-fill Logic for Subsequent Repos

When opening the setup dialog for a second+ repo, find the most recently configured repo that has credentials and pre-fill:
- GitHub: show "Connected as @username — use this account?" with option to change
- Linear: show "API key from [repo-name] — use this?" with option to change

---

## Flow 3: Sidebar — Repo Pills

### Layout

Top of sidebar, below the logo/header row:
- Horizontal row of repo pills
- Horizontally scrollable if overflow (for 5-6+ repos)
- Divider line below pills, then worktree content for active repo

### Pill Design

- **Active pill:** accent background + border, white/accent text, bold
- **Inactive pill:** very subtle background, muted text
- **Activity dot:** small green dot on pills whose repos have running agents
- **"+" button:** most subtle element — small, muted, appears at the end of the pill row. Intentionally less prominent than the "New worktree" button since repos are added rarely.

### Interactions

- Click pill → switch active repo, sidebar content updates
- Click "+" → opens Add Repository modal (same drag-and-drop as first launch, rendered as modal overlay)
- Right-click pill → context menu with "Remove repository"

### Below the Pills

Everything works exactly as today, scoped to the active repo:
- Status groups (In Progress, Blocked, Draft PR, Open PR, Done)
- Worktree items with drag-and-drop
- "New worktree" button at bottom (prominent)
- "Workspace settings" link
- Archive section

### Header Row

- Repo color avatar (auto-generated unique color + first letter)
- Repo name
- Settings gear icon
- No collapse button (removed for simplicity)

---

## Flow 4: Branch Mode

When a repo is in branch mode (user chose "Skip — just use branches"):

### Sidebar View

- Repo pill shows in the pill row (no activity dot)
- Main area shows a friendly empty state:
  - Folder icon
  - "Branch mode" label
  - "This repo is using branches directly. Enable worktrees for parallel development."
  - "Enable worktrees" button → opens the Repo Setup Dialog again, pre-focused on worktree config
- Below: shows current branch name
- No "New worktree" button
- "Workspace settings" link still available

---

## Flow 5: Adding Subsequent Repos

### Trigger

Click the subtle "+" at the end of the repo pills.

### Modal

Same component as the first-launch welcome screen, rendered as a modal overlay:
- "Add a repository" heading
- Drag-and-drop zone
- "Open a repository" button

### After Selection

1. Validate it's a git repo
2. Check for duplicates — if repo path is already tracked, show error: "This repository is already in Alfredo"
3. Add to `app.json`, pill appears in sidebar
4. Repo Setup Dialog opens with pre-filled credentials from most recent repo

---

## Flow 6: Removing a Repo

### Trigger

Right-click a repo pill → "Remove repository"

### Confirmation Dialog

"Remove [repo-name] from Alfredo? This won't delete any files."

### Behavior

- Removes from `app.json` repos array
- Does NOT delete `.alfredo.json` or any files on disk
- If removing the active repo, switch to the first remaining repo (or show welcome screen if none left)

---

## Components Summary

### New Components

- `RepoWelcomeScreen` — full-screen empty state for first launch
- `AddRepoModal` — modal version of the welcome screen for subsequent repos
- `RepoSetupDialog` — per-repo configuration modal (replaces current onboarding step 2)
- `RepoPills` — horizontal pill row in sidebar
- `BranchModeView` — sidebar content for branch-mode repos
- `RemoveRepoDialog` — confirmation for repo removal

### Modified Components

- `Sidebar` — add RepoPills, remove collapse/expand, scope content to active repo
- `App` / root — check `app.json` for repos, show welcome screen or sidebar accordingly
- `WorkspaceSettingsDialog` — no changes to UI, but reads/writes config for active repo
- `GlobalSettingsDialog` — switches from `getConfig`/`saveConfig` to new `getAppConfig`/`saveAppConfig` commands for theme and notifications

### Removed

- `OnboardingScreen` — replaced by RepoWelcomeScreen + RepoSetupDialog
- Sidebar collapse/expand functionality

### Backend Changes

- New Rust module: `app_config_manager` — CRUD for `app.json`
- New commands: `get_app_config`, `save_app_config`, `add_repo`, `remove_repo`, `set_active_repo`
- Existing config commands continue to work but scoped to the active repo path
- Migration logic: detect first launch with existing `.alfredo.json`, create `app.json`

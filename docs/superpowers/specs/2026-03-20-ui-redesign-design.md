# Alfredo UI Redesign — Design Spec

## Overview

Redesign Alfredo's UI from a kanban board + terminal dual-view into a sidebar + terminal-first workspace. The current app feels like disconnected screens — the new design keeps you in context while bouncing between 4-6 AI coding agents.

**Core insight**: The terminal is the primary interface. The board is navigation, not a destination. Design everything around getting to the right terminal fast and staying in context.

## Layout Shell

Three regions:

```
┌──────────┬─────────────────────────────────┐
│          │  Tab Bar (Terminal | Changes)    │
│  Sidebar │─────────────────────────────────│
│  (260px) │                                  │
│          │  Main Content Area               │
│          │  (Terminal or Diff Viewer)        │
│          │                                  │
│          │─────────────────────────────────│
│          │  Status Bar                      │
└──────────┴─────────────────────────────────┘
```

- **Sidebar**: 260px wide, collapsible. Status-grouped agent list.
- **Main area**: Tabbed — Terminal and Changes tabs.
- **Status bar**: Branch name, git stats (+/-), commit count (ahead of default branch), PR status.

## Sidebar

### Structure

- **Header**: Cat logo (SVG) + "alfredo" label + global settings gear icon.
- **Agent list**: Grouped by status (see below). Each item is clickable to select that agent in the main area.
- **Footer**: "+ New worktree" button. Workspace settings link.

### Status Groups

Five groups matching the existing kanban columns:

| Group | Header Style | Icon (lucide-react) | Auto-detection |
|-------|-------------|---------------------|----------------|
| In progress | `--text-secondary` | `Circle` | Default for new worktrees |
| Blocked | `--text-secondary` | `OctagonX` | Manual only |
| Draft PR | `--text-secondary` | `GitPullRequestDraft` | GitHub API — draft PR detected |
| Open PR | `--text-secondary` | `GitPullRequest` | GitHub API — PR opened/ready |
| Done | `--text-tertiary` | `CheckCircle2` | GitHub API — PR merged, or manual |

Group headers are **monochrome** — icons differentiate groups, not color. This keeps the agent status dot as the only chromatic signal per item.

### Visibility Rules

- **Default**: Only show groups that contain items, plus always show "In progress" (where new worktrees land).
- **Drag mode**: When user clicks and holds an item, all 5 groups reveal as drop targets.
- **Release/cancel drag**: Empty groups hide again.

### Agent Item

Each sidebar item displays:

- Agent status dot — mapped to existing `--status-*` theme tokens:
  - `--status-waiting` = waiting for input (needs attention — row gets subtle tinted background)
  - `--status-busy` = thinking/busy
  - `--status-idle` = idle
  - `--status-error` = error
  - `--text-tertiary` = not running
- Branch name (primary text)
- Git diff stats (+/- lines) on the right
- Agent status text label (e.g., "Waiting for input", "Thinking...", "Idle")
- PR number (if exists) on the right of status text

Selected item: highlighted with `--accent-primary` left border and `--accent-muted` background tint. Accent color is the only interactive/selection color — never used for status.

### Drag and Drop

Items are draggable between status groups. Uses dnd-kit (already in the project). Manual overrides are stored in Zustand and cleared when GitHub auto-detection triggers a state change (existing behavior from kanban).

## Main Area — Terminal Tab

Full PTY terminal (xterm.js) for the selected agent's worktree session. This is the existing TerminalView, repositioned within the new layout.

- **Session lifecycle**: PTY sessions are spawned lazily on first click (using existing `getOrSpawn` in SessionManager). Before a session exists, the terminal area shows a brief "Starting session..." state, then the shell appears cd'd into the worktree path.
- Sessions persist across agent switches (existing behavior from persistent PTY sessions).
- Agent state detected via hooks (Claude Code) — status reflected in sidebar dot.

## Main Area — Changes Tab

GitHub Desktop-style diff viewer. Two modes toggled via toolbar:

### Toolbar

- **Mode toggle**: "All changes" (diff from merge-base of default branch to HEAD — i.e., `git diff $(git merge-base main HEAD)..HEAD`) | "Commit by commit"
- **Commit stepper** (visible in commit-by-commit mode): ◀ 2 of 3 ▶ + commit message preview
- **Stats**: Total +/- lines and file count on the right

### Layout

Split panel:

```
┌──────────────┬──────────────────────────────┐
│  File List   │  Diff Viewer                 │
│  (220px)     │                              │
│              │  Hunk headers                │
│  M file.tsx  │  Context lines              │
│  M hook.ts   │  + Added lines (green bg)   │
│  A new.ts    │  - Removed lines (red bg)   │
│              │                              │
│              │  [Inline annotations]        │
│              │                              │
└──────────────┴──────────────────────────────┘
```

### File List

- File status badge: **A**dded (green), **M**odified (amber), **D**eleted (red)
- File name
- +/- line stats on the right
- Selected file highlighted with accent border (same style as sidebar)

### Diff Viewer

- Dual line numbers (old + new)
- Standard diff coloring: green background for additions, red for removals
- Hunk headers (@@ markers) in muted blue
- File header with path and "View on GitHub" link
- Context lines in muted color

### Inline Annotations

The key differentiating feature — click any diff line to leave an inline comment.

- **Click a line** → text input appears below that line
- **Type comment, press Enter** → annotation saved as an inline bubble
- **Bubble display**: User avatar + comment text, with hint: "annotations attach to your next terminal message"
- **Delete**: Click X on any annotation bubble to remove it
- **Status bar indicator**: Badge showing count, e.g., "3 annotations"
- **Scope**: Annotations are per-agent (stored by worktree ID). Switching agents preserves each agent's unsent annotations.
- **Persistence**: Stored in Zustand only (not persisted to disk). Lost on app restart — these are ephemeral review notes, not permanent comments.
- **Commit navigation**: When stepping between commits in commit-by-commit mode, annotations on other commits remain but are not visible until you navigate back to that commit.
- **Sending**: When user switches to Terminal tab and sends a message, all annotations for that agent (across all commits/files) are formatted as `file:line — comment` and prepended to the message.
- **After sending**: Annotations for that agent are cleared.

### Data Source

- Diffs from local git via Rust git2 crate (no GitHub API needed)
- Commit list from local git log
- PR status from existing GitHub sync background loop

## Settings

Two separate dialogs accessed from different entry points.

### Global Settings

Accessed via ⚙ icon in sidebar header. App-wide preferences:

- **Appearance**: Theme selector (see Themes section below), font settings
- **Terminal**: Font family, font size, cursor style, scrollback
- **Integrations**: GitHub token, Linear API key
- **Shortcuts**: Keyboard shortcut customization (future)
- **Notifications**: Enable/disable, trigger selection (waiting/idle/error), notification sound picker with preview (6 bundled sounds including a cat meow), test button
- **Default model**: (future)

Uses vertical tab navigation on the left side of the modal.

### Workspace Settings

Accessed via "Workspace settings" link at the bottom of the sidebar, near "+ New worktree". Per-repository configuration:

- **Repository**: Repo path (read-only), default branch
- **Scripts**: Setup script (runs on worktree creation), Run script (runs after setup), Archive script (runs on worktree removal)
- **Display**: Collapse empty status groups toggle, other workspace-specific display preferences

Uses the same vertical tab modal pattern as global settings.

## New Worktree Dialog

Modal dialog opened from "+ New worktree" button in sidebar footer.

- **Source selector**: Card-style toggle — New branch | Existing branch | Pull request | Linear ticket
- **Branch name**: Text input (for new branch)
- **Base branch**: Dropdown selector, defaults to main
- **Setup scripts hint**: Info line showing how many scripts will run, linking to workspace settings
- **Actions**: Cancel + "Create worktree" primary button

Same Tauri commands underneath — no functional changes from current implementation.

## Empty States

### First Launch (No Repository)

- Full-width welcome screen with cat logo (large, using the grey ombre app icon)
- "Welcome to Alfredo" heading
- "Open repository..." primary button
- "or drag a folder here" hint
- Sidebar visible but minimal (logo + empty state text)

### Empty Board (Repository Configured, No Worktrees)

- Sidebar shows only "In progress" group (per visibility rules) with no items
- Main area centered empty state:
  - Friendly message: "No worktrees yet"
  - Explanation: "Create a worktree to start an agent session. Each worktree gets its own terminal and branch."
  - "Create first worktree" primary button
  - Tip about setup scripts for discoverability

## Navigation & Keyboard Shortcuts

- **Click sidebar item** → selects agent, shows their terminal/changes in main area
- **↑/↓ arrows** → move between agents in sidebar
- **Cmd+1/2/3...** → jump to agent by position
- **Tab memory**: App remembers which tab (Terminal/Changes) was active per agent. Stored in Zustand as `Map<worktreeId, "terminal" | "changes">`. Default for new worktrees: Terminal.

## What's Removed

- **Kanban board view** — replaced by status-grouped sidebar
- **View toggle** (board/terminal) — no longer needed, sidebar + main area is the only layout
- **Branch mode toggle** — deferred, worktrees only for now (creation sources like "Pull request" and "Linear ticket" are still available in the New Worktree dialog)
- **Demo data** — real state from the start, no fake worktrees

## What's Preserved

- All Tauri commands and Rust backend — no backend changes
- PTY session persistence across agent switches
- Hooks-based agent state detection (Claude Code)
- GitHub sync background loop
- dnd-kit for drag-and-drop
- Zustand store — adapted for new UI state: `view` field replaced by `activeTab: Map<worktreeId, "terminal" | "changes">`, new `annotations: Map<worktreeId, Annotation[]>` field, `sidebarCollapsed: boolean` added. Existing fields (`worktrees`, `activeWorktreeId`, `columnOverrides`, `seenWorktrees`) remain.
- CSS custom property architecture (extended with theme variants)
- All component library primitives (Button, Card, Dialog, Badge, etc.)

## Logo

Cat silhouette SVG with grey ombre background. Used at three scales:

- **Sidebar header**: ~20px, white fill on transparent
- **Empty state / welcome**: ~80px, full icon with gradient background and rounded corners
- **App icon**: Full 1024x1024 PNG with ombre background (already designed)

Source files to be copied into `src/assets/` as `logo.svg` and `logo.png` during implementation (currently in ~/Downloads).

## Themes

8 built-in themes, selectable from Global Settings → Appearance. Implemented as CSS custom property overrides applied via a `data-theme` attribute on `<html>`.

### Theme List

| Theme | Background | Accent | Vibe |
|-------|-----------|--------|------|
| Warm Dark (default) | #1a1918 warm greys | Purple #9333ea | Current theme, cozy neutrals |
| Light | #fafaf9 warm white | Purple #7c3aed | Daytime / bright rooms |
| Synthwave '84 | #1a1028 deep purple | Pink #ff2975 | Neon retro-futuristic, glowing colors |
| Catppuccin Mocha | #1e1e2e charcoal | Lavender #cba6f7 | Soft pastels, community favourite |
| Sunset Boulevard | #1f1520 dark plum | Pink #f472b6 | Warm pinks and purples, golden hour |
| Tokyo Night | #1a1b26 midnight indigo | Blue #7aa2f7 | Muted blues and teals, atmospheric |
| Solarized Dark | #002b36 teal-black | Blue #268bd2 | Ethan Schoonover's scientific classic |
| Honeycomb | #1c1a17 dark honey | Gold #eab308 | Amber and gold, on-brand for Alfredo |

### Implementation

Each theme defines the same CSS custom properties as the current `theme.css` (backgrounds, text, borders, accent, status colors, shadows). The `--status-*` tokens may be adjusted per theme for contrast (e.g., Synthwave uses neon variants).

```css
/* Example: applied via data-theme attribute */
html[data-theme="tokyo-night"] {
  --bg-primary: #1a1b26;
  --bg-secondary: #24283b;
  --bg-elevated: #292e42;
  --accent-primary: #7aa2f7;
  /* ... all tokens overridden */
}
```

Theme preference stored in global app config (persisted to disk). Applied on app startup before first render to avoid flash.

### Future: CI Status

GitHub Actions / Checks API integration can be added later via octocrab to show CI pass/fail status in the status bar. Not in scope for this redesign.

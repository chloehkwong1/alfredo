# Sidebar Redesign — Design Spec

## Overview

Redesign the Alfredo sidebar from a generic dark-mode panel into a dense, scannable worktree dashboard. Inspired by Raycast's tight-row efficiency, with a "gradient bleed" attention system that makes needs-attention states impossible to miss.

## Goals

1. **Personality** — The sidebar should feel like a purpose-built agent dashboard, not a generic dark sidebar
2. **Attention states pop** — Waiting for input, done, and error states must be immediately scannable when juggling many worktrees
3. **No corner gaps** — Items are flat rows, not rounded cards. No visible breaks between adjacent items
4. **Multi-repo support** — Select multiple repos at once, see all worktrees mixed by status
5. **Richer information density** — Every row shows branch name, status, diff stats, time since last activity, server indicator, and repo tag

## Design Decisions

### Item Layout: Flat Rows

Items are full-width rows with no border-radius and no margin between them. This eliminates the corner gap problem and creates a clean, continuous list.

- Padding: `8px 14px` per row
- All items have `border-left: 3px solid transparent` to maintain alignment
- Hover state: `rgba(255,255,255,0.035)` — subtle, not heavy

### Attention System: Gradient Bleed

Three states trigger the attention treatment: **waiting for input**, **done**, and **error**.

Attention rows get:
- `border-left: 3px solid <status-color>` — colored left bar
- `background: linear-gradient(90deg, <status-color at 5-6% opacity>, transparent 60%)` — gradient that bleeds from the left bar and fades out
- Status dot gets a `box-shadow: 0 0 8px 2px <status-color at 40-50% opacity>` glow
- Branch name becomes `font-weight: 600` and brighter text color

Non-attention rows (busy, idle, not running) have no left bar, no background, no glow. They stay flat and quiet.

The gradient bleed uses CSS custom properties (`--status-waiting`, `--status-error`, etc.) so it automatically adapts to all 8 themes.

### Selection vs Attention

Selection (the currently active worktree) and attention (needs action) are separate visual treatments:
- **Selection**: Subtle background highlight (e.g., `rgba(255,255,255,0.05)`) — indicates "you're looking at this one"
- **Attention**: Left bar + gradient bleed + glow — indicates "this one needs you"
- A worktree can be both selected AND attention (both treatments apply)

### Information Hierarchy Per Row

Each worktree row shows (in priority order):

**Line 1:**
- Branch/worktree name (left, truncated)
- PR number if applicable (e.g., `#21340`)
- Server indicator (equalizer bars) if server is running on this worktree
- Time since last activity (right-aligned, e.g., `2m`, `1h`, `3d`)

**Line 2 (if PR exists):**
- PR title (truncated, tertiary color)

**Line 3:**
- Agent status text (colored by status)
- Diff stats right-aligned (`+142 -38`) — abbreviated for large numbers (e.g., `695k` not `695662`)
- PR check info if applicable (e.g., `2 failing` in red text)

### Status Dot

- Size: `8px × 8px` (up from 7px)
- Positioned at `margin-top: 4px` to align with the first line of text
- Attention states get a matching-color glow (box-shadow)
- Busy and waiting states pulse (`animate-pulse-dot`)

### Repo Selector: Multi-Select Dropdown with Chips

Replaces the current horizontal pill row.

**Closed state:** A single-line trigger below the header showing:
- Colored chip per selected repo (abbreviated name)
- Dropdown chevron

**Open state (dropdown):**
- Full repo names with checkboxes
- Worktree count per repo
- "Add repository" action at bottom

**Single repo selected:** Shows just the repo name (no chip needed), with "1 of N" indicator.

Each repo gets a consistent color (assigned from a palette: purple, blue, green, amber, pink, cyan, etc.) used for both the chip and the repo tag on worktree items.

### Repo Tags on Worktree Items

When multiple repos are selected, each worktree row shows a small colored tag (bottom-right of the row) with an abbreviated repo name. The tag color matches the repo's chip color.

When only one repo is selected, tags are hidden (no need — all items are from the same repo).

### Workspace Name

The header shows a configurable workspace name instead of the raw directory name:
- Default: cleaned-up directory name (strip underscores, capitalize first letter, e.g., `florence_client_worker_app` → `Florence Client Worker App`)
- Users can set a custom name in Workspace Settings
- Stored in the workspace config

### Group Headers

Status group headers (In Progress, Open PR, Done, etc.) use:
- 10-11px uppercase text with `letter-spacing: 0.08em`
- A gradient separator line: `linear-gradient(90deg, rgba(255,255,255,0.05), transparent)` between the label and the count
- Hover transitions to brighter text color
- Collapsible (existing behavior preserved)

### Footer

- "New worktree" button: dashed border style (`border: 1px dashed`) using `accent-primary` at 25% opacity
- On hover: fills with `accent-muted` background, border brightens
- "Workspace settings" link below

### Sidebar Background

- Subtle vertical gradient: `linear-gradient(180deg, var(--bg-sidebar) 0%, color-mix(in srgb, var(--bg-sidebar) 85%, black) 100%)`
- Right edge: `box-shadow: 1px 0 20px -4px rgba(0,0,0,0.6)` for depth instead of a hard border
- Barely-perceptible grain texture overlay via CSS (`opacity: 0.012`)

## Theme Compatibility

All 8 themes are kept. The gradient bleed effect uses theme CSS variables:
- `var(--status-waiting)` for waiting bleed (blue)
- `var(--status-error)` for error bleed (red)
- `var(--accent-primary)` for done bleed (purple/indigo — uses the theme's accent to differentiate from waiting-blue)
- Opacity levels: 5-6% for dark themes, 8-10% for light theme

The light theme needs slightly higher opacity on the gradient bleed and may need the dot glow reduced to avoid looking garish.

## New Data Requirements

### Time Since Last Activity

A new field `lastActivityAt: number` (unix timestamp) on the `Worktree` type. Updated whenever:
- Agent status changes
- Diff stats change
- PR status changes

Displayed as relative time: `2m`, `1h`, `3d`. Updated on a 30-second interval in the UI.

### Workspace Name

A new field `displayName?: string` in the workspace config. If not set, auto-generated from the active repo path.

### Multi-Repo Selection

Currently `activeRepo` is a single string. Change to `selectedRepos: string[]`. When multiple repos are selected:
- Worktrees from all selected repos are merged into a single list
- Sorted by status column (existing column order: inProgress → blocked → draftPr → openPr → done)
- Each worktree needs a `repoPath` field to identify its source repo

### Repo Colors

Assigned from a fixed palette when repos are added to the workspace. Stored in workspace config as `repoColors: Record<string, string>`.

## Components Changed

- `Sidebar.tsx` — new background, dropdown selector, workspace name
- `AgentItem.tsx` — flat rows, gradient bleed, glow dots, repo tags, timestamps, richer info display
- `StatusGroup.tsx` — refined headers with gradient line, hover transition
- `RepoPills.tsx` — replaced entirely by new `RepoSelector.tsx` dropdown component
- `globals.css` — new CSS classes for gradient bleed, dot glow, sidebar background
- `theme.css` — no changes needed (uses existing variables)

## Components Added

- `RepoSelector.tsx` — multi-select dropdown with chips, checkboxes, repo management
- `RepoTag.tsx` — small colored tag component for identifying repo on worktree items
- `RelativeTime.tsx` — displays and auto-updates relative timestamps

## Out of Scope

- Drag-and-drop between columns (preserved as-is)
- Keyboard navigation (preserved as-is, but should work with multi-repo list)
- Archive section (preserved as-is, gets the same flat-row treatment)
- Context menus (preserved as-is)

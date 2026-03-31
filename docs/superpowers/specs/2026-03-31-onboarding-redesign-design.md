# Onboarding Redesign — Adaptive Setup & Worktree Detection

**Date:** 2026-03-31
**Status:** Draft
**Supersedes:** Portions of `2026-03-24-first-run-ux-design.md` and `2026-03-25-multi-repo-onboarding-design.md`

## Problem

The current onboarding flow confuses new users who already have git worktrees on their machine:

1. **RepoWelcomeScreen** shows "Add your first repository" with no auto-detection — users with existing worktrees think the app is broken.
2. **RepoSetupDialog** does detect worktrees via `listWorktrees()`, but buries the result in a small info banner at the bottom. The primary CTA still says "Save & create first worktree" even when worktrees already exist.
3. **Too much upfront config** — GitHub, Linear, worktree path, and setup scripts are all presented as equal-weight cards, making the dialog feel heavy.
4. **Adding repo #2+** requires re-entering the same GitHub/Linear credentials despite them being identical across work repos.
5. **"Skip — just use branches"** adds a mode choice that doesn't belong in the onboarding flow.

Observed in the wild: a new user opened Alfredo, saw no detection of their existing worktrees, thought it was broken, then accidentally found the setup dialog which did detect them — confusing two-screen experience.

## Goals

- Lead with detected worktrees so users immediately see their data
- Let users choose which worktrees to import (opt-out, not opt-in)
- Keep integrations visible and expanded (to encourage setup) but not blocking
- Make adding repo #2+ near-instant by carrying forward settings
- Add a lightweight orientation banner for first-time users
- Remove branch mode from the onboarding flow

## Non-Goals

- Auto-scanning the filesystem for repos (user still picks the folder)
- Branch mode support (will be a separate feature)
- Guided tutorial or multi-step walkthrough

## Mockups

Visual mockups saved in `docs/superpowers/specs/assets/onboarding-redesign-2026-03-31/`:
- `setup-dialog-states.html` — side-by-side comparison of "worktrees found" vs "no worktrees" states
- `setup-dialog-selectable.html` — selectable worktree list with checkboxes

---

## Design

### Flow Overview

#### First-time user (no repos configured)

1. **RepoWelcomeScreen** — unchanged. "Add your first repository" with folder picker + drag-and-drop.
2. **RepoSetupDialog (redesigned)** — adapts based on `listWorktrees()` result:
   - **Worktrees found:** Selectable worktree list as hero section, integrations expanded below, CTA = "Open board →"
   - **No worktrees found:** Info message ("No existing worktrees found — you'll create your first one next"), integrations expanded below, CTA = "Save & create first worktree"
3. **Board loads** with selected worktrees + orientation banner (first time only)

#### Adding repo #2+ (sidebar "+" button)

1. **AddRepoModal** — unchanged. Folder picker + drag-drop in a small modal.
2. **RepoSetupDialog** — same redesigned dialog, but with settings pre-filled from the most recent repo config:
   - GitHub token: carried forward
   - Linear API key: carried forward
   - Worktree base path: auto-derived from new repo's parent dir (same as current behaviour)
   - Setup scripts: **left empty** (repo-specific)
   - Subtle note: "Settings carried over from *{previous-repo-name}*"
3. Board updates with new repo's worktrees

### RepoSetupDialog — Redesigned Layout

The dialog is a single component that renders differently based on state. Top to bottom:

#### Header
- Title: "Set up your workspace"
- Subtitle: "Configure integrations and worktrees for *{repo-path}*"
- If repo #2+: additional line "Settings carried over from *{previous-repo-name}*"

#### Worktree Detection Section (hero)

**When worktrees are found:**
- Purple-tinted card (accent border + subtle background), positioned at the top
- Header row: tree icon + "Found N worktrees" + "Select all" toggle link
- List of worktrees, each row showing:
  - Checkbox (purple when selected, border-only when deselected)
  - Branch name (font-weight: 500)
  - Disk path (right-aligned, text-tertiary, truncated)
- All worktrees **selected by default** — user opts out of ones they don't want
- Deselected rows dim to 60% opacity
- Footer text: "N of M selected · Deselected worktrees stay on disk, just hidden from your board"

**When no worktrees are found:**
- Subtle card with tree icon + "No existing worktrees found — you'll create your first one next"

#### Integrations Section (always expanded)

Same cards as current design, always visible in both states:

1. **Connect GitHub** — GitHub CLI flow (unchanged logic)
   - If repo #2+ and token exists: auto-filled, shows connected username
2. **Connect Linear** — API key input (unchanged logic)
   - If repo #2+ and key exists: auto-filled
3. **Worktree location** — path input + folder picker (unchanged logic)
4. **Setup scripts** — text input, monospace, generic placeholder "npm install"
   - Always empty for repo #2+ (repo-specific)

Each card still shows "Optional — add later in settings" hint when empty.

#### Footer

- Left: helper text "You can add more worktrees later"
- Right: primary CTA button
  - Worktrees found (≥1 selected): **"Open board →"**
  - Worktrees found (0 selected): **"Open board →"** (still works — opens empty board)
  - No worktrees found: **"Save & create first worktree"**

**Removed:** "Skip — just use branches" link. Branch mode is dropped from onboarding.

### Settings Carry-Forward (Repo #2+)

When `RepoSetupDialog` opens for a non-first repo:

1. Load the most recently added repo's config via `getConfig(previousRepoPath)`
2. Pre-fill: `githubToken`, `linearApiKey`
3. Auto-derive: `worktreeBasePath` from new repo's parent directory (existing behaviour)
4. Leave empty: `setupScripts` (always repo-specific)
5. Show note in header: "Settings carried over from *{repo-name}*"

The user can still modify any pre-filled value before saving.

### Orientation Banner

After first-time setup completes and the board renders:

- Dismissible banner at top of the board area
- Copy: "**Welcome to Alfredo** — Each column is a worktree. Open the terminal tab to start an agent, or create a new worktree with **⌘N**."
- Dismiss via X button
- Persist dismissal to app config (`hasSeenOrientation: true`) — never shows again
- Renders as a subtle, single-line bar (not a modal or overlay)

### AppShell Changes

- When `RepoSetupDialog` calls `onConfigured("worktree")`:
  - If worktrees were selected in the dialog: skip `CreateWorktreeDialog`, go straight to board with those worktrees loaded
  - If no worktrees were selected/found and user clicked "Save & create first worktree": open `CreateWorktreeDialog` as before
- Pass previous repo config to `RepoSetupDialog` for pre-filling (repo #2+)
- Render orientation banner conditionally based on config flag

---

## Component Impact

| Component | Change |
|-----------|--------|
| `RepoSetupDialog` | Major rewrite — adaptive layout, selectable worktrees, settings carry-forward, new CTAs |
| `AppShell` | Moderate — pass previous config, handle "open board with worktrees" flow, orientation banner |
| `RepoWelcomeScreen` | No change |
| `AddRepoModal` | No change |
| `CreateWorktreeDialog` | No change (only triggered when no existing worktrees) |
| New: orientation banner | Small component — dismissible bar with config persistence |

## Data Changes

- `GlobalAppConfig` or per-repo config: add `hasSeenOrientation: boolean` flag
- `RepoSetupDialog` props: add `previousRepoConfig` for carry-forward
- `onConfigured` callback signature changes from `(mode: "worktree" | "branch") => void` to `(result: { selectedWorktreeIds: string[] } | "createNew") => void` — `selectedWorktreeIds` when existing worktrees were chosen, `"createNew"` when no worktrees exist and user wants to create one

## Edge Cases

- **Repo with 50+ worktrees:** The selectable list should scroll. Cap visible rows at ~8 with overflow scroll.
- **All worktrees deselected:** CTA stays "Open board →" — user lands on empty board, can add worktrees via ⌘N.
- **Stale worktrees on disk:** If a worktree directory was deleted but git still tracks it, `listWorktrees()` may return it. Show it but with a warning icon and "directory not found" note. Don't auto-select stale worktrees.
- **Settings carry-forward with invalid token:** If the carried-over GitHub token has expired, the GitHub card will show as connected initially but may fail later. This is acceptable — same as current behaviour when tokens expire.

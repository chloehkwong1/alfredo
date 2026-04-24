# Pin main-branch card — feature spec

**Status:** design approved, partially implemented (see "Implementation status" below).
**Branch:** `chloe/always-show-main-side-bar`.
**Visual reference:** `designs/pin-main-affordance.html` (open in browser).

## Goal

Let worktree-mode repos show a synthetic "main branch" card in the sidebar — a persistent lane for general-purpose prompts that don't belong in a ticket-specific worktree. Opt-in per repo.

## Final design

One discreet dashed button at the bottom of the `BranchSection`:

> **`+ Pin a main-branch card`**  `[N]`

- Count badge `[N]` = number of eligible (worktree-mode, not-yet-pinned) repos.
- Hidden entirely when `N === 0`.
- Renders below existing branch-mode cards and any already-pinned worktree-mode main cards.

Click → popover:

```
┌────────────────────────────────────┐
│  Pin a main-branch card            │  ← header, 12px / 600
│  Pick a worktree repo to show      │  ← subtitle, 11px / tertiary
│  alongside its branches.           │
├────────────────────────────────────┤
│  [AL] Alfredo         4 worktrees  │  ← row per eligible repo
│  [FA] florence-auth   0 worktrees  │
├────────────────────────────────────┤
│  Branch-mode repos always show a   │  ← footnote, 10px / tertiary
│  main card.                        │
└────────────────────────────────────┘
```

Click a row → adds that repo's path to `showMainCardRepos`, synthetic entry is created, popover closes, card appears below the pinned section.

When pinned, the card renders as a `BranchCard` with `titleMode="branch"` (branch name as title, repo tag on right). Hover reveals a small **×** top-right. Click × → removes path from `showMainCardRepos`, card disappears.

## Copy — exact strings

| Element | Copy |
|---|---|
| Button label | `Pin a main-branch card` |
| Button tooltip | `Show a main-branch card in the sidebar for a repo — a persistent lane for general prompts.` |
| Popover header | `Pin a main-branch card` |
| Popover subtitle | `Pick a worktree repo to show alongside its branches.` |
| Popover row | `{tag} {repo display name}` + `{N} worktree{s}` |
| Popover footnote | `Branch-mode repos always show a main card.` |
| Card × tooltip | `Unpin main card` |

Copy principles applied:
- "main-branch card" (not "main branch") — refers to the visible artefact, not the git concept.
- "Pin" verb — action-oriented; matches the mental model of persistence.
- "worktree" appears only in the popover subtitle, at the moment of choice. Not in the primary button label.
- Footnote answers the "why isn't branch-mode repo X in this list?" question without a UI callout.

## Layout rules

- Button sits inside `BranchSection` after all real cards (branch-mode + pinned worktree-mode).
- Popover: `bg-bg-elevated`, `border-border-default`, `shadow-md`, `rounded-md`. Position: anchored to button, probably above (sidebar is tall; list of repos shouldn't get clipped).
- × on real card: `opacity-0 group-hover:opacity-100`, top-right, `bg-black/15` + `border-border-subtle`, lucide `X` icon, 18×18px.

## Components

| Component | Status | Source |
|---|---|---|
| `BranchCard` — `titleMode="branch"` | Existing (done) | `src/components/sidebar/BranchCard.tsx` |
| `BranchSection` — detect worktree-mode + render branch-title layout | Existing (done) | `src/components/sidebar/BranchSection.tsx` |
| `PinMainButton` + popover | **New** | Add inside `BranchSection.tsx` or new file |
| Lucide `Plus`, `X` | Existing | |

## Interactions

### Keyboard
- Button is `<button>` — tab-focusable. `Enter` / `Space` opens popover.
- Popover: `Escape` closes. `↑`/`↓` navigates rows. `Enter` selects.
- Card × button is `<button>` with `aria-label="Unpin {repo} main card"`.

### Mouse
- Click button → popover.
- Click outside popover → close.
- Hover pinned card → × fades in.
- Click × → unpin.

## Auto-hide rules

Button renders only if there is at least one worktree-mode repo in `selectedRepos` that is **not** in `showMainCardRepos`.

## Implementation status (as of `/clear`)

### ✅ Done on branch `chloe/always-show-main-side-bar`

**Rust (`src-tauri/`):**
- `GlobalAppConfig.show_main_card_repos: Vec<String>` added to `types.rs`.
- All 4 construction sites in `app_config_manager.rs` updated.
- Compiles clean (`cargo check` green).

**TS types (`src/types.ts`):**
- `GlobalAppConfig.showMainCardRepos?: string[]` added.

**Data plumbing:**
- `useSessionRestore(repoPath, selectedRepos, repos, showMainCardRepos)` — injects synthetic `branch::<repoPath>` entry for worktree-mode repos in the list (works even with zero real worktrees).
- `useBranchRepos(repos, selectedRepos, showMainCardRepos)` — polls branch + diff stats for opted-in worktree-mode repos alongside existing branch-mode ones.
- `AppShell` passes `config?.showMainCardRepos ?? []` into `useSessionRestore`.

**Render:**
- `BranchCard` has `titleMode?: "repo" | "branch"` prop. In "branch" mode: title row shows GitBranch icon + branch name (mono) as the main heading; the separate branch sub-row is skipped.
- `BranchSection` passes `titleMode="branch"` for worktree-mode repos (via `worktreeModeRepoSet: Set<string>`).
- `Sidebar` builds `worktreeModeRepoSet` from `repos` and forwards.

**Unrelated bugfix (keep):**
- `RepoSelector` lazily fetches worktree counts for unselected repos when the dropdown opens — fixes the "0 worktrees" bug Chloe flagged. Uses local `liveCounts` state + `listWorktrees()` call. Shows `…` while pending.

### ⚠️ Remove — these were experiments that lost the design discussion

- `⌂ Main` pill in `RepoSelector` dropdown (the labeled toggle button added after the icon-only version). Delete the button, its `aria-pressed` wiring, the `Home` icon import if no longer needed.
- `showMainCardRepos` / `onToggleMainCard` props on `RepoSelector` — no longer needed there.
- Sidebar's `handleToggleMainCard` callback can stay but gets rewired to the new popover + × button instead of the dropdown pill.

### ❌ To build — next stage

1. **`PinMainButton` component** (new, probably in `src/components/sidebar/PinMainButton.tsx`):
   - Dashed outline button in `BranchSection` footer area.
   - Shows `+ Pin a main-branch card` + count badge.
   - Auto-hides when no eligible repos.
   - Opens popover on click.

2. **Popover** (can live inside `PinMainButton.tsx` or be separate):
   - Header + subtitle + list + footnote per the copy table above.
   - Click outside / `Escape` closes.
   - Row click → adds path to `showMainCardRepos` via `updateConfig`.
   - Positioned above the button (space upward in the sidebar, not below).

3. **× unpin affordance on pinned `BranchCard`:**
   - Only rendered when `titleMode === "branch"`.
   - `opacity-0 group-hover:opacity-100` pattern.
   - `stopPropagation` on click so it doesn't fire the card's own `onClick`.
   - Calls a new prop `onUnpin?: () => void`, passed in from `BranchSection` → from `Sidebar`.

4. **Wire `BranchSection`:**
   - Accept an `eligibleWorktreeRepos: RepoEntry[]` prop (worktree-mode repos in selectedRepos not in showMainCardRepos).
   - Render `PinMainButton` at the end if that list is non-empty.
   - Pass `onUnpin` into worktree-mode `BranchCard`s.

5. **Delete the dropdown pill** (see "Remove" list above).

## Open questions

None for v1. (Resolved: per-repo vs global → per-repo; visual distinction → title swap; discoverability → single add-button + popover.)

## Verification checklist for next stage

Once implemented, confirm:
- [ ] `npm run tauri dev` — button appears at sidebar bottom, only with eligible repos.
- [ ] Popover shows only worktree-mode repos + footnote.
- [ ] Clicking a popover row pins the repo; card appears immediately.
- [ ] Pinned card uses branch-name-as-title layout.
- [ ] Hover pinned card reveals ×; click unpins.
- [ ] Config persists across app restarts (`~/Library/Application Support/com.alfredo.app/app.json` has `showMainCardRepos`).
- [ ] `npx tsc --noEmit` clean, `cargo check` clean, `npm test -- --run` passes.
- [ ] Dropdown pill (`⌂ Main`) is gone.
- [ ] Live-count fix for unselected repos in the dropdown still works.

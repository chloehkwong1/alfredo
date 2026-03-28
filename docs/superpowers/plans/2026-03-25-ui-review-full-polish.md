# UI Review: Full App Polish & Typography — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 29 issues from the full-app UI review — type scale, hardcoded colors, contrast, accessibility, UX friction, and missing states.

**Architecture:** All changes are in the React frontend (no Rust changes). The type scale token fix must land first since it changes the pixel values of `text-caption` and `text-body`. After that, tasks are independent. No new files — all edits to existing components.

**Tech Stack:** React, Tailwind CSS v4, Radix UI, CSS custom properties, Tauri v2

**Review reference:** `.context/reviews/ui-review-2026-03-25-full.md`

**No test files exist** for the frontend. Per project rules, do not create new test files. Verify via `npx tsc --noEmit` and visual inspection.

---

### Task 1: Fix Type Scale Tokens

**Files:**
- Modify: `src/styles/theme.css:68-70`

- [ ] **Step 1: Update type scale values in theme.css**

```css
/* ── Typography ─────────────────────────────── */
--text-2xs: 10px;
--text-xs: 11px;
--text-sm: 13px;
--text-base: 15px;
--text-lg: 20px;
--text-xl: 26px;
```

Change `--text-xs` from `10px` to `11px` and `--text-sm` from `12px` to `13px`. This makes `text-caption` = 11px and `text-body` = 13px, matching the documented intent in `globals.css`.

- [ ] **Step 2: Verify no type errors**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | head -5`
Expected: No errors (CSS changes don't affect TS)

- [ ] **Step 3: Commit**

```bash
git add src/styles/theme.css
git commit -m "fix: correct type scale tokens — caption 11px, body 13px"
```

---

### Task 2: Migrate Shared UI Components to Design Tokens

**Files:**
- Modify: `src/components/ui/Button.tsx:22-26`
- Modify: `src/components/ui/DropdownMenu.tsx:40,75`
- Modify: `src/components/ui/ContextMenu.tsx:39`
- Modify: `src/components/ui/Badge.tsx` (find `text-xs`)
- Modify: `src/components/ui/Tooltip.tsx` (find `text-xs`)

- [ ] **Step 1: Update Button size classes**

In `Button.tsx`, replace the `sizeClasses` record:

```tsx
const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-7 px-2 text-caption gap-1.5 rounded-[var(--radius-sm)]",
  md: "h-8 px-3 text-body gap-2 rounded-[var(--radius-md)]",
  lg: "h-10 px-4 text-body gap-2 rounded-[var(--radius-md)]",
};
```

- [ ] **Step 2: Update DropdownMenu item and label text**

In `DropdownMenu.tsx`:
- Line 40: `"text-sm text-text-primary"` → `"text-body text-text-primary"`
- Line 75: `"px-2 py-1.5 text-xs font-medium text-text-tertiary"` → `"px-2 py-1.5 text-caption font-medium text-text-tertiary"`

- [ ] **Step 3: Update ContextMenu item text**

In `ContextMenu.tsx`:
- Line 39: `"text-sm text-text-primary"` → `"text-body text-text-primary"`

- [ ] **Step 4: Update Badge text**

In `Badge.tsx`: Replace `text-xs` with `text-caption`.

- [ ] **Step 5: Update Tooltip text**

In `Tooltip.tsx`: Replace `text-xs` with `text-caption`.

- [ ] **Step 6: Verify no type errors**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | head -5`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/Button.tsx src/components/ui/DropdownMenu.tsx src/components/ui/ContextMenu.tsx src/components/ui/Badge.tsx src/components/ui/Tooltip.tsx
git commit -m "fix: migrate shared UI components from Tailwind built-ins to design tokens"
```

---

### Task 3: Typography Migration — Settings Components

**Files:**
- Modify: `src/components/settings/GlobalSettingsDialog.tsx`
- Modify: `src/components/settings/WorkspaceSettingsDialog.tsx`
- Modify: `src/components/settings/TerminalSettings.tsx`
- Modify: `src/components/settings/NotificationSettings.tsx`
- Modify: `src/components/settings/GithubSettings.tsx`
- Modify: `src/components/settings/ScriptEditor.tsx`
- Modify: `src/components/settings/ThemeSelector.tsx`

Apply these replacements across all settings files:

| Pattern | Replacement | Context |
|---------|-------------|---------|
| `text-sm font-medium` (labels) | `text-body font-medium` | Form labels |
| `text-sm` (inputs, selects, body) | `text-body` | Readable text |
| `text-xs text-text-tertiary` (help text) | `text-caption text-text-tertiary` | Secondary info |
| `text-xs text-red-400` / `text-xs text-status-error` | `text-caption text-red-400` / `text-caption text-status-error` | Error messages |
| `text-xs font-mono` (kbd) | `text-caption font-mono` | Keyboard shortcuts |
| `text-[10px]` ("Coming soon" badges) | `text-micro` | Smallest text |

- [ ] **Step 1: Migrate GlobalSettingsDialog.tsx**

Replace all `text-sm` → `text-body` and `text-xs` → `text-caption`. Read the file first to confirm exact locations.

- [ ] **Step 2: Migrate WorkspaceSettingsDialog.tsx**

Same pattern. Also replace `text-[10px]` → `text-micro` on "Coming soon" badges.

- [ ] **Step 3: Migrate TerminalSettings.tsx**

Same pattern for labels and help text.

- [ ] **Step 4: Migrate NotificationSettings.tsx**

Same pattern.

- [ ] **Step 5: Migrate GithubSettings.tsx**

Same pattern. Note: `text-lg` on device code (line 125) should stay — it's intentionally large.

- [ ] **Step 6: Migrate ScriptEditor.tsx and ThemeSelector.tsx**

Same pattern for remaining settings files.

- [ ] **Step 7: Verify no type errors**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | head -5`

- [ ] **Step 8: Verify no remaining Tailwind built-ins in settings/**

Run: `grep -rn "\btext-sm\b\|\btext-xs\b" src/components/settings/ --include="*.tsx" | grep -v "text-secondary\|text-status\|text-subheading" | head -20`
Expected: Empty or near-empty

- [ ] **Step 9: Commit**

```bash
git add src/components/settings/
git commit -m "fix: migrate settings components from Tailwind text-sm/text-xs to design tokens"
```

---

### Task 4: Typography Migration — Layout, Sidebar & Onboarding

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/StatusBar.tsx`
- Modify: `src/components/sidebar/AgentItem.tsx`
- Modify: `src/components/sidebar/RepoPills.tsx`
- Modify: `src/components/sidebar/RemoveRepoDialog.tsx`
- Modify: `src/components/sidebar/BranchModeView.tsx`
- Modify: `src/components/onboarding/RepoWelcomeScreen.tsx`
- Modify: `src/components/onboarding/RepoSetupDialog.tsx`
- Modify: `src/components/onboarding/AddRepoModal.tsx`

| Pattern | Replacement | Context |
|---------|-------------|---------|
| `text-sm` (dropdown items, empty states) | `text-body` | Readable text |
| `text-sm text-status-error` | `text-caption text-status-error` | Error messages |
| `text-[10px]` (RepoPills) | `text-micro` | Pill labels — keep at 10px |
| `text-[11px]` (RepoPills context menu, BranchModeView) | `text-caption` | Now correctly 11px |
| `text-[9px]` (StatusBar, BranchModeView) | `text-micro` | Below minimum scale |

- [ ] **Step 1: Migrate AppShell.tsx**

Replace `text-sm` on dropdown menu items (lines 132, 140, 148) → `text-body`. Replace `text-sm` on empty state (line 489) → `text-body`.

- [ ] **Step 2: Migrate StatusBar.tsx**

Replace `text-[9px]` on annotation count (line 50) → `text-micro`.

- [ ] **Step 3: Migrate AgentItem.tsx**

Replace `text-xs` on status text (line 108) → `text-caption`.

- [ ] **Step 4: Migrate RepoPills.tsx**

Replace `text-[10px]` (line 73) → `text-caption` (11px — interactive pill labels need to be readable, not smallest size). Replace `text-[11px]` (line 108) → `text-caption`.

- [ ] **Step 5: Migrate BranchModeView.tsx**

Replace `text-[9px]` (line 51) → `text-micro`. Replace `text-[11px]` (line 54) → `text-caption`.

- [ ] **Step 6: Migrate RemoveRepoDialog.tsx**

Replace `text-sm` (line 44) → `text-body`.

- [ ] **Step 7: Migrate onboarding components**

RepoWelcomeScreen.tsx: Replace `text-sm` on error (line 86) → `text-caption`.
RepoSetupDialog.tsx: Replace `text-sm` (line 203) → `text-body`.
AddRepoModal.tsx: Replace `text-sm` on error (line 106) → `text-caption`.

- [ ] **Step 8: Verify no type errors**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | head -5`

- [ ] **Step 9: Commit**

```bash
git add src/components/layout/ src/components/sidebar/AgentItem.tsx src/components/sidebar/RepoPills.tsx src/components/sidebar/RemoveRepoDialog.tsx src/components/sidebar/BranchModeView.tsx src/components/onboarding/
git commit -m "fix: migrate layout, sidebar, onboarding from Tailwind built-ins to design tokens"
```

---

### Task 5: Typography Migration — Kanban, Changes, PR & Terminal

**Files:**
- Modify: `src/components/kanban/CreateWorktreeDialog.tsx`
- Modify: `src/components/changes/DiffViewer.tsx`
- Modify: `src/components/changes/DiffToolbar.tsx`
- Modify: `src/components/changes/FileList.tsx`
- Modify: `src/components/changes/ChangesView.tsx`
- Modify: `src/components/changes/AnnotationBubble.tsx`
- Modify: `src/components/changes/AnnotationInput.tsx`
- Modify: `src/components/pr/PrDetailPanel.tsx`
- Modify: `src/components/pr/PrHeader.tsx`
- Modify: `src/components/pr/CheckRunItem.tsx`
- Modify: `src/components/terminal/TerminalView.tsx`

| Pattern | Replacement | Context |
|---------|-------------|---------|
| `text-sm` (list items: branch/PR names, check run names) | `text-body` | Primary content |
| `text-xs` (metadata, error messages, toolbar buttons, diff code) | `text-caption` | Secondary/code |
| `text-xs font-mono` (code/diff) | `text-caption font-mono` | Code content |
| `text-[10px]` (Draft badge, duration, file paths, annotation markers) | `text-micro` | Smallest text |

- [ ] **Step 1: Migrate CreateWorktreeDialog.tsx**

Replace `text-sm` on branch/PR/issue names (lines 296, 349, 415) → `text-body`. Replace `text-xs` on metadata and errors → `text-caption`. Replace `text-[10px]` on Draft badge (line 353) → `text-micro`.

- [ ] **Step 2: Migrate changes components (DiffViewer, DiffToolbar, FileList, ChangesView, AnnotationBubble, AnnotationInput)**

All `text-xs` → `text-caption`. All `text-[10px]` → `text-micro`. `text-xs font-mono` → `text-caption font-mono`.

- [ ] **Step 3: Migrate PR components (PrDetailPanel, PrHeader, CheckRunItem)**

PrDetailPanel: `text-sm` (lines 37, 72) → `text-body`. `text-xs` → `text-caption`. `text-[10px]` → `text-micro`.
PrHeader: `text-sm` (line 19) → `text-body`. `text-xs` → `text-caption`.
CheckRunItem: `text-sm` (line 48) → `text-body`. `text-[10px]` (line 50) → `text-micro`.

- [ ] **Step 4: Migrate TerminalView.tsx**

Replace `text-sm` (lines 99, 107) → `text-body`. Replace `text-xs` (line 117) → `text-caption`.

- [ ] **Step 5: Verify no type errors**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | head -5`

- [ ] **Step 6: Run full typography audit**

Run: `grep -rn "\btext-sm\b\|\btext-xs\b" src/components/ --include="*.tsx" | grep -v "text-secondary\|text-sidebar\|text-status\|text-subheading" | wc -l`
Expected: 0

Run: `grep -rn 'text-\[9px\]\|text-\[10px\]\|text-\[11px\]' src/components/ --include="*.tsx" | wc -l`
Expected: 0

- [ ] **Step 7: Commit**

```bash
git add src/components/kanban/ src/components/changes/ src/components/pr/ src/components/terminal/
git commit -m "fix: migrate kanban, changes, PR, terminal from Tailwind built-ins to design tokens"
```

---

### Task 6: Fix Hardcoded Colors — Theme Token Migration

**Files:**
- Modify: `src/components/kanban/CreateWorktreeDialog.tsx:217`
- Modify: `src/components/sidebar/AgentItem.tsx:79-81,114-117`
- Modify: `src/components/sidebar/RepoPills.tsx:72-77,92`

- [ ] **Step 1: Fix CreateWorktreeDialog active tab color**

Line 217: Replace `bg-[#2a2928]` with `bg-bg-elevated`.

```tsx
activeTab === tab.id
  ? "bg-bg-elevated text-text-primary shadow-sm border border-border-default"
  : "text-text-tertiary hover:text-text-secondary hover:bg-bg-hover border border-transparent"
```

- [ ] **Step 2: Fix AgentItem selected/hover/default colors**

Replace hardcoded rgba values:
- Selected: `bg-[rgba(147,51,234,0.08)]` → `bg-accent-muted`
- Default: `bg-[rgba(255,255,255,0.02)]` → remove entirely (let sidebar bg show through)
- Hover: `hover:bg-[rgba(255,255,255,0.06)]` → `hover:bg-bg-hover`
- Waiting: `bg-[color-mix(in_srgb,var(--status-waiting)_8%,transparent)]` → `bg-status-waiting/8`

- [ ] **Step 3: Fix AgentItem diff stat colors**

Lines 114-117: Replace `text-text-tertiary` with semantic diff colors:
- Additions: `text-diff-added`
- Deletions: `text-diff-removed`

- [ ] **Step 4: Fix RepoPills hardcoded colors**

- Inactive pill: `bg-[rgba(255,255,255,0.04)]` → `bg-bg-hover/50`
- Active pill: keep `bg-accent-primary/20` (already uses token)
- Add button: `bg-[rgba(255,255,255,0.05)]` → remove, keep only `hover:bg-bg-hover`

- [ ] **Step 5: Verify no hardcoded colors remain in target files**

Run: `grep -n "rgba\|#[0-9a-f]\{6\}" src/components/sidebar/AgentItem.tsx src/components/kanban/CreateWorktreeDialog.tsx src/components/sidebar/RepoPills.tsx`
Expected: Empty (no hardcoded colors)

- [ ] **Step 6: Verify no type errors**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | head -5`

- [ ] **Step 7: Commit**

```bash
git add src/components/kanban/CreateWorktreeDialog.tsx src/components/sidebar/AgentItem.tsx src/components/sidebar/RepoPills.tsx
git commit -m "fix: replace hardcoded colors with theme tokens in AgentItem, CreateWorktreeDialog, RepoPills"
```

---

### Task 7: Fix Contrast & Opacity Issues

**Files:**
- Modify: `src/components/sidebar/StatusGroup.tsx:77`
- Modify: `src/components/sidebar/ArchiveSection.tsx:23`

- [ ] **Step 1: Remove opacity-60 from StatusGroup "Done" header**

Line 77: Change `isDone ? "text-text-tertiary opacity-60" : "text-text-tertiary"` to just `"text-text-tertiary"` for both cases (remove the ternary).

- [ ] **Step 2: Remove opacity-60 from ArchiveSection header**

Line 23: Change `text-text-tertiary opacity-60` to `text-text-tertiary`.

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/StatusGroup.tsx src/components/sidebar/ArchiveSection.tsx
git commit -m "fix: remove opacity-60 from Done/Archive headers — restore WCAG AA contrast"
```

---

### Task 8: Accessibility & Visual Polish

**Files:**
- Modify: `src/components/layout/AppShell.tsx:89-96`
- Modify: `src/components/sidebar/AgentItem.tsx:74-75`
- Modify: `src/components/sidebar/RepoPills.tsx:92-95`
- Modify: `src/components/layout/StatusBar.tsx:11-16`

- [ ] **Step 1: Fix tab close button — replace span with button**

In `AppShell.tsx` lines 89-96, replace:
```tsx
<span
  role="button"
  tabIndex={-1}
  onClick={(e) => handleCloseTab(e, tab.id)}
  className="ml-0.5 opacity-0 group-hover:opacity-100 hover:bg-bg-tertiary rounded p-0.5 transition-opacity"
>
  <X size={12} />
</span>
```

With:
```tsx
<button
  type="button"
  tabIndex={0}
  aria-label={`Close ${tab.label} tab`}
  onClick={(e) => handleCloseTab(e, tab.id)}
  className="ml-0.5 opacity-0 group-hover:opacity-100 hover:bg-bg-tertiary rounded p-0.5 transition-opacity cursor-pointer"
>
  <X size={12} />
</button>
```

- [ ] **Step 2: Fix AgentItem padding alignment**

Line 74: Remove `mx-2`. Change `px-3 py-3` → `px-4 py-2.5`.
Line 75: Change `mb-1` → `mb-0.5`.

Result: item text aligns with StatusGroup header text (both `px-4`).

- [ ] **Step 3: Increase add-repo button size**

In `RepoPills.tsx` line 92: Change `w-5 h-5` → `w-6 h-6`.
Line 95: Change `w-3 h-3` → `w-3.5 h-3.5`.

- [ ] **Step 4: Simplify StatusBar empty state**

In `StatusBar.tsx` lines 12-16, replace the "Select a worktree" message with a minimal empty bar:
```tsx
if (!worktree) {
  return <div className="h-8 bg-bg-bar border-t border-border-subtle flex-shrink-0" />;
}
```

- [ ] **Step 5: Verify no type errors**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | head -5`

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/AppShell.tsx src/components/sidebar/AgentItem.tsx src/components/sidebar/RepoPills.tsx src/components/layout/StatusBar.tsx
git commit -m "fix: accessibility — semantic tab close button, aligned spacing, larger click targets"
```

---

### Task 9: UX Improvements

**Files:**
- Modify: `src/components/sidebar/ArchiveSection.tsx`
- Modify: `src/components/kanban/CreateWorktreeDialog.tsx:211`
- Modify: `src/components/sidebar/RepoPills.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/sidebar/Sidebar.tsx:252`

- [ ] **Step 1: Add delete-all confirmation dialog to ArchiveSection**

Import Dialog components. Add `deleteAllDialogOpen` state. Wrap the "Delete all" button click to open the dialog instead of calling `onDeleteAll` directly. Add the confirmation dialog:

```tsx
<Dialog open={deleteAllDialogOpen} onOpenChange={setDeleteAllDialogOpen}>
  <DialogContent className="w-[420px]">
    <DialogHeader>
      <DialogTitle>Delete all archived worktrees</DialogTitle>
      <DialogDescription>
        This will delete {worktrees.length} worktree{worktrees.length === 1 ? "" : "s"} and their local branches. This cannot be undone.
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button variant="secondary" onClick={() => setDeleteAllDialogOpen(false)}>Cancel</Button>
      <Button variant="danger" onClick={() => { setDeleteAllDialogOpen(false); onDeleteAll(); }}>
        Delete all
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- [ ] **Step 2: Stop resetting search on tab switch in CreateWorktreeDialog**

Line 211: Remove `setSearchQuery("");` from the tab switch handler.

- [ ] **Step 3: Replace RepoPills custom context menu with Radix**

Remove: `contextMenu` state, `menuRef`, `handleContextMenu` callback, click-away `useEffect`, and the custom `<div>` menu at the bottom.

Add: Import `ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem` from `../ui/ContextMenu`. Wrap each pill `<button>` in a `<ContextMenu>` / `<ContextMenuTrigger>` pair, with a `<ContextMenuContent>` containing a single "Remove repository" item styled with `className="text-red-400 data-[highlighted]:text-red-300"`.

- [ ] **Step 4: Replace AppShell tab bar custom dropdown with Radix DropdownMenu**

Import `DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem` from `../ui/DropdownMenu`. Remove `menuOpen` state. Replace the custom framer-motion dropdown (lines 110-157) with:

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <button type="button" className="h-10 px-2 text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer flex items-center">
      <Plus size={16} />
    </button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="start">
    <DropdownMenuItem onSelect={() => handleAddTab("claude")}>
      <Sparkles size={14} /> New Claude tab
    </DropdownMenuItem>
    <DropdownMenuItem onSelect={() => handleAddTab("shell")}>
      <Terminal size={14} /> New terminal tab
    </DropdownMenuItem>
    <DropdownMenuItem onSelect={() => handleAddTab("pr")}>
      <GitPullRequest size={14} /> PR & Checks
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

Remove the `AnimatePresence` import if no longer used elsewhere in the file.

- [ ] **Step 5: Add hover underline to "Workspace settings" link**

In `Sidebar.tsx` line 252: Add `hover:underline` to the className.

- [ ] **Step 6: Improve empty state text in AppShell**

Line 489: Replace the single-line message with:
```tsx
<div className="flex flex-col items-center justify-center h-full text-text-tertiary gap-2">
  <span className="text-body">Select a worktree to get started</span>
  <span className="text-caption">Each worktree gets its own branch, terminal, and agent</span>
</div>
```

- [ ] **Step 7: Verify no type errors**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | head -5`

- [ ] **Step 8: Commit**

```bash
git add src/components/sidebar/ArchiveSection.tsx src/components/kanban/CreateWorktreeDialog.tsx src/components/sidebar/RepoPills.tsx src/components/layout/AppShell.tsx src/components/sidebar/Sidebar.tsx
git commit -m "fix: UX improvements — delete-all confirmation, Radix menus, search preservation"
```

---

### Task 10: Missing States & Keyboard Shortcuts

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/kanban/CreateWorktreeDialog.tsx:178-181`
- Modify: `src/components/terminal/TerminalView.tsx`

- [ ] **Step 1: Improve "Create your first worktree" empty state for migrating users**

The centered empty state (shown when a repo is configured in worktree mode but has no Alfredo-managed worktrees) says "Create your first worktree" — confusing for users migrating from Conductor who have existing git worktrees. In `AppShell.tsx`, find the empty-state rendering (the centered view with the cat logo, shown when `hasWorktrees` is false but a repo is configured). Change the heading from "Create your first worktree" to "No worktrees yet" and keep the subtitle. This is in the `Sidebar` component's inline rendering — check where the `CreateWorktreeDialog` is triggered from the centered empty state vs the sidebar footer.

Note: The centered empty state with the cat logo is likely rendered outside AppShell (it's the state where sidebar + main area both show the onboarding view). Read the code path to find exactly where this text lives — it may be in a conditional inside AppShell or in a separate component.

- [ ] **Step 2: Add Cmd+N shortcut to open Create Worktree dialog**

In `AppShell.tsx`, in the keyboard handler (around line 302), add before the Cmd+T handler:

```tsx
if (event.metaKey && !event.shiftKey && event.key === "n") {
  event.preventDefault();
  setCreateDialogOpen(true);
  return;
}
```

- [ ] **Step 3: Add loading state during repo switch**

In `AppShell.tsx`, add `const [switching, setSwitching] = useState(false)`. In `handleSwitchRepo`, wrap with `setSwitching(true)` / `setSwitching(false)`. In the sidebar wrapper `<motion.div>`, add `opacity-50 pointer-events-none` when switching:

```tsx
<motion.div
  className={["flex-shrink-0 h-full overflow-hidden", switching ? "opacity-50 pointer-events-none" : ""].join(" ")}
  ...
>
```

- [ ] **Step 4: Handle undefined worktree result in CreateWorktreeDialog**

Lines 178-186: Move `onOpenChange(false)` and state resets inside the `if (worktree)` block. Add else:

```tsx
if (worktree) {
  addWorktree(worktree);
  onOpenChange(false);
  setBranchName("");
  setSearchQuery("");
  setSelectedBranch(null);
  setSelectedPrNumber(null);
  setSelectedIssueId(null);
} else {
  setError("Failed to create worktree. Please try again.");
}
```

- [ ] **Step 5: Add error state to TerminalView**

Read `TerminalView.tsx` first. Add error handling — if the PTY hook exposes an error state, display it. If not, add a timeout-based fallback: if no terminal output after 10 seconds, show "Failed to start terminal session" with a Retry button.

- [ ] **Step 6: Verify no type errors**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | head -5`

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/AppShell.tsx src/components/kanban/CreateWorktreeDialog.tsx src/components/terminal/TerminalView.tsx
git commit -m "fix: missing states — Cmd+N shortcut, repo switch loading, error handling"
```

---

### Task 11: Final Verification

- [ ] **Step 1: Run full type check**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit`
Expected: Clean — no errors

- [ ] **Step 2: Typography audit — zero Tailwind built-ins**

Run: `grep -rn "\btext-sm\b\|\btext-xs\b" src/components/ --include="*.tsx" | grep -v "text-secondary\|text-sidebar\|text-status\|text-subheading" | wc -l`
Expected: 0

- [ ] **Step 3: Hardcoded color audit — zero in target files**

Run: `grep -rn "rgba\|#[0-9a-f]\{6\}" src/components/sidebar/AgentItem.tsx src/components/kanban/CreateWorktreeDialog.tsx src/components/sidebar/RepoPills.tsx | wc -l`
Expected: 0

- [ ] **Step 4: Opacity audit**

Run: `grep -rn "opacity-60" src/components/sidebar/StatusGroup.tsx src/components/sidebar/ArchiveSection.tsx | wc -l`
Expected: 0

- [ ] **Step 5: Hardcoded pixel sizes audit**

Run: `grep -rn 'text-\[9px\]\|text-\[10px\]\|text-\[11px\]' src/components/ --include="*.tsx" | wc -l`
Expected: 0

- [ ] **Step 6: Visual verification**

Launch the app and visually confirm:
- Sidebar text aligns with group headers
- Font sizes are consistent across settings, sidebar, and dialogs
- "Done" and "Archive" headers are readable
- Tab bar "+" opens a proper Radix dropdown
- Right-clicking a repo pill shows a proper Radix context menu
- "Delete all" in archive section shows a confirmation dialog
- Cmd+N opens the Create Worktree dialog

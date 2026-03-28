# Alfredo UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the kanban board + terminal dual-view with a sidebar + terminal-first workspace, add a diff viewer with inline annotations, and ship 8 built-in themes.

**Architecture:** The redesign replaces the view-switching pattern (`board | terminal`) with a persistent three-region layout: status-grouped sidebar (260px) + tabbed main area (Terminal | Changes) + status bar. The Zustand store is adapted to track active tab per worktree and inline annotations. All Rust backend code is unchanged — new features (diff viewer) use new Tauri commands added to the existing command pattern. Themes are pure CSS variable overrides via `data-theme` attribute.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Zustand, dnd-kit, xterm.js, Radix UI, Lucide icons, Tauri v2 (Rust backend with git2 crate), @tauri-apps/plugin-notification

**Spec:** `docs/superpowers/specs/2026-03-20-ui-redesign-design.md`

---

## File Structure

### New Files
- `src/components/layout/AppShell.tsx` — Top-level layout: sidebar + main area + status bar
- `src/components/layout/StatusBar.tsx` — Bottom status bar (branch, git stats, PR info)
- `src/components/sidebar/Sidebar.tsx` — Sidebar container (header, groups, footer)
- `src/components/sidebar/StatusGroup.tsx` — Collapsible status group with icon header
- `src/components/sidebar/AgentItem.tsx` — Individual agent row (dot, branch, stats)
- `src/components/sidebar/SidebarDragContext.tsx` — dnd-kit context wrapping sidebar for drag between groups
- `src/components/changes/ChangesView.tsx` — Main diff viewer container (toolbar + split panel)
- `src/components/changes/DiffToolbar.tsx` — Mode toggle, commit stepper, stats
- `src/components/changes/FileList.tsx` — Left panel file list with status badges
- `src/components/changes/DiffViewer.tsx` — Right panel diff renderer (hunks, lines, annotations)
- `src/components/changes/AnnotationBubble.tsx` — Inline annotation display + delete
- `src/components/changes/AnnotationInput.tsx` — Inline text input for new annotations
- `src/components/settings/GlobalSettingsDialog.tsx` — App-wide settings (appearance, terminal, integrations)
- `src/components/settings/WorkspaceSettingsDialog.tsx` — Per-repo settings (scripts, repository, display)
- `src/components/settings/ThemeSelector.tsx` — Theme grid picker for appearance tab
- `src/components/settings/NotificationSettings.tsx` — Notification preferences and sound selector
- `src/hooks/useNotifications.ts` — Watches agent state changes, triggers native notifications
- `src/assets/sounds/` — Notification sound files (5-6 bundled .mp3/.ogg)
- `src/components/empty/WelcomeScreen.tsx` — First launch, no repo configured
- `src/components/empty/EmptyWorkspace.tsx` — Repo configured, no worktrees
- `src/styles/themes.css` — All 8 theme definitions as CSS custom property overrides
- `src/assets/logo.svg` — Cat silhouette logo (copied from Downloads)
- `src/assets/logo.png` — Cat logo PNG (copied from Downloads)

### Modified Files
- `src/App.tsx` — Replace view switching with AppShell
- `src/stores/workspaceStore.ts` — Remove `view`, add `activeTab`, `annotations`, `sidebarCollapsed`; remove demo data
- `src/types.ts` — Add `Annotation`, `DiffFile`, `DiffHunk`, `DiffLine`, `CommitInfo` types
- `src/api.ts` — Add `getDiff()`, `getCommits()`, `getDiffForCommit()` wrappers
- `src/styles/theme.css` — No changes needed (already defines :root defaults for warm-dark)
- `src/styles/globals.css` — Import themes.css, add data-theme support
- `src/components/terminal/TerminalView.tsx` — Remove back button and header, become tab content only
- `src/components/ui/Badge.tsx` — No changes needed (already maps to --status-* tokens)
- `src/hooks/usePty.ts` — No changes needed

### Rust Backend (New Tauri Commands)
- `src-tauri/src/commands/diff.rs` — New: `get_diff`, `get_commits`, `get_diff_for_commit` commands using git2
- `src-tauri/src/lib.rs` — Register new diff commands

### Deleted Files (after migration)
- `src/components/kanban/KanbanBoard.tsx` — Replaced by sidebar
- `src/components/kanban/KanbanColumn.tsx` — Replaced by StatusGroup
- `src/components/kanban/WorktreeCard.tsx` — Replaced by AgentItem
- `src/components/settings/SettingsDialog.tsx` — Split into GlobalSettingsDialog + WorkspaceSettingsDialog
- `src/components/Logo.tsx` — Replaced by logo.svg asset

---

## Task 1: Copy Logo Assets & Create Theme System

**Files:**
- Create: `src/assets/logo.svg`, `src/assets/logo.png`
- Create: `src/styles/themes.css`
- Modify: `src/styles/globals.css`
- Modify: `src/main.tsx`
- Modify: `src/types.ts` (add `theme` to AppConfig)

- [ ] **Step 1: Copy logo files into project**

```bash
cp ~/Downloads/can-we-make-the-background-gret-ombre-instead--als.svg src/assets/logo.svg
cp ~/Downloads/can-we-make-the-background-gret-ombre-instead--als.png src/assets/logo.png
```

- [ ] **Step 2: Create themes.css with all 8 theme definitions**

Create `src/styles/themes.css` with CSS custom property overrides for each theme. Each theme must define all tokens from `theme.css`: backgrounds, text, borders, accent, status colors, shadows, danger.

The default theme (Warm Dark) stays in `:root` in `theme.css` (no change needed). Each additional theme is scoped under `html[data-theme="<name>"]`.

Themes to define:
- `light` — #fafaf9 bg, #7c3aed accent
- `synthwave` — #1a1028 bg, #ff2975 accent, neon status colors
- `catppuccin` — #1e1e2e bg, #cba6f7 accent
- `sunset` — #1f1520 bg, #f472b6 accent
- `tokyo-night` — #1a1b26 bg, #7aa2f7 accent
- `solarized` — #002b36 bg, #268bd2 accent
- `honeycomb` — #1c1a17 bg, #eab308 accent

Each theme defines ALL CSS custom properties (--bg-primary through --transition-normal). Reference the spec's theme table for exact colors.

- [ ] **Step 3: Import themes.css in globals.css**

Add `@import "./themes.css";` after the existing theme.css import in `src/styles/globals.css`.

- [ ] **Step 4: Add theme initialization to main.tsx**

Before `ReactDOM.createRoot`, read the saved theme and apply it. Use localStorage as a fast-load cache (applied before React renders to avoid flash), synced from the Tauri app config on startup:

```typescript
// Fast theme apply from cache (avoids flash)
const cachedTheme = localStorage.getItem("alfredo-theme");
if (cachedTheme && cachedTheme !== "warm-dark") {
  document.documentElement.setAttribute("data-theme", cachedTheme);
}
```

The ThemeSelector (Task 5) will persist to both localStorage (for fast load) and AppConfig via `saveConfig()` (for disk persistence). Add `theme?: string` to the `AppConfig` type in `types.ts`.

- [ ] **Step 5: Verify themes load by manually setting data-theme in dev tools**

Run: `npm run dev` (or `pnpm dev`)

In browser dev tools, add `data-theme="synthwave"` to the `<html>` element. Confirm colors change across the UI.

- [ ] **Step 6: Commit**

```bash
git add src/assets/ src/styles/themes.css src/styles/globals.css src/main.tsx
git commit -m "feat: add logo assets and 8-theme CSS system"
```

---

## Task 2: Update Types & Zustand Store

**Files:**
- Modify: `src/types.ts`
- Modify: `src/stores/workspaceStore.ts`

- [ ] **Step 1: Add new types to types.ts**

Append to `src/types.ts`:

```typescript
// Diff viewer types
export interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: "context" | "addition" | "deletion";
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  timestamp: number;
}

// Inline annotation
export interface Annotation {
  id: string;
  worktreeId: string;
  filePath: string;
  lineNumber: number;
  commitHash: string | null; // null = "all changes" mode
  text: string;
  createdAt: number;
}
```

- [ ] **Step 2: Update workspaceStore — remove old state, add new state**

In `src/stores/workspaceStore.ts`:

1. Remove `view: "board" | "terminal"` from state and `setView` action
2. Remove `branchMode`, `activeBranch`, `setBranchMode`, `setActiveBranch` (deferred)
3. Remove demo worktree data (empty array initial state)
4. Add new state fields:

```typescript
activeTab: Record<string, "terminal" | "changes">; // keyed by worktreeId
annotations: Record<string, Annotation[]>; // keyed by worktreeId
sidebarCollapsed: boolean;
```

5. Add new actions:

```typescript
setActiveTab: (worktreeId: string, tab: "terminal" | "changes") => void;
addAnnotation: (annotation: Annotation) => void;
removeAnnotation: (worktreeId: string, annotationId: string) => void;
clearAnnotations: (worktreeId: string) => void;
toggleSidebar: () => void;
```

Note: To read annotations for a worktree, use an inline selector: `useWorkspaceStore(s => s.annotations[worktreeId] || [])`. Do not add a getter function to the store — Zustand actions call `set()`, selectors are used at the call site.

6. Initial state for new fields:

```typescript
activeTab: {},
annotations: {},
sidebarCollapsed: false,
```

- [ ] **Step 3: Implement the new actions**

```typescript
setActiveTab: (worktreeId, tab) =>
  set((state) => ({
    activeTab: { ...state.activeTab, [worktreeId]: tab },
  })),

addAnnotation: (annotation) =>
  set((state) => ({
    annotations: {
      ...state.annotations,
      [annotation.worktreeId]: [
        ...(state.annotations[annotation.worktreeId] || []),
        annotation,
      ],
    },
  })),

removeAnnotation: (worktreeId, annotationId) =>
  set((state) => ({
    annotations: {
      ...state.annotations,
      [worktreeId]: (state.annotations[worktreeId] || []).filter(
        (a) => a.id !== annotationId
      ),
    },
  })),

clearAnnotations: (worktreeId) =>
  set((state) => ({
    annotations: {
      ...state.annotations,
      [worktreeId]: [],
    },
  })),

toggleSidebar: () =>
  set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors from the type/store changes (existing consumers of `view` will error — that's expected, we fix those in Task 3).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/stores/workspaceStore.ts
git commit -m "feat: update types and store for sidebar layout, annotations, and themes"
```

---

## Task 3: Build Layout Shell & Sidebar

**Files:**
- Create: `src/components/layout/AppShell.tsx`
- Create: `src/components/layout/StatusBar.tsx`
- Create: `src/components/sidebar/Sidebar.tsx`
- Create: `src/components/sidebar/StatusGroup.tsx`
- Create: `src/components/sidebar/AgentItem.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create AgentItem component**

`src/components/sidebar/AgentItem.tsx` — Single agent row in the sidebar.

Props: `worktree: Worktree`, `isSelected: boolean`, `onClick: () => void`

Renders:
- Agent status dot (6px circle, color from `--status-*` tokens based on `worktree.agentStatus`)
- Branch name (primary text)
- Git diff stats (+/- on the right) — placeholder "—" until we wire real data
- Agent status text label below branch name
- PR number if `worktree.prStatus` exists
- Selected state: accent left border + muted accent background
- "Waiting for input" rows get a subtle `--status-waiting` tinted background

Map `agentStatus` to dot color:
- `"waitingForInput"` → `var(--status-waiting)`
- `"busy"` → `var(--status-busy)`
- `"idle"` → `var(--status-idle)`
- `"error"` → `var(--status-error)`
- `"notRunning"` → `var(--text-tertiary)`

Map `agentStatus` to display text:
- `"waitingForInput"` → "Waiting for input"
- `"busy"` → "Thinking..."
- `"idle"` → "Idle"
- `"error"` → "Error"
- `"notRunning"` → "Not running"

Note: The `AgentState` type in `types.ts` does not currently include `"error"`. If the backend does not emit this state, treat any unrecognized state as `"notRunning"` with a fallback. The mapping is ready for when error detection is added.

Use Tailwind classes that reference the CSS custom properties.

- [ ] **Step 2: Create StatusGroup component**

`src/components/sidebar/StatusGroup.tsx` — A collapsible group header + list of agent items.

Props: `column: KanbanColumn`, `worktrees: Worktree[]`, `activeWorktreeId: string | null`, `onSelectWorktree: (id: string) => void`, `forceVisible?: boolean`

Renders:
- Group header: Lucide icon + uppercase label + count
- Icon mapping: inProgress→Circle, blocked→OctagonX, draftPr→GitPullRequestDraft, openPr→GitPullRequest, done→CheckCircle2
- Label mapping: inProgress→"In progress", blocked→"Blocked", draftPr→"Draft PR", openPr→"Open PR", done→"Done"
- Header color: `--text-secondary` for all except done which uses `--text-tertiary`
- List of `<AgentItem>` for each worktree in the group

Visibility logic:
- Render if `worktrees.length > 0` OR `column === "inProgress"` OR `forceVisible === true`
- When visible but empty: show nothing below header (clean)

- [ ] **Step 3: Create Sidebar component**

`src/components/sidebar/Sidebar.tsx` — Full sidebar container.

Reads from Zustand store: `worktrees`, `activeWorktreeId`, `columnOverrides`, `sidebarCollapsed`.

Sections:
- **Header**: Logo SVG (import from `src/assets/logo.svg`) + "alfredo" text + settings gear IconButton
- **Scrollable agent list**: Render `<StatusGroup>` for each of the 5 columns. Group worktrees by `worktree.column` directly — the store's `setManualColumn` already updates the column field on the worktree object, so no separate override lookup is needed.
- **Footer**: "+ New worktree" button (dashed border, accent color). "Workspace settings" text link.

When `sidebarCollapsed` is true, render only the header with a toggle button (implementation: set width to 0 with overflow hidden, or conditionally render).

- [ ] **Step 4: Create StatusBar component**

`src/components/layout/StatusBar.tsx` — Bottom bar for the active worktree.

Props: `worktree: Worktree | undefined`, `annotationCount: number`

Renders:
- Left: branch name, git diff stats placeholder, commit count placeholder
- Right: PR status (if exists: "Draft PR #N" or "Open PR #N"), annotation count badge if > 0
- All text in `--text-tertiary`, PR status in `--status-busy` (draft) or `--status-idle` (open)
- If no active worktree, render empty bar

- [ ] **Step 5: Create AppShell layout component**

`src/components/layout/AppShell.tsx` — The top-level layout.

```
<div className="flex h-screen">
  <Sidebar />
  <div className="flex-1 flex flex-col min-w-0">
    <TabBar />  {/* Terminal | Changes tabs */}
    <main>     {/* Terminal or ChangesView based on activeTab */}
    <StatusBar />
  </div>
</div>
```

TabBar: two tabs — "Terminal" and "Changes". Changes tab shows a badge with file count (placeholder for now). Active tab has accent bottom border. Clicking a tab calls `setActiveTab(activeWorktreeId, tab)`.

Main content: conditionally render `<TerminalView>` or a placeholder `<div>Changes coming soon</div>` based on `activeTab[activeWorktreeId]` (default to "terminal").

- [ ] **Step 6: Update App.tsx to use AppShell**

Replace the entire App component body with:

```tsx
function App() {
  useGithubSync();
  return <AppShell />;
}
```

Remove the conditional board/terminal rendering and the `view` dependency.

- [ ] **Step 7: Update TerminalView to work as tab content**

Modify `src/components/terminal/TerminalView.tsx`:
- Remove the back button and TerminalHeader (no longer needed — sidebar handles navigation)
- Remove the `setView("board")` call
- Keep the xterm container and usePty hook
- Add "Starting session..." loading state for when session is being spawned
- The component should just be: container div + xterm mount point

- [ ] **Step 8: Verify the new layout renders**

Run: `npm run dev`

Expected: sidebar on the left with status groups (empty if no worktrees, "In progress" always visible), tabbed main area on the right, status bar at the bottom. Terminal tab active by default. Settings gear visible.

- [ ] **Step 9: Commit**

```bash
git add src/components/layout/ src/components/sidebar/ src/App.tsx src/components/terminal/TerminalView.tsx
git commit -m "feat: replace kanban with sidebar + terminal-first layout shell"
```

---

## Task 4: Sidebar Drag-and-Drop

**Files:**
- Create: `src/components/sidebar/SidebarDragContext.tsx`
- Modify: `src/components/sidebar/Sidebar.tsx`
- Modify: `src/components/sidebar/StatusGroup.tsx`
- Modify: `src/components/sidebar/AgentItem.tsx`

- [ ] **Step 1: Create SidebarDragContext**

`src/components/sidebar/SidebarDragContext.tsx` — Wraps the sidebar group list with dnd-kit.

Uses `DndContext` with `PointerSensor` (same config as existing KanbanBoard: 5px activation distance).

State: `isDragging: boolean` — set true on `onDragStart`, false on `onDragEnd`/`onDragCancel`.

On `onDragEnd`: extract the worktree ID from `active.id` and the target column from `over?.id`. Call `setManualColumn(worktreeId, column)` in Zustand and fire-and-forget `setWorktreeColumn(".", worktree.name, column)` to Tauri. Note the existing API signature is `setWorktreeColumn(repoPath, worktreeName, column)` — use `"."` for repoPath and the worktree's `name` field (not ID). Same pattern as existing KanbanBoard's handleDragEnd at line 49.

Pass `isDragging` down to children (via prop or context) so StatusGroup can show hidden empty groups as drop targets.

- [ ] **Step 2: Make AgentItem draggable**

Add `useDraggable` from dnd-kit to AgentItem. The draggable ID is the worktree ID. Add drag handle styling (cursor: grab, opacity change while dragging).

- [ ] **Step 3: Make StatusGroup a droppable**

Add `useDroppable` from dnd-kit to StatusGroup. The droppable ID is the column name. Add visual feedback when dragging over (border highlight with accent color).

- [ ] **Step 4: Update Sidebar to use SidebarDragContext and pass isDragging**

Wrap the status group list in `<SidebarDragContext>`. Pass `forceVisible={isDragging}` to all StatusGroup components so empty groups appear as drop targets during drag.

- [ ] **Step 5: Test drag-and-drop**

Run the app. Create or have worktrees present. Click and hold an agent item → all 5 groups should appear. Drag to a different group → item should move. Release → empty groups should hide again.

- [ ] **Step 6: Commit**

```bash
git add src/components/sidebar/
git commit -m "feat: add drag-and-drop between sidebar status groups"
```

---

## Task 5: Settings Dialogs (Global + Workspace)

**Files:**
- Create: `src/components/settings/GlobalSettingsDialog.tsx`
- Create: `src/components/settings/WorkspaceSettingsDialog.tsx`
- Create: `src/components/settings/ThemeSelector.tsx`
- Modify: `src/components/sidebar/Sidebar.tsx` — wire up dialog triggers

- [ ] **Step 1: Create ThemeSelector component**

`src/components/settings/ThemeSelector.tsx` — Grid of theme preview cards.

Props: `currentTheme: string`, `onSelect: (theme: string) => void`

Renders a grid of 8 cards, each showing:
- Small preview swatch (background color + accent color dot)
- Theme name

On click: calls `onSelect(themeName)`. Selected theme gets accent border.

Theme data (static array):
```typescript
const themes = [
  { id: "warm-dark", name: "Warm Dark", bg: "#1a1918", accent: "#9333ea" },
  { id: "light", name: "Light", bg: "#fafaf9", accent: "#7c3aed" },
  { id: "synthwave", name: "Synthwave '84", bg: "#1a1028", accent: "#ff2975" },
  { id: "catppuccin", name: "Catppuccin", bg: "#1e1e2e", accent: "#cba6f7" },
  { id: "sunset", name: "Sunset Boulevard", bg: "#1f1520", accent: "#f472b6" },
  { id: "tokyo-night", name: "Tokyo Night", bg: "#1a1b26", accent: "#7aa2f7" },
  { id: "solarized", name: "Solarized Dark", bg: "#002b36", accent: "#268bd2" },
  { id: "honeycomb", name: "Honeycomb", bg: "#1c1a17", accent: "#eab308" },
];
```

- [ ] **Step 2: Create GlobalSettingsDialog**

`src/components/settings/GlobalSettingsDialog.tsx` — App-wide settings with vertical tabs.

Uses the existing `Dialog` component from the UI library. Vertical tab layout with tabs on the left:

- **Appearance**: ThemeSelector + font size (future placeholder)
- **Terminal**: Reuse existing `<TerminalSettings />` component
- **Notifications**: `<NotificationSettings />` (added in Task 13)
- **Integrations**: Reuse existing `<GithubSettings />` component
- **Shortcuts**: Placeholder tab with "Coming soon" text (future)

Note: Notifications tab will be wired in Task 13. For now, add it as a disabled tab or placeholder.

Theme change: update `localStorage.setItem("alfredo-theme", theme)` and `document.documentElement.setAttribute("data-theme", theme)` (or remove attribute for "warm-dark"). Changes apply instantly — no save button needed for theme.

Other settings: load config on open, save on close (same pattern as existing SettingsDialog).

- [ ] **Step 3: Create WorkspaceSettingsDialog**

`src/components/settings/WorkspaceSettingsDialog.tsx` — Per-repo settings with vertical tabs.

Vertical tabs:
- **Repository**: repo path (read-only), default branch
- **Scripts**: Reuse existing `<ScriptEditor />` component (setup, run, archive scripts)
- **Display**: "Collapse empty status groups" toggle (future — placeholder for now)

Same load/save config pattern as existing.

- [ ] **Step 4: Wire dialogs to Sidebar**

In `Sidebar.tsx`:
- Settings gear icon in header → opens `<GlobalSettingsDialog />`
- "Workspace settings" link in footer → opens `<WorkspaceSettingsDialog />`

Use `useState<boolean>` for each dialog's open state.

Also wire the "+ New worktree" button to open the existing `<CreateWorktreeDialog />` (move the import from KanbanBoard to Sidebar).

- [ ] **Step 5: Verify both dialogs open and function**

Run the app. Click gear → Global Settings opens with Appearance tab showing themes. Click a theme → colors change instantly. Click "Workspace settings" → Workspace Settings opens with Scripts tab.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/ src/components/sidebar/Sidebar.tsx
git commit -m "feat: split settings into global and workspace dialogs with theme selector"
```

---

## Task 6: Rust Diff Commands

**Files:**
- Create: `src-tauri/src/commands/diff.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/api.ts`

- [ ] **Step 1: Create diff.rs with git2-based diff commands**

`src-tauri/src/commands/diff.rs`:

Three Tauri commands:

1. `get_diff(repo_path: String, default_branch: Option<String>) -> Result<Vec<DiffFile>, String>`
   - Opens repo with git2
   - Determines default branch: use `default_branch` param if provided, else try `main`, fall back to `master`, fall back to reading `refs/remotes/origin/HEAD`
   - Finds merge base between HEAD and default branch using `repo.merge_base()`
   - Computes diff from merge base to HEAD
   - Returns structured DiffFile objects with hunks and lines
   - For renamed files: use `new_file` path as `path`, add optional `oldPath: Option<String>` to DiffFile struct. Map git2 status `RENAMED`/`COPIED` to `"renamed"`, any unrecognized statuses to `"modified"`

2. `get_commits(repo_path: String) -> Result<Vec<CommitInfo>, String>`
   - Walks commit history from HEAD to merge base
   - Returns list of CommitInfo (hash, short hash, message, author, timestamp)

3. `get_diff_for_commit(repo_path: String, commit_hash: String) -> Result<Vec<DiffFile>, String>`
   - Diffs the specified commit against its parent
   - Returns structured DiffFile objects

Define Rust structs matching the TypeScript types (DiffFile, DiffHunk, DiffLine, CommitInfo) with `#[derive(Serialize)]`.

Use the existing pattern from other command files in `src-tauri/src/commands/`.

- [ ] **Step 2: Register commands in lib.rs**

Add `mod diff;` to `src-tauri/src/commands/` module. Register `commands::diff::get_diff`, `commands::diff::get_commits`, `commands::diff::get_diff_for_commit` in the Tauri builder's `invoke_handler`.

- [ ] **Step 3: Add API wrappers in api.ts**

Add to `src/api.ts`:

```typescript
// Diff
export async function getDiff(repoPath: string): Promise<DiffFile[]> {
  return invoke("get_diff", { repoPath });
}

export async function getCommits(repoPath: string): Promise<CommitInfo[]> {
  return invoke("get_commits", { repoPath });
}

export async function getDiffForCommit(
  repoPath: string,
  commitHash: string
): Promise<DiffFile[]> {
  return invoke("get_diff_for_commit", { repoPath, commitHash });
}
```

- [ ] **Step 4: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/diff.rs src-tauri/src/lib.rs src/api.ts
git commit -m "feat: add git diff and commit Tauri commands via git2"
```

---

## Task 7: Changes View — File List & Diff Viewer

**Files:**
- Create: `src/components/changes/ChangesView.tsx`
- Create: `src/components/changes/DiffToolbar.tsx`
- Create: `src/components/changes/FileList.tsx`
- Create: `src/components/changes/DiffViewer.tsx`
- Modify: `src/components/layout/AppShell.tsx` — render ChangesView in Changes tab

- [ ] **Step 1: Create DiffToolbar**

`src/components/changes/DiffToolbar.tsx`

Props: `mode: "all" | "commit"`, `onModeChange`, `commits: CommitInfo[]`, `currentCommitIndex: number`, `onCommitStep: (index: number) => void`, `totalAdditions: number`, `totalDeletions: number`, `fileCount: number`

Renders:
- Toggle buttons: "All changes" | "Commit by commit"
- Commit stepper (visible when mode="commit"): ◀ ▶ arrows + "N of M" + short commit message
- Right side: "+N -M across F files"

- [ ] **Step 2: Create FileList**

`src/components/changes/FileList.tsx`

Props: `files: DiffFile[]`, `selectedPath: string | null`, `onSelectFile: (path: string) => void`

Renders 220px wide panel:
- "Changed files" header
- List of files, each showing: status badge (A/M/D with color), filename (basename only), +/- stats
- Selected file: accent left border + muted background
- Click: calls onSelectFile

- [ ] **Step 3: Create DiffViewer**

`src/components/changes/DiffViewer.tsx`

Props: `file: DiffFile | null`, `annotations: Annotation[]`, `onAddAnnotation: (lineNumber: number) => void`, `activeAnnotationLine: number | null`

Renders:
- File header: full path + "View on GitHub ↗" link (opens PR URL if available)
- For each hunk: hunk header in muted blue
- For each line: dual line numbers (old + new) + content
  - Context lines: muted text
  - Additions: green background
  - Deletions: red background
- Click on any line: calls `onAddAnnotation(lineNumber)` to open the annotation input at that line
- Renders `<AnnotationBubble>` below lines that have annotations

Use a monospace font (`font-family: monospace`) and consistent line height. Horizontal scroll for long lines.

- [ ] **Step 4: Create ChangesView container**

`src/components/changes/ChangesView.tsx`

Props: `worktreeId: string`, `repoPath: string`

State:
- `mode: "all" | "commit"`
- `files: DiffFile[]`
- `commits: CommitInfo[]`
- `currentCommitIndex: number`
- `selectedFilePath: string | null`
- `activeAnnotationLine: number | null`

On mount / when mode changes:
- If mode="all": call `getDiff(repoPath)` → set files
- If mode="commit": call `getCommits(repoPath)` → set commits. Then `getDiffForCommit(repoPath, commits[currentCommitIndex].hash)` → set files

Layout:
```
<DiffToolbar />
<div className="flex flex-1 min-h-0">
  <FileList />
  <DiffViewer />
</div>
```

Auto-select first file when files load.

- [ ] **Step 5: Wire ChangesView into AppShell**

In `AppShell.tsx`, replace the "Changes coming soon" placeholder with `<ChangesView>` when the active tab is "changes". Pass the active worktree's ID and repo path.

Update the Changes tab badge to show actual file count from the diff data (pass count up via store or local state).

- [ ] **Step 6: Test the diff viewer**

Run the app. Select a worktree that has changes vs main. Click the "Changes" tab. Verify:
- Files appear in the left panel
- Clicking a file shows its diff on the right
- "All changes" and "Commit by commit" toggle works
- Commit stepper navigates between commits

- [ ] **Step 7: Commit**

```bash
git add src/components/changes/ src/components/layout/AppShell.tsx
git commit -m "feat: add GitHub Desktop-style diff viewer with file list and commit navigation"
```

---

## Task 8: Inline Annotations

**Files:**
- Create: `src/components/changes/AnnotationBubble.tsx`
- Create: `src/components/changes/AnnotationInput.tsx`
- Modify: `src/components/changes/DiffViewer.tsx`
- Modify: `src/components/changes/ChangesView.tsx`
- Modify: `src/components/layout/StatusBar.tsx`
- Modify: `src/components/terminal/TerminalView.tsx`

- [ ] **Step 1: Create AnnotationInput**

`src/components/changes/AnnotationInput.tsx`

Props: `onSubmit: (text: string) => void`, `onCancel: () => void`

Renders inline below a diff line:
- Text input with placeholder "Add a comment..."
- Submit on Enter, cancel on Escape
- Auto-focuses on mount
- Subtle border and background matching the annotation bubble style

- [ ] **Step 2: Create AnnotationBubble**

`src/components/changes/AnnotationBubble.tsx`

Props: `annotation: Annotation`, `onDelete: (id: string) => void`

Renders inline below the annotated diff line:
- Left: small "C" avatar circle (accent color)
- Comment text
- Right: X button to delete
- Subtle hint text: "annotations attach to your next terminal message"
- Blue-tinted background with border

- [ ] **Step 3: Wire annotations into DiffViewer**

Update `DiffViewer.tsx`:
- After each diff line, check if there's an annotation at that line number
- If yes, render `<AnnotationBubble>`
- If `activeAnnotationLine` matches the current line, render `<AnnotationInput>` below it
- Clicking a line sets `activeAnnotationLine`

- [ ] **Step 4: Wire annotation state in ChangesView**

In `ChangesView.tsx`:
- Read annotations from store: `useWorkspaceStore(s => s.annotations[worktreeId] || [])`
- On annotation submit: call `addAnnotation()` with a new Annotation object (generate ID with `crypto.randomUUID()`)
- On annotation delete: call `removeAnnotation()`
- Filter annotations to current commit when in commit-by-commit mode

- [ ] **Step 5: Show annotation count in StatusBar**

Update `StatusBar.tsx`: read annotation count for active worktree from store. If > 0, show a badge: "N annotations" with blue tint.

- [ ] **Step 6: Add "Send feedback" bar above terminal**

In `TerminalView.tsx`: when annotations exist for this worktree (read from store), render a small bar above the xterm container:

```
┌─────────────────────────────────────────────┐
│ 💬 3 annotations  [Send as feedback]  [Clear] │
└─────────────────────────────────────────────┘
│                                               │
│  Terminal (xterm)                              │
```

"Send as feedback" button: formats all annotations as `\nFeedback on <filePath>:<lineNumber> — <text>\n` (one per line), writes the formatted text into the PTY via `writePty()`, then calls `clearAnnotations(worktreeId)`.

"Clear" button: calls `clearAnnotations(worktreeId)` without sending.

This is simpler and more reliable than intercepting xterm input (which fires per-keystroke via `onData`). The user explicitly chooses when to send feedback.

- [ ] **Step 7: Test the full annotation flow**

1. Open Changes tab, click a diff line → input appears
2. Type a comment, press Enter → bubble appears
3. Add annotations on multiple files
4. Switch to Terminal tab → annotation indicator visible
5. Interact with the annotation send mechanism → annotations sent as formatted text to PTY
6. Annotations cleared after sending

- [ ] **Step 8: Commit**

```bash
git add src/components/changes/ src/components/layout/StatusBar.tsx src/components/terminal/TerminalView.tsx
git commit -m "feat: add inline diff annotations that attach to terminal messages"
```

---

## Task 9: Empty States & New Worktree Dialog Update

**Files:**
- Create: `src/components/empty/WelcomeScreen.tsx`
- Create: `src/components/empty/EmptyWorkspace.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/kanban/CreateWorktreeDialog.tsx` — update styling

- [ ] **Step 1: Create WelcomeScreen**

`src/components/empty/WelcomeScreen.tsx` — First launch, no repo configured.

Full-width centered content:
- Cat logo large (~80px) with gradient background and rounded corners (use logo.png or render SVG with gradient)
- "Welcome to Alfredo" heading
- Subtitle: "Manage your AI coding agents across worktrees. Get started by opening a repository."
- "Open repository..." primary Button
- "or drag a folder here" hint text in muted color
- The "Open repository" button should trigger a Tauri file dialog (use `@tauri-apps/plugin-dialog` or the existing config save mechanism)

- [ ] **Step 2: Create EmptyWorkspace**

`src/components/empty/EmptyWorkspace.tsx` — Repo configured but no worktrees.

Centered in main content area:
- Cat emoji or small logo
- "No worktrees yet" heading
- "Create a worktree to start an agent session. Each worktree gets its own terminal and branch." description
- "Create first worktree" primary Button → opens CreateWorktreeDialog
- Tip: "Tip: configure setup scripts in workspace settings to automate npm install etc."

- [ ] **Step 3: Wire empty states into AppShell**

In `AppShell.tsx`:
- If no repo configured (check config): render the AppShell with sidebar (minimal — logo + empty state text) and `<WelcomeScreen />` in the main content area. The sidebar stays visible per spec.
- If repo configured but `worktrees.length === 0` and no `activeWorktreeId`: render `<EmptyWorkspace />` in the main content area (sidebar shows "In progress" group, empty)

- [ ] **Step 4: Update CreateWorktreeDialog styling**

Move `CreateWorktreeDialog` from `src/components/kanban/` to `src/components/sidebar/` (or keep in place and update imports). Update card-style source selector to match spec mockup (segmented button style instead of tabs). Add the setup scripts hint line.

- [ ] **Step 5: Verify empty states**

Run the app with no saved config → WelcomeScreen appears. Configure a repo with no worktrees → EmptyWorkspace appears. Create a worktree → sidebar + terminal layout appears.

- [ ] **Step 6: Commit**

```bash
git add src/components/empty/ src/components/layout/AppShell.tsx src/components/kanban/CreateWorktreeDialog.tsx
git commit -m "feat: add welcome screen and empty workspace states"
```

---

## Task 10: Keyboard Shortcuts & Navigation

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx`
- Modify: `src/components/layout/AppShell.tsx`

- [ ] **Step 1: Add keyboard navigation to Sidebar**

In `Sidebar.tsx`, add a `useEffect` that listens for keydown events:

- `ArrowUp` / `ArrowDown`: move selection through the flat list of worktrees (across groups). Update `activeWorktreeId` in store.
- `Cmd+1` through `Cmd+9`: jump to worktree by index (1-indexed, flattened across groups in display order).

Only active when sidebar is focused or when no input element is focused (check `document.activeElement`).

- [ ] **Step 2: Add tab switching shortcut**

In `AppShell.tsx`, listen for:
- `Cmd+Shift+T`: switch to Terminal tab
- `Cmd+Shift+C`: switch to Changes tab

(Or simpler: just `Cmd+[` and `Cmd+]` to toggle between tabs.)

- [ ] **Step 3: Test keyboard navigation**

Verify: arrow keys move between agents, Cmd+1 jumps to first agent, tab switching shortcuts work. Ensure shortcuts don't fire when typing in an input field.

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar/Sidebar.tsx src/components/layout/AppShell.tsx
git commit -m "feat: add keyboard shortcuts for agent navigation and tab switching"
```

---

## Task 11: Cleanup — Remove Old Kanban Code

**Files:**
- Delete: `src/components/kanban/KanbanBoard.tsx`
- Delete: `src/components/kanban/KanbanColumn.tsx`
- Delete: `src/components/kanban/WorktreeCard.tsx`
- Delete: `src/components/settings/SettingsDialog.tsx`
- Delete: `src/components/terminal/TerminalHeader.tsx`
- Delete: `src/components/Logo.tsx`

- [ ] **Step 1: Remove deleted files**

```bash
rm src/components/kanban/KanbanBoard.tsx
rm src/components/kanban/KanbanColumn.tsx
rm src/components/kanban/WorktreeCard.tsx
rm src/components/settings/SettingsDialog.tsx
rm src/components/terminal/TerminalHeader.tsx
rm src/components/Logo.tsx
```

- [ ] **Step 2: Remove any remaining imports of deleted files**

Search the codebase for imports of the deleted files. Remove or update any remaining references. The main ones should already be gone from earlier tasks.

Run: `npx tsc --noEmit` — verify no import errors.

- [ ] **Step 3: Clean up kanban directory and barrel exports**

```bash
# Keep CreateWorktreeDialog if it wasn't moved
ls src/components/kanban/
# If only CreateWorktreeDialog remains, update or delete index.ts to only export it
# If empty, remove the directory: rm -r src/components/kanban
```

If `src/components/kanban/index.ts` exists, update it to only export remaining files, or delete it if the directory is empty.

- [ ] **Step 4: Final TypeScript and lint check**

Run: `npx tsc --noEmit`
Expected: Clean compile, no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove old kanban board, split settings dialog, and terminal header"
```

---

## Task 12: Visual Polish & Integration Testing

- [ ] **Step 1: Test all 8 themes**

Open Global Settings → Appearance. Click each theme. Verify:
- All backgrounds, text, borders, accents change correctly
- Status dots remain readable against all backgrounds
- Diff viewer additions/deletions are visible in all themes
- Terminal text is readable in all themes

- [ ] **Step 2: Test sidebar interactions**

- Create 3-4 worktrees
- Verify they appear in "In progress" by default
- Drag one to "Blocked" → group appears, item moves
- Release → "Blocked" stays visible (has item), other empty groups hide
- Click different agents → terminal switches, session persists

- [ ] **Step 3: Test diff viewer end-to-end**

- Make changes in a worktree (via terminal)
- Switch to Changes tab → files appear
- Toggle between "All changes" and "Commit by commit"
- Add inline annotations on diff lines
- Switch to Terminal tab → annotation indicator shows
- Verify annotation send mechanism works

- [ ] **Step 4: Test empty states**

- Fresh app → Welcome screen appears
- Configure repo → Empty workspace appears
- Create worktree → full layout appears
- Delete all worktrees → Empty workspace reappears

- [ ] **Step 5: Test keyboard shortcuts**

- Arrow keys navigate agents in sidebar
- Cmd+1/2/3 jump to specific agents
- Tab switching shortcuts work

- [ ] **Step 6: Fix any visual issues found during testing**

Address spacing, alignment, color contrast, or animation issues discovered.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "fix: visual polish and integration testing fixes"
```

---

## Task 13: Native Notifications with Sound Selection

**Files:**
- Create: `src/components/settings/NotificationSettings.tsx`
- Create: `src/hooks/useNotifications.ts`
- Create: `src/assets/sounds/` (directory with bundled notification sounds)
- Modify: `src/types.ts` — add notification config to AppConfig
- Modify: `src/App.tsx` — activate notifications hook
- Modify: `src/components/settings/GlobalSettingsDialog.tsx` — wire Notifications tab
- Modify: `src-tauri/tauri.conf.json` — add notification plugin if needed

- [ ] **Step 1: Add notification types to AppConfig**

In `src/types.ts`, extend `AppConfig`:

```typescript
export interface NotificationConfig {
  enabled: boolean;
  sound: string; // sound ID
  notifyOnWaiting: boolean; // agent switches to "waiting for input"
  notifyOnIdle: boolean; // agent finishes work (switches to "idle")
  notifyOnError: boolean; // agent encounters error
}
```

Add `notifications?: NotificationConfig` to `AppConfig`.

- [ ] **Step 2: Bundle notification sound files**

Create `src/assets/sounds/` with 5-6 short notification sounds (.mp3 files, <1 second each). Use distinct, pleasant tones:

```
src/assets/sounds/
  chime.mp3        — gentle bell chime (default)
  pop.mp3          — soft pop/bubble
  ding.mp3         — classic notification ding
  meow.mp3         — cat meow (on brand!)
  ping.mp3         — subtle ping
  woodblock.mp3    — soft wooden tap
```

These should be royalty-free sounds. The implementer can source them from freesound.org or generate simple tones. Keep file sizes tiny (<50KB each).

- [ ] **Step 3: Create useNotifications hook**

`src/hooks/useNotifications.ts`:

- Reads notification config from app config (load once on mount)
- Watches the `worktrees` array in Zustand for `agentStatus` changes
- When an agent transitions TO `"waitingForInput"` (and `notifyOnWaiting` is enabled):
  - Send native notification via `@tauri-apps/plugin-notification`: title "Alfredo", body "{branch} needs your input"
  - Play selected sound via `new Audio(soundPath).play()`
- When an agent transitions TO `"idle"` (and `notifyOnIdle` is enabled):
  - Notify: "{branch} finished"
  - Play sound
- When an agent transitions TO error state (and `notifyOnError` is enabled):
  - Notify: "{branch} encountered an error"
  - Play sound
- Track previous agent states to detect transitions (not just current state). Use a `useRef<Record<string, AgentState>>()` to compare.
- Don't notify on initial load (skip the first render's state).

```typescript
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
```

- [ ] **Step 4: Create NotificationSettings component**

`src/components/settings/NotificationSettings.tsx`:

- **Enable notifications** toggle (master switch)
- **Notification triggers** (when enabled):
  - "Agent waiting for input" toggle (default: on)
  - "Agent finished work" toggle (default: on)
  - "Agent error" toggle (default: off)
- **Notification sound** picker:
  - Grid/list of available sounds with preview button (small play icon)
  - Click play → plays the sound via `new Audio()`
  - Selected sound highlighted
  - "None" option to disable sound
- **Test notification** button — sends a test notification with the selected sound

On first enable: request notification permission via Tauri's `requestPermission()`. If denied, show a message explaining how to enable in System Settings.

- [ ] **Step 5: Wire notifications into the app**

In `src/App.tsx`, add `useNotifications()` alongside the existing `useGithubSync()`:

```tsx
function App() {
  useGithubSync();
  useNotifications();
  return <AppShell />;
}
```

In `GlobalSettingsDialog.tsx`, wire the Notifications tab to render `<NotificationSettings />` (replace the placeholder from Task 5).

- [ ] **Step 6: Add Tauri notification plugin if not already configured**

Check `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`. If `tauri-plugin-notification` is not already a dependency:

```bash
cd src-tauri && cargo add tauri-plugin-notification
```

Add the plugin to the Tauri builder in `lib.rs` and add the permission in `tauri.conf.json` capabilities.

- [ ] **Step 7: Test notifications**

1. Open Settings → Notifications → enable
2. Select a sound, click preview → sound plays
3. Start an agent in a worktree, let it finish → notification appears with sound
4. Agent waiting for input → notification appears
5. Disable notifications → no more notifications
6. Test with "None" sound → silent notification (OS notification only)

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useNotifications.ts src/components/settings/NotificationSettings.tsx src/assets/sounds/ src/types.ts src/App.tsx src/components/settings/GlobalSettingsDialog.tsx src-tauri/
git commit -m "feat: add native notifications with selectable sounds for agent state changes"
```

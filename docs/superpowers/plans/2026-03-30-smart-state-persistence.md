# Smart State Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist UI state (diff view mode, kanban column collapses, column overrides, sidebar state, changes view mode, seen worktrees) across app restarts, and auto-resume Claude conversations on tab focus.

**Architecture:** Extend existing `SessionData` interface for per-worktree state and `GlobalAppConfig` for global preferences. No new persistence infrastructure — piggyback on the 30-second auto-save and on-quit save already in place. Auto-resume sends `/resume\n` to newly-spawned Claude PTYs after detecting shell readiness.

**Tech Stack:** TypeScript, Zustand, Tauri v2 (Rust backend), serde

---

## File Structure

**Modified files:**

| File | Responsibility |
|------|---------------|
| `src/services/SessionPersistence.ts` | Add new fields to `SessionData`, add getter params to `saveAllSessions` |
| `src/hooks/useSessionRestore.ts` | Restore new per-worktree fields on load |
| `src/components/layout/AppShell.tsx` | Pass new getter functions to `collectAndSaveAllSessions` |
| `src/stores/workspaceStore.ts` | Add `changesViewMode` per-worktree state |
| `src/stores/prStore.ts` | Restructure `columnOverrides` to include `githubStateWhenSet` |
| `src/components/sidebar/StatusGroup.tsx` | Read/write collapse state from app config |
| `src/components/changes/ChangesView.tsx` | Read/write `changesViewMode` from workspace store |
| `src/hooks/useAppConfig.ts` | Add helper for updating individual global config fields |
| `src/hooks/usePty.ts` | Add auto-resume logic for Claude tabs |
| `src/types.ts` | Add new fields to `GlobalAppConfig` TS interface |
| `src-tauri/src/types.rs` | Add new fields to `GlobalAppConfig` Rust struct |

---

### Task 1: Extend SessionData with new per-worktree fields

**Files:**
- Modify: `src/services/SessionPersistence.ts:4-19` (SessionData interface)
- Modify: `src/services/SessionPersistence.ts:52-97` (saveAllSessions function)

- [ ] **Step 1: Add new fields to SessionData interface**

In `src/services/SessionPersistence.ts`, add the new optional fields to the `SessionData` interface:

```typescript
export interface SessionData {
  tabs: WorkspaceTab[];
  activeTabId: string;
  terminals: Record<string, { scrollback: string }>;
  savedAt: string;
  /** Layout tree (added in split-view feature). */
  layout?: LayoutNode;
  /** Pane state (added in split-view feature). */
  panes?: Record<string, Pane>;
  /** Active pane ID (added in split-view feature). */
  activePaneId?: string;
  /** Last-known kanban column so worktrees render in the correct group on restore. */
  column?: KanbanColumn;
  /** Diff view mode (split or unified) for this worktree. */
  diffViewMode?: DiffViewMode;
  /** Manual column override with the GitHub state it was set against. */
  columnOverride?: { column: KanbanColumn; githubStateWhenSet: string } | null;
  /** PR panel expanded or collapsed. */
  prPanelState?: PrPanelState;
  /** Changes tab view mode (changes or commits). */
  changesViewMode?: "changes" | "commits";
  /** Whether the user has dismissed the idle indicator for this worktree. */
  seenWorktree?: boolean;
}
```

Add the missing type imports at the top of the file:

```typescript
import type { WorkspaceTab, LayoutNode, Pane, KanbanColumn, DiffViewMode, PrPanelState } from "../types";
```

- [ ] **Step 2: Add new getter parameters to saveAllSessions**

Add five new getter parameters to `saveAllSessions`:

```typescript
export async function saveAllSessions(
  repoPath: string,
  worktreeIds: string[],
  getTabs: (worktreeId: string) => WorkspaceTab[],
  getActiveTabId: (worktreeId: string) => string,
  getScrollback: (tabId: string) => string,
  getLayout?: (worktreeId: string) => LayoutNode | undefined,
  getPanes?: (worktreeId: string) => Record<string, Pane> | undefined,
  getActivePaneId?: (worktreeId: string) => string | undefined,
  getColumn?: (worktreeId: string) => KanbanColumn | undefined,
  getDiffViewMode?: (worktreeId: string) => DiffViewMode | undefined,
  getColumnOverride?: (worktreeId: string) => { column: KanbanColumn; githubStateWhenSet: string } | null | undefined,
  getPrPanelState?: (worktreeId: string) => PrPanelState | undefined,
  getChangesViewMode?: (worktreeId: string) => "changes" | "commits" | undefined,
  getSeenWorktree?: (worktreeId: string) => boolean | undefined,
): Promise<void> {
```

Then in the `data` object construction inside the `.map()`, add the new fields:

```typescript
    const data: SessionData = {
      tabs,
      activeTabId: getActiveTabId(wtId),
      terminals,
      savedAt: new Date().toISOString(),
      layout: getLayout?.(wtId),
      panes,
      activePaneId: getActivePaneId?.(wtId),
      column: getColumn?.(wtId),
      diffViewMode: getDiffViewMode?.(wtId),
      columnOverride: getColumnOverride?.(wtId),
      prPanelState: getPrPanelState?.(wtId),
      changesViewMode: getChangesViewMode?.(wtId),
      seenWorktree: getSeenWorktree?.(wtId),
    };
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Errors in `AppShell.tsx` (missing new arguments) — that's expected, will fix in Task 5.

- [ ] **Step 4: Commit**

```bash
git add src/services/SessionPersistence.ts
git commit -m "feat(persistence): extend SessionData with new per-worktree fields"
```

---

### Task 2: Add changesViewMode to workspace store

**Files:**
- Modify: `src/stores/workspaceStore.ts:6` (imports), `:10` (state), `:38` (actions), `:100` (initial state), `:220+` (implementation)

- [ ] **Step 1: Add changesViewMode state and actions to the store**

In `src/stores/workspaceStore.ts`, add to the `WorkspaceState` interface:

```typescript
  /** Changes tab view mode per worktree. Keyed by worktreeId. */
  changesViewMode: Record<string, "changes" | "commits">;
```

Add the action:

```typescript
  setChangesViewMode: (worktreeId: string, mode: "changes" | "commits") => void;
```

Add the initial state alongside `diffViewMode`:

```typescript
  changesViewMode: {},
```

Add the implementation alongside `setDiffViewMode`:

```typescript
  setChangesViewMode: (worktreeId, mode) =>
    set((state) => ({
      changesViewMode: { ...state.changesViewMode, [worktreeId]: mode },
    })),
```

In `clearStore`, add `changesViewMode: {}`.

- [ ] **Step 2: Wire ChangesView to use store instead of local state**

In `src/components/changes/ChangesView.tsx`, replace the local `useState` for viewMode with the store:

Replace:
```typescript
const [viewMode, setViewMode] = useState<ViewMode>("changes");
```

With:
```typescript
const viewMode = useWorkspaceStore((s) => s.changesViewMode[worktreeId]) ?? "changes";
const setChangesViewMode = useWorkspaceStore((s) => s.setChangesViewMode);
```

Then update the `handleViewModeChange` callback to use the store:

Replace:
```typescript
const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
```

With:
```typescript
const handleViewModeChange = useCallback((mode: ViewMode) => {
    setChangesViewMode(worktreeId, mode);
```

Remove the `useState` import for `ViewMode` if it's no longer used for local state (keep it if `useState` is used for other things in the component — it is, so just remove the `ViewMode` usage from state).

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Should compile (or only show pre-existing errors from Task 1).

- [ ] **Step 4: Commit**

```bash
git add src/stores/workspaceStore.ts src/components/changes/ChangesView.tsx
git commit -m "feat(persistence): move changesViewMode to workspace store"
```

---

### Task 3: Restructure column overrides in prStore

**Files:**
- Modify: `src/stores/prStore.ts:23-24` (columnOverrides type), `:112-116` (setManualColumn), `:160-168` (applyPrUpdates override clearing)

- [ ] **Step 1: Change columnOverrides type to include githubStateWhenSet**

In `src/stores/prStore.ts`, change the type of `columnOverrides`:

From:
```typescript
  columnOverrides: Record<string, KanbanColumn>;
```

To:
```typescript
  columnOverrides: Record<string, { column: KanbanColumn; githubStateWhenSet: string }>;
```

- [ ] **Step 2: Update setManualColumn to capture current PR state**

The `setManualColumn` action needs to know the current PR state. Add a second parameter:

From:
```typescript
  setManualColumn: (id: string, column: KanbanColumn) => void;
```

To:
```typescript
  setManualColumn: (id: string, column: KanbanColumn, githubStateWhenSet: string) => void;
```

Update the implementation:

```typescript
  setManualColumn: (id, column, githubStateWhenSet) =>
    set((state) => ({
      columnOverrides: { ...state.columnOverrides, [id]: { column, githubStateWhenSet } },
    })),
```

- [ ] **Step 3: Update applyPrUpdates to use new override shape**

In `applyPrUpdates`, update the override clearing logic. The current code at ~line 163:

From:
```typescript
      if (previousStateKey && previousStateKey !== currentStateKey) {
        delete newOverrides[wt.id];
      }
```

To:
```typescript
      const override = newOverrides[wt.id];
      if (override && override.githubStateWhenSet !== currentStateKey) {
        delete newOverrides[wt.id];
      }
```

And update the column resolution line:

From:
```typescript
      const column = newOverrides[wt.id] ?? pr.autoColumn;
```

To:
```typescript
      const column = newOverrides[wt.id]?.column ?? pr.autoColumn;
```

- [ ] **Step 4: Find and update all callers of setManualColumn**

Search for `setManualColumn` usage in components. The drag-and-drop handler needs to pass the current GitHub state. Find the component that calls `setManualColumn` and update it to pass `prStateKey`. The caller likely has access to the worktree's PR status — use `prStateKey` logic:

```typescript
// Compute the state key from the worktree's current PR status
const stateKey = wt.prStatus?.merged ? "merged" : wt.prStatus?.draft ? "draft" : "open";
prStore.setManualColumn(wt.id, targetColumn, stateKey);
```

Also update `workspaceStore.setManualColumn` to delegate to `prStore.setManualColumn` if that's how it's wired, or update it similarly.

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Should compile cleanly (or only pre-existing errors).

- [ ] **Step 6: Commit**

```bash
git add src/stores/prStore.ts
git commit -m "feat(persistence): restructure columnOverrides to track githubStateWhenSet"
```

---

### Task 4: Add new fields to GlobalAppConfig (TypeScript + Rust)

**Files:**
- Modify: `src/types.ts:302-321` (GlobalAppConfig interface)
- Modify: `src-tauri/src/types.rs:297-334` (GlobalAppConfig struct)

- [ ] **Step 1: Add fields to TypeScript GlobalAppConfig**

In `src/types.ts`, add to the `GlobalAppConfig` interface:

```typescript
export interface GlobalAppConfig {
  repos: RepoEntry[];
  activeRepo: string | null;
  theme: string | null;
  notifications: NotificationConfig | null;
  selectedRepos: string[];
  displayName: string | null;
  repoColors: Record<string, string>;
  repoDisplayNames: Record<string, string>;
  preferredEditor: string;
  customEditorPath: string | null;
  preferredTerminal: string;
  customTerminalPath: string | null;
  model?: string | null;
  effort?: string | null;
  permissionMode?: string | null;
  dangerouslySkipPermissions?: boolean | null;
  outputStyle?: string | null;
  verbose?: boolean | null;
  /** Default diff view mode for new worktrees. */
  defaultDiffViewMode?: DiffViewMode;
  /** Whether to auto-resume Claude conversations on tab focus. */
  autoResume?: boolean;
  /** Which kanban column groups are collapsed in the sidebar. */
  collapsedKanbanColumns?: string[];
  /** Whether the sidebar starts collapsed. */
  sidebarCollapsed?: boolean;
}
```

- [ ] **Step 2: Add fields to Rust GlobalAppConfig**

In `src-tauri/src/types.rs`, add to the `GlobalAppConfig` struct:

```rust
    #[serde(default)]
    pub default_diff_view_mode: Option<String>,
    #[serde(default)]
    pub auto_resume: Option<bool>,
    #[serde(default)]
    pub collapsed_kanban_columns: Vec<String>,
    #[serde(default)]
    pub sidebar_collapsed: Option<bool>,
```

- [ ] **Step 3: Verify both TypeScript and Rust compile**

Run: `npx tsc --noEmit && cd src-tauri && cargo clippy`
Expected: TypeScript may have pre-existing errors from Task 1. Rust should compile cleanly.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src-tauri/src/types.rs
git commit -m "feat(persistence): add smart persistence fields to GlobalAppConfig"
```

---

### Task 5: Wire up collectAndSaveAllSessions with new getters

**Files:**
- Modify: `src/components/layout/AppShell.tsx:33-48` (collectAndSaveAllSessions)

- [ ] **Step 1: Add new getter functions to collectAndSaveAllSessions**

In `src/components/layout/AppShell.tsx`, update the `collectAndSaveAllSessions` function to pass new getters:

```typescript
function collectAndSaveAllSessions(repoPath: string) {
  const state = useWorkspaceStore.getState();
  const tabState = useTabStore.getState();
  const prState = usePrStore.getState();
  const worktreeIds = state.worktrees.map((wt) => wt.id);
  return saveAllSessions(
    repoPath,
    worktreeIds,
    (wtId) => tabState.tabs[wtId] ?? [],
    (wtId) => tabState.activeTabId[wtId] ?? "",
    (tabId) => sessionManager.getBufferedOutputBase64(tabId),
    (wtId) => useLayoutStore.getState().layout[wtId],
    (wtId) => useLayoutStore.getState().panes[wtId],
    (wtId) => useLayoutStore.getState().activePaneId[wtId],
    (wtId) => state.worktrees.find((wt) => wt.id === wtId)?.column,
    (wtId) => state.diffViewMode[wtId],
    (wtId) => prState.columnOverrides[wtId] ?? null,
    (wtId) => prState.prPanelState[wtId],
    (wtId) => state.changesViewMode[wtId],
    (wtId) => state.seenWorktrees.has(wtId) || undefined,
  );
}
```

Add `usePrStore` import at the top if not already imported:

```typescript
import { usePrStore } from "../../stores/prStore";
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Should compile cleanly now that all arguments match.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/AppShell.tsx
git commit -m "feat(persistence): pass new state getters to session save"
```

---

### Task 6: Restore new per-worktree fields on session load

**Files:**
- Modify: `src/hooks/useSessionRestore.ts:60-88` (session restore loop)

- [ ] **Step 1: Restore diffViewMode, changesViewMode, seenWorktree from session**

In `src/hooks/useSessionRestore.ts`, after the existing column restore block (`if (session.column) { ... }`), add restoration for the new fields:

```typescript
              if (session.column) {
                updateWorktree(wt.id, { column: session.column });
              }

              // Restore per-worktree UI state
              if (session.diffViewMode) {
                useWorkspaceStore.getState().setDiffViewMode(wt.id, session.diffViewMode);
              }
              if (session.changesViewMode) {
                useWorkspaceStore.getState().setChangesViewMode(wt.id, session.changesViewMode);
              }
              if (session.seenWorktree) {
                markWorktreeSeen(wt.id);
              }

              // Restore column override
              if (session.columnOverride) {
                usePrStore.getState().setManualColumn(
                  wt.id,
                  session.columnOverride.column,
                  session.columnOverride.githubStateWhenSet,
                );
              }

              // Restore PR panel state
              if (session.prPanelState) {
                usePrStore.getState().setPrPanelState(wt.id, session.prPanelState);
              }
```

Add the `usePrStore` import:

```typescript
import { usePrStore } from "../stores/prStore";
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean compile.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSessionRestore.ts
git commit -m "feat(persistence): restore per-worktree UI state from session files"
```

---

### Task 7: Add updateConfig helper to useAppConfig

**Files:**
- Modify: `src/hooks/useAppConfig.ts:89-96` (add new helper)

- [ ] **Step 1: Add a generic updateConfig callback**

In `src/hooks/useAppConfig.ts`, add a new `updateConfig` callback that allows patching any fields, and expand the return value:

```typescript
  const updateConfig = useCallback(async (patch: Partial<GlobalAppConfig>) => {
    if (!config) return;
    const updated = { ...config, ...patch };
    await saveAppConfig(updated);
    setConfig(updated);
  }, [config]);
```

Add it to the return object:

```typescript
  return {
    config,
    loading,
    error,
    clearError,
    activeRepo,
    repos,
    addRepo,
    removeRepo,
    switchRepo,
    updateRepoMode,
    updateGlobalSettings,
    updateConfig,
    selectedRepos: config?.selectedRepos ?? [],
    displayName: config?.displayName ?? null,
    repoColors: config?.repoColors ?? {},
    repoDisplayNames: config?.repoDisplayNames ?? {},
    toggleRepo,
    setWorkspaceName,
    setRepoDisplayName,
  } as const;
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useAppConfig.ts
git commit -m "feat(persistence): add generic updateConfig helper to useAppConfig"
```

---

### Task 8: Persist kanban column collapse state

**Files:**
- Modify: `src/components/sidebar/StatusGroup.tsx:1,48-63` (replace useState with config)

- [ ] **Step 1: Replace local useState with app config**

In `src/components/sidebar/StatusGroup.tsx`, the component needs access to the global collapsed columns list. Since `useAppConfig` is a hook that loads from the backend, and `StatusGroup` renders many times, it's more efficient to pass the collapse state and toggle as props from the parent.

Add new props to `StatusGroupProps`:

```typescript
interface StatusGroupProps {
  column: KanbanColumn;
  worktrees: Worktree[];
  activeWorktreeId: string | null;
  onSelectWorktree: (id: string) => void;
  onDeleteWorktree?: (id: string) => void;
  onArchiveWorktree?: (id: string) => void;
  forceVisible?: boolean;
  dragActiveId?: string | null;
  dragHeight?: number | null;
  repoColors?: Record<string, string>;
  repoDisplayNames?: Record<string, string>;
  showRepoTags?: boolean;
  repoIndexMap?: Record<string, number>;
  isCollapsed?: boolean;
  onToggleCollapsed?: (column: KanbanColumn) => void;
}
```

Replace the `useState` line:

From:
```typescript
  const [isCollapsed, setIsCollapsed] = useState(false);
```

To:
```typescript
  const collapsed = isCollapsed ?? false;
```

Update the button `onClick`:

From:
```typescript
        onClick={() => setIsCollapsed((prev) => !prev)}
```

To:
```typescript
        onClick={() => onToggleCollapsed?.(column)}
```

And replace `{!isCollapsed && (` with `{!collapsed && (`.

Remove the `useState` import if it's no longer used (it isn't used elsewhere in this component).

- [ ] **Step 2: Pass collapse state from the parent component**

Find the parent that renders `StatusGroup` (likely in the sidebar/kanban board). It should read `collapsedKanbanColumns` from `useAppConfig` and pass down:

```typescript
const { config, updateConfig } = useAppConfig();
const collapsedColumns = config?.collapsedKanbanColumns ?? [];

const handleToggleCollapsed = useCallback((column: KanbanColumn) => {
  const current = config?.collapsedKanbanColumns ?? [];
  const next = current.includes(column)
    ? current.filter((c) => c !== column)
    : [...current, column];
  updateConfig({ collapsedKanbanColumns: next });
}, [config, updateConfig]);
```

Then pass to each `StatusGroup`:

```tsx
<StatusGroup
  // ...existing props
  isCollapsed={collapsedColumns.includes(column)}
  onToggleCollapsed={handleToggleCollapsed}
/>
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean compile.

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar/StatusGroup.tsx
git commit -m "feat(persistence): persist kanban column collapse state in app config"
```

---

### Task 9: Persist sidebar collapsed state

**Files:**
- Modify: `src/components/layout/AppShell.tsx` or wherever sidebar toggle is handled

- [ ] **Step 1: Initialize sidebar state from app config on load**

Find where `useWorkspaceStore`'s `sidebarCollapsed` is first used/set. In `AppShell.tsx` or a top-level component, after config loads, sync the store:

```typescript
// Restore sidebar collapsed state from config
useEffect(() => {
  if (config?.sidebarCollapsed != null) {
    useWorkspaceStore.getState().setSidebarCollapsed(config.sidebarCollapsed);
  }
}, [config?.sidebarCollapsed]);
```

This should only run once on initial load. Use a ref to gate it:

```typescript
const sidebarRestored = useRef(false);
useEffect(() => {
  if (!sidebarRestored.current && config?.sidebarCollapsed != null) {
    sidebarRestored.current = true;
    useWorkspaceStore.getState().setSidebarCollapsed(config.sidebarCollapsed);
  }
}, [config]);
```

- [ ] **Step 2: Save sidebar state to config on toggle**

Find where `toggleSidebar` is called. After the toggle, persist to config:

```typescript
const handleToggleSidebar = useCallback(() => {
  useWorkspaceStore.getState().toggleSidebar();
  const collapsed = useWorkspaceStore.getState().sidebarCollapsed;
  updateConfig({ sidebarCollapsed: collapsed });
}, [updateConfig]);
```

Or subscribe to the store and save when `sidebarCollapsed` changes:

```typescript
useEffect(() => {
  const unsub = useWorkspaceStore.subscribe(
    (state) => state.sidebarCollapsed,
    (collapsed) => {
      updateConfig({ sidebarCollapsed: collapsed });
    },
  );
  return unsub;
}, [updateConfig]);
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(persistence): persist sidebar collapsed state in app config"
```

---

### Task 10: Auto-resume Claude conversations on tab focus

**Files:**
- Modify: `src/hooks/usePty.ts:150-167` (startupCommand / post-spawn logic)

- [ ] **Step 1: Add auto-resume logic for Claude tabs**

In `src/hooks/usePty.ts`, after the PTY session is attached and ready, add auto-resume logic. The existing `startupCommand` mechanism already waits for shell output before writing — we can reuse the same pattern.

After the `setIsConnected(true)` line (~line 149), add:

```typescript
      // Auto-resume: if this is a reconnected Claude tab with scrollback,
      // send /resume after the shell is ready.
      const shouldAutoResume =
        mode === "claude" &&
        !startupCommandRef.current && // Don't interfere with explicit startup commands
        session.sessionId &&
        session.hasScrollback; // Set by sessionManager when restoring from saved session
```

Wait — we need to know if this session was restored from saved scrollback. Check if `sessionManager` tracks this. The session has scrollback written via `loadScrollbackOnly()` during restore. We need a flag on `ManagedSession` to indicate it was restored.

In `src/services/sessionManager.ts`, add a `restoredFromScrollback` boolean to `ManagedSession`. Set it to `true` in `loadScrollbackOnly()`. Then in `getOrSpawn()`, when a new PTY is spawned for a session that has `restoredFromScrollback === true`, that's our signal to auto-resume.

In `usePty.ts`, after the existing startup command block:

```typescript
      // Auto-resume Claude conversations that have prior scrollback
      if (
        mode === "claude" &&
        !startupCommandRef.current &&
        session.sessionId &&
        session.restoredFromScrollback
      ) {
        // Check app config for autoResume preference
        const appConfig = await getAppConfig();
        if (appConfig.autoResume !== false) {
          let resumeAttempts = 0;
          const waitForReady = setInterval(() => {
            resumeAttempts++;
            const s = sessionRef.current;
            if (s && s.lastOutputAt > 0) {
              clearInterval(waitForReady);
              const bytes = Array.from(new TextEncoder().encode("/resume\n"));
              writePty(s.sessionId, bytes).catch(console.error);
              // Clear the flag so subsequent reconnects don't re-resume
              session.restoredFromScrollback = false;
            } else if (resumeAttempts >= 50) {
              clearInterval(waitForReady);
            }
          }, 100);
        }
      }
```

Import `getAppConfig` from `../../api`.

- [ ] **Step 2: Add restoredFromScrollback flag to ManagedSession**

In `src/services/sessionManager.ts`, add to the `ManagedSession` interface/type:

```typescript
  /** Whether this session was restored from saved scrollback (for auto-resume). */
  restoredFromScrollback: boolean;
```

Set it to `false` in `getOrSpawn` when creating a new session, and to `true` in `loadScrollbackOnly`.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean compile.

- [ ] **Step 4: Test manually**

1. Open app, start a Claude conversation, type something
2. Quit app
3. Reopen app, click into the Claude tab
4. Verify `/resume` is automatically sent after the prompt appears

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePty.ts src/services/sessionManager.ts
git commit -m "feat(persistence): auto-resume Claude conversations on tab focus"
```

---

### Task 11: Add autoResume toggle to settings

**Files:**
- Modify: the settings component (find the existing settings panel that shows editor/terminal preferences)

- [ ] **Step 1: Find the settings component**

Search for where `preferredEditor` or `preferredTerminal` is displayed in the settings UI. Add an "Auto-resume conversations" toggle in the same area.

- [ ] **Step 2: Add the toggle**

```tsx
<div className="flex items-center justify-between">
  <div>
    <div className="text-sm font-medium text-text-primary">Auto-resume conversations</div>
    <div className="text-xs text-text-tertiary">Automatically run /resume when opening a Claude tab with previous history</div>
  </div>
  <Toggle
    checked={config?.autoResume !== false}
    onChange={(checked) => updateConfig({ autoResume: checked })}
  />
</div>
```

Use whatever toggle/switch component the settings panel already uses for consistency.

- [ ] **Step 3: Add the default diff view mode setting**

In the same settings area:

```tsx
<div className="flex items-center justify-between">
  <div>
    <div className="text-sm font-medium text-text-primary">Default diff view</div>
    <div className="text-xs text-text-tertiary">Default view mode for new worktrees</div>
  </div>
  <div className="flex border border-border-default rounded overflow-hidden">
    <button
      className={`px-3 py-1 text-xs ${config?.defaultDiffViewMode !== "split" ? "bg-accent-primary/15 text-accent-primary" : "text-text-tertiary"}`}
      onClick={() => updateConfig({ defaultDiffViewMode: "unified" })}
    >
      Unified
    </button>
    <button
      className={`px-3 py-1 text-xs border-l border-border-default ${config?.defaultDiffViewMode === "split" ? "bg-accent-primary/15 text-accent-primary" : "text-text-tertiary"}`}
      onClick={() => updateConfig({ defaultDiffViewMode: "split" })}
    >
      Split
    </button>
  </div>
</div>
```

- [ ] **Step 4: Wire default diff view mode into ChangesView**

In `src/components/changes/ChangesView.tsx`, the diff view mode fallback should use the global default:

The current line:
```typescript
const diffViewMode = useWorkspaceStore((s) => s.diffViewMode[worktreeId]) ?? "unified";
```

Needs access to the global config default. Pass it as a prop from the parent, or read it from a context. The simplest approach: pass `defaultDiffViewMode` as a prop to `ChangesView` from whatever renders it, and use it as the fallback:

```typescript
const diffViewMode = useWorkspaceStore((s) => s.diffViewMode[worktreeId]) ?? defaultDiffViewMode ?? "unified";
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(persistence): add auto-resume and default diff view settings"
```

---

### Task 12: Final integration verification

- [ ] **Step 1: Full TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean compile.

- [ ] **Step 2: Cargo check**

Run: `cd src-tauri && cargo clippy`
Expected: Clean, no warnings.

- [ ] **Step 3: Manual smoke test**

1. Open app with existing worktrees
2. Change diff view to "split" on one worktree, leave another on "unified"
3. Collapse the "Done" kanban column
4. Collapse the sidebar
5. Switch a worktree to "commits" view in the changes tab
6. Drag a worktree to a different kanban column
7. Quit and reopen the app
8. Verify all state is restored:
   - Diff view modes per worktree ✓
   - Kanban column collapse ✓
   - Sidebar collapsed ✓
   - Changes view mode ✓
   - Column override ✓
9. Click a Claude tab with prior history → verify `/resume` auto-sends

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "fix(persistence): address integration issues from smoke test"
```

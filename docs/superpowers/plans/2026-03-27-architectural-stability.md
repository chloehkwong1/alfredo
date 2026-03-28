# Architectural Stability Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three root architectural causes of systemic instability: startup race condition, dual-authority agent state, and fragmented state stores.

**Architecture:** Three sequential fixes. RC2 (startup race) makes state server init synchronous so PTY spawns never race ahead. RC1 (agent state) replaces time-based arbitration with a simple boolean gate — hooks always win once active. RC3 (fragmented stores) introduces a `lifecycleManager` that coordinates workspaceStore, layoutStore, and SessionManager atomically, then migrates all callers away from manual multi-store coordination.

**Tech Stack:** Rust/Tauri backend, React/TypeScript frontend, Zustand stores

---

### Task 1: Fix Startup Race — Synchronous State Server Init

**Files:**
- Modify: `src-tauri/src/lib.rs:43-49`

The state server is spawned with `tauri::async_runtime::spawn` (fire-and-forget). The setup closure returns before `StateServerHandle` is managed. If the frontend restores sessions before the server binds, `spawn_pty` gets port 0 and hooks never arrive.

Fix: use `block_on` so the server is ready before setup returns.

- [ ] **Step 1: Replace async spawn with block_on in lib.rs**

In `src-tauri/src/lib.rs`, replace lines 43-49:

```rust
// Start the agent state HTTP server for hook callbacks
let handle = app.handle().clone();
tauri::async_runtime::spawn(async move {
    let state_handle = state_server::start().await;
    eprintln!("[alfredo] state server listening on port {}", state_handle.port);
    handle.manage(state_handle);
});
```

With:

```rust
// Start the agent state HTTP server for hook callbacks.
// block_on ensures the port is bound and StateServerHandle is managed
// before any PTY commands can run — prevents race with session restore.
let state_handle = tauri::async_runtime::block_on(state_server::start());
eprintln!("[alfredo] state server listening on port {}", state_handle.port);
app.manage(state_handle);
```

- [ ] **Step 2: Verify Rust compiles**

Run: `cd src-tauri && cargo build 2>&1 | tail -20`
Expected: compilation succeeds, no errors

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "fix(startup): make state server init synchronous to prevent race with PTY spawns"
```

---

### Task 2: Fix Zombie Sessions — Detection and Cleanup

**Files:**
- Modify: `src/services/sessionManager.ts:152-266`
- Modify: `src/components/layout/AppShell.tsx:159-164`

When `getOrSpawn` fails (e.g. state server wasn't ready), the session stays in the map with `sessionId: ""` and blocks future spawn attempts. The AppShell swallows errors with `.catch(console.error)`.

- [ ] **Step 1: Add zombie detection to getOrSpawn**

In `src/services/sessionManager.ts`, replace lines 159-161:

```typescript
  ): Promise<ManagedSession> {
    const existing = this.sessions.get(sessionKey);
    if (existing) return existing;
```

With:

```typescript
  ): Promise<ManagedSession> {
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      // Zombie detection: session exists but PTY never spawned or died
      const isZombie = !existing.sessionId && existing.lastHeartbeat > 0 &&
        Date.now() - existing.lastHeartbeat > 10_000;
      if (!isZombie) return existing;
      // Clean up the zombie so we can spawn fresh
      existing.terminal.dispose();
      this.sessions.delete(sessionKey);
    }
```

- [ ] **Step 2: Clean up session map on spawn failure**

In `src/services/sessionManager.ts`, replace lines 245-253:

```typescript
    const sessionId = await spawnPty(
      worktreeId,
      worktreePath,
      command,
      args ?? [],
      channel,
      agentType,
    );
    session.sessionId = sessionId;
```

With:

```typescript
    let sessionId: string;
    try {
      sessionId = await spawnPty(
        worktreeId,
        worktreePath,
        command,
        args ?? [],
        channel,
        agentType,
      );
    } catch (err) {
      // Spawn failed — remove session from map to prevent zombie
      session.terminal.dispose();
      this.sessions.delete(sessionKey);
      throw err;
    }
    session.sessionId = sessionId;
```

- [ ] **Step 3: Also add the session to the map BEFORE spawning (move the set call)**

Currently `this.sessions.set(sessionKey, session)` is at line 256, after spawn. But the zombie detection needs it to be set before. Actually, looking at the code again — the session is NOT set before spawn, which means a concurrent call to `getOrSpawn` with the same key could spawn twice. Move the `set` call to before the spawn, and the cleanup in the catch will remove it:

In `src/services/sessionManager.ts`, add this line right before the `let sessionId: string;` try block:

```typescript
    // Set early to prevent concurrent spawns for the same key
    this.sessions.set(sessionKey, session);
```

And remove the duplicate `this.sessions.set(sessionKey, session)` that was on the line after `session.sessionId = sessionId` (the old line 256).

- [ ] **Step 4: Fix AppShell error handling for session restoration**

In `src/components/layout/AppShell.tsx`, replace lines 159-164:

```typescript
              for (const tab of session.tabs) {
                if (tab.type === "claude" && !sessionManager.getSession(tab.id)) {
                  sessionManager.getOrSpawn(
                    tab.id, wt.id, wt.path, "claude", undefined, ["--continue"],
                  ).catch(console.error);
                }
              }
```

With:

```typescript
              for (const tab of session.tabs) {
                if (tab.type === "claude" && !sessionManager.getSession(tab.id)) {
                  try {
                    await sessionManager.getOrSpawn(
                      tab.id, wt.id, wt.path, "claude", undefined, ["--continue"],
                    );
                  } catch (err) {
                    console.warn(`[session-restore] Failed to resume session ${tab.id}:`, err);
                  }
                }
              }
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npm run typecheck 2>&1 | tail -20`
Expected: no type errors

- [ ] **Step 6: Commit**

```bash
git add src/services/sessionManager.ts src/components/layout/AppShell.tsx
git commit -m "fix(sessions): detect and clean up zombie sessions, propagate spawn errors"
```

---

### Task 3: Simplify Agent State — Hooks Always Win

**Files:**
- Modify: `src/services/sessionManager.ts:20-21, 29-36, 185, 210-236, 329-365, 380`

Replace the fragile time-based arbitration (3-second `HOOK_AUTHORITY_MS` window + partial `hooksActive` latch) with a simple rule: once hooks have fired, the detector is permanently ignored for ALL state transitions.

- [ ] **Step 1: Remove HOOK_AUTHORITY_MS and lastHookUpdate**

In `src/services/sessionManager.ts`, remove the constant (line 20):

```typescript
const HOOK_AUTHORITY_MS = 3_000;
```

In the `ManagedSession` interface, remove lines 30-32:

```typescript
  /** Timestamp of the last hook-sourced state update. Detector updates are
   *  suppressed for HOOK_AUTHORITY_MS after this to avoid false overrides. */
  lastHookUpdate: number;
```

- [ ] **Step 2: Simplify the agentState handler in getOrSpawn channel callback**

In `src/services/sessionManager.ts`, replace the `hookAgentState` and `agentState` cases (lines 210-236):

```typescript
        case "hookAgentState": {
          session.agentState = event.data;
          session.lastHookUpdate = Date.now();
          session.hooksActive = true;
          useWorkspaceStore
            .getState()
            .updateWorktree(worktreeId, { agentStatus: event.data });
          break;
        }
        case "agentState": {
          if (Date.now() - session.lastHookUpdate < HOOK_AUTHORITY_MS) {
            break;
          }
          // Once hooks are established, the detector must not flip to "busy".
          // Only the UserPromptSubmit hook should set busy — the detector's
          // "busy" signal is too noisy (status-bar redraws in chunks trigger
          // false positives after the suppression window expires).
          // The detector CAN still set waitingForInput (permission prompts)
          // and idle as a fallback when hooks don't fire.
          if (session.hooksActive && event.data === "busy") {
            break;
          }
          session.agentState = event.data;
          useWorkspaceStore
            .getState()
            .updateWorktree(worktreeId, { agentStatus: event.data });
          break;
        }
```

With:

```typescript
        case "hookAgentState": {
          session.agentState = event.data;
          session.hooksActive = true;
          useWorkspaceStore
            .getState()
            .updateWorktree(worktreeId, { agentStatus: event.data });
          break;
        }
        case "agentState": {
          // Once hooks are active, ignore ALL detector events.
          // Detector is only the source of truth before the first hook fires.
          if (session.hooksActive) break;
          session.agentState = event.data;
          useWorkspaceStore
            .getState()
            .updateWorktree(worktreeId, { agentStatus: event.data });
          break;
        }
```

- [ ] **Step 3: Apply the same simplification to spawnForExisting**

In `src/services/sessionManager.ts`, replace the duplicate handler in `spawnForExisting` (lines 342-363):

```typescript
        case "hookAgentState": {
          session.agentState = event.data;
          session.lastHookUpdate = Date.now();
          session.hooksActive = true;
          useWorkspaceStore
            .getState()
            .updateWorktree(worktreeId, { agentStatus: event.data });
          break;
        }
        case "agentState": {
          if (Date.now() - session.lastHookUpdate < HOOK_AUTHORITY_MS) {
            break;
          }
          if (session.hooksActive && event.data === "busy") {
            break;
          }
          session.agentState = event.data;
          useWorkspaceStore
            .getState()
            .updateWorktree(worktreeId, { agentStatus: event.data });
          break;
        }
```

With:

```typescript
        case "hookAgentState": {
          session.agentState = event.data;
          session.hooksActive = true;
          useWorkspaceStore
            .getState()
            .updateWorktree(worktreeId, { agentStatus: event.data });
          break;
        }
        case "agentState": {
          if (session.hooksActive) break;
          session.agentState = event.data;
          useWorkspaceStore
            .getState()
            .updateWorktree(worktreeId, { agentStatus: event.data });
          break;
        }
```

- [ ] **Step 4: Remove lastHookUpdate from session initialization**

In `getOrSpawn`, remove `lastHookUpdate: Date.now(),` from the session object (line 185).

In `loadScrollbackOnly`, remove `lastHookUpdate: 0,` from the session object (line 299).

In `spawnForExisting`, remove `session.lastHookUpdate = Date.now();` (line 380).

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npm run typecheck 2>&1 | tail -20`
Expected: no type errors

- [ ] **Step 6: Commit**

```bash
git add src/services/sessionManager.ts
git commit -m "fix(agent-state): replace time-based arbitration with simple hooks-always-win gate"
```

---

### Task 4: Create Lifecycle Manager

**Files:**
- Create: `src/services/lifecycleManager.ts`

Single coordination point for operations that span workspaceStore, layoutStore, and SessionManager. Each method performs a complete atomic operation — no caller needs to manually coordinate stores.

- [ ] **Step 1: Create lifecycleManager.ts**

Create `src/services/lifecycleManager.ts`:

```typescript
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useLayoutStore } from "../stores/layoutStore";
import { sessionManager } from "./sessionManager";
import { deleteWorktree as deleteWorktreeApi } from "../api";
import { deleteSession as deleteSessionFile } from "./SessionPersistence";
import type { TabType, Worktree } from "../types";

/**
 * Coordinates lifecycle operations across workspaceStore, layoutStore,
 * and SessionManager. Every method here is a single atomic operation
 * that keeps all three stores consistent.
 *
 * Rule: components should call lifecycleManager for any operation that
 * touches more than one store. Direct store access is fine for reads
 * and single-store mutations (e.g. setActiveTabId).
 */
class LifecycleManager {
  /**
   * Add a tab to a worktree, placing it in the specified pane (or active pane).
   * Returns the new tab's ID, or null if creation failed.
   */
  addTab(worktreeId: string, type: TabType, paneId?: string): string | null {
    const prevTabs = useWorkspaceStore.getState().tabs[worktreeId] ?? [];
    useWorkspaceStore.getState().addTab(worktreeId, type);
    const newTabs = useWorkspaceStore.getState().tabs[worktreeId] ?? [];
    const newTab = newTabs.find((t) => !prevTabs.some((p) => p.id === t.id));
    if (!newTab) return null;

    const layoutState = useLayoutStore.getState();
    const targetPaneId = paneId ?? layoutState.activePaneId[worktreeId];
    if (targetPaneId) {
      layoutState.addTabToPane(worktreeId, targetPaneId, newTab.id);
    }
    return newTab.id;
  }

  /**
   * Remove a tab: close its PTY session, remove from workspace store,
   * and remove from layout pane.
   */
  async removeTab(worktreeId: string, tabId: string): Promise<void> {
    await sessionManager.closeSession(tabId);
    useWorkspaceStore.getState().removeTab(worktreeId, tabId);
    useLayoutStore.getState().removeTabFromPane(worktreeId, tabId);
  }

  /**
   * Remove a worktree: clean up all stores, close sessions, delete git
   * worktree, and delete session file. Best-effort — failures in git/fs
   * cleanup don't leave store state inconsistent.
   */
  async removeWorktree(
    worktreeId: string,
    repoPath: string,
    worktreeName: string,
  ): Promise<void> {
    // Snapshot tabs before removing from store
    const tabs = useWorkspaceStore.getState().tabs[worktreeId] ?? [];

    // 1. Remove from both stores atomically (synchronous)
    useWorkspaceStore.getState().removeWorktree(worktreeId);
    useLayoutStore.getState().removeLayout(worktreeId);

    // 2. Close PTY sessions (async, best-effort)
    for (const tab of tabs) {
      await sessionManager.closeSession(tab.id).catch(() => {});
    }

    // 3. Delete git worktree (async, log failure)
    try {
      await deleteWorktreeApi(repoPath, worktreeName, true);
    } catch (e) {
      console.error("Failed to delete worktree:", e);
    }

    // 4. Delete session file (async, non-critical)
    try {
      await deleteSessionFile(repoPath, worktreeId);
    } catch {
      // Session file may not exist
    }
  }

  /**
   * Initialize a worktree with default tabs and layout.
   * Called after creating a new worktree or when one is missing defaults.
   */
  initWorktreeDefaults(worktreeId: string): void {
    useWorkspaceStore.getState().ensureDefaultTabs(worktreeId);
    const layoutState = useLayoutStore.getState();
    if (!layoutState.layout[worktreeId]) {
      const tabs = useWorkspaceStore.getState().tabs[worktreeId] ?? [];
      const activeTabId = useWorkspaceStore.getState().activeTabId[worktreeId] ?? "";
      if (tabs.length > 0) {
        layoutState.initLayout(worktreeId, tabs.map((t) => t.id), activeTabId);
      }
    }
  }

  /**
   * Sync layout after workspace tabs change (e.g. ensureDefaultTabs added
   * new tabs). Adds any tabs not yet in a pane to the active pane.
   */
  syncTabsToLayout(worktreeId: string): void {
    const layoutState = useLayoutStore.getState();
    const wtLayout = layoutState.layout[worktreeId];
    if (!wtLayout) {
      this.initWorktreeDefaults(worktreeId);
      return;
    }

    const wtTabs = useWorkspaceStore.getState().tabs[worktreeId] ?? [];
    const allPaneTabIds = new Set(
      Object.values(layoutState.panes[worktreeId] ?? {}).flatMap((p) => p.tabIds),
    );
    const activePaneId = layoutState.activePaneId[worktreeId];
    for (const tab of wtTabs) {
      if (!allPaneTabIds.has(tab.id) && activePaneId) {
        layoutState.addTabToPane(worktreeId, activePaneId, tab.id);
      }
    }
  }
}

export const lifecycleManager = new LifecycleManager();
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run typecheck 2>&1 | tail -20`
Expected: no type errors

- [ ] **Step 3: Commit**

```bash
git add src/services/lifecycleManager.ts
git commit -m "feat(lifecycle): add LifecycleManager for coordinated multi-store operations"
```

---

### Task 5: Migrate PaneTabBar to Lifecycle Manager

**Files:**
- Modify: `src/components/layout/PaneTabBar.tsx:188-229`

PaneTabBar currently calls `removeTab` and `removeTabFromPane` separately, and `addTab` + `addTabToPane` separately. Migrate both to lifecycleManager.

- [ ] **Step 1: Update imports in PaneTabBar.tsx**

In `src/components/layout/PaneTabBar.tsx`, add the lifecycleManager import alongside existing imports:

```typescript
import { lifecycleManager } from "../../services/lifecycleManager";
```

- [ ] **Step 2: Replace handleCloseTab**

In `src/components/layout/PaneTabBar.tsx`, replace lines 215-219:

```typescript
  function handleCloseTab(e: React.MouseEvent | Event, tabId: string) {
    if ("stopPropagation" in e) e.stopPropagation();
    removeTab(worktreeId, tabId);
    removeTabFromPane(worktreeId, tabId);
  }
```

With:

```typescript
  function handleCloseTab(e: React.MouseEvent | Event, tabId: string) {
    if ("stopPropagation" in e) e.stopPropagation();
    lifecycleManager.removeTab(worktreeId, tabId);
  }
```

- [ ] **Step 3: Replace handleAddTab**

In `src/components/layout/PaneTabBar.tsx`, replace lines 221-229:

```typescript
  function handleAddTab(type: TabType) {
    const prevTabs = useWorkspaceStore.getState().tabs[worktreeId] ?? [];
    addTab(worktreeId, type);
    const newTabs = useWorkspaceStore.getState().tabs[worktreeId] ?? [];
    const newTab = newTabs.find((t) => !prevTabs.some((p) => p.id === t.id));
    if (newTab) {
      useLayoutStore.getState().addTabToPane(worktreeId, paneId, newTab.id);
    }
  }
```

With:

```typescript
  function handleAddTab(type: TabType) {
    lifecycleManager.addTab(worktreeId, type, paneId);
  }
```

- [ ] **Step 4: Remove unused store hooks**

Remove these lines that are no longer used (lines 188-190):

```typescript
  const addTab = useWorkspaceStore((s) => s.addTab);
  const removeTab = useWorkspaceStore((s) => s.removeTab);
  const removeTabFromPane = useLayoutStore((s) => s.removeTabFromPane);
```

Note: keep any other hooks that are still used (like `reorderTabs`, `splitPane`, `setActivePaneId`). Only remove the three listed above.

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npm run typecheck 2>&1 | tail -20`
Expected: no type errors

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/PaneTabBar.tsx
git commit -m "refactor(tabs): migrate PaneTabBar to lifecycleManager"
```

---

### Task 6: Migrate Sidebar to Lifecycle Manager

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx:14-16, 73-104`

Replace the manual 4-step `handleDeleteWorktree` with a single `lifecycleManager.removeWorktree()` call.

- [ ] **Step 1: Update imports**

In `src/components/sidebar/Sidebar.tsx`, replace imports:

```typescript
import { deleteWorktree } from "../../api";
import { sessionManager } from "../../services/sessionManager";
import { deleteSession } from "../../services/SessionPersistence";
```

With:

```typescript
import { lifecycleManager } from "../../services/lifecycleManager";
```

- [ ] **Step 2: Remove unused store hook**

Remove the `removeWorktree` hook (line 73):

```typescript
  const removeWorktree = useWorkspaceStore((s) => s.removeWorktree);
```

- [ ] **Step 3: Replace handleDeleteWorktree body**

Replace the `handleDeleteWorktree` function (lines 78-104):

```typescript
  async function handleDeleteWorktree(id: string) {
    const wt = worktrees.find((w) => w.id === id);
    if (!wt || !repoPath) return;

    // 1. Remove from store first (prevents sync loop race)
    removeWorktree(id);

    // 2. Close any PTY sessions for this worktree's tabs
    const worktreeTabs = allTabs[id] ?? [];
    for (const tab of worktreeTabs) {
      await sessionManager.closeSession(tab.id);
    }

    // 3. Force-delete worktree + branch
    try {
      await deleteWorktree(repoPath, wt.name, true);
    } catch (e) {
      console.error("Failed to delete worktree:", e);
    }

    // 4. Delete session file
    try {
      await deleteSession(repoPath, id);
    } catch {
      // Non-critical — session file may not exist
    }
  }
```

With:

```typescript
  async function handleDeleteWorktree(id: string) {
    const wt = worktrees.find((w) => w.id === id);
    if (!wt || !repoPath) return;
    await lifecycleManager.removeWorktree(id, repoPath, wt.name);
  }
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npm run typecheck 2>&1 | tail -20`
Expected: no type errors

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/Sidebar.tsx
git commit -m "refactor(sidebar): migrate worktree deletion to lifecycleManager"
```

---

### Task 7: Migrate AppShell to Lifecycle Manager

**Files:**
- Modify: `src/components/layout/AppShell.tsx:201-228, 254-272, 434-460, 500-509`

This is the biggest migration. Replace manual cross-store coordination in: Cmd+T handler, layout-sync useEffect, server tab creation, and layout cleanup effect.

- [ ] **Step 1: Add lifecycleManager import**

In `src/components/layout/AppShell.tsx`, add import:

```typescript
import { lifecycleManager } from "../../services/lifecycleManager";
```

- [ ] **Step 2: Replace the layout-sync useEffect (lines 201-228)**

Replace:

```typescript
  // Sync layout store when ensureDefaultTabs adds tabs not yet in a pane
  useEffect(() => {
    if (!activeWorktreeId) return;
    // Guarantee default tabs exist before touching layout
    ensureDefaultTabs(activeWorktreeId);
    const layoutState = useLayoutStore.getState();
    const wtLayout = layoutState.layout[activeWorktreeId];
    if (!wtLayout) {
      // Layout not initialized yet — init it from current tabs
      const wtTabs = useWorkspaceStore.getState().tabs[activeWorktreeId] ?? [];
      const wtActiveTabId = useWorkspaceStore.getState().activeTabId[activeWorktreeId] ?? "";
      if (wtTabs.length > 0) {
        layoutState.initLayout(activeWorktreeId, wtTabs.map((t) => t.id), wtActiveTabId);
      }
      return;
    }
    // Check for tabs not in any pane and add them to the active pane
    const wtTabs = useWorkspaceStore.getState().tabs[activeWorktreeId] ?? [];
    const allPaneTabIds = new Set(
      Object.values(layoutState.panes[activeWorktreeId] ?? {}).flatMap((p) => p.tabIds),
    );
    const activePaneId = layoutState.activePaneId[activeWorktreeId];
    for (const tab of wtTabs) {
      if (!allPaneTabIds.has(tab.id) && activePaneId) {
        layoutState.addTabToPane(activeWorktreeId, activePaneId, tab.id);
      }
    }
  }, [activeWorktreeId, tabs, ensureDefaultTabs]);
```

With:

```typescript
  // Sync layout when active worktree changes or tabs are added
  useEffect(() => {
    if (!activeWorktreeId) return;
    ensureDefaultTabs(activeWorktreeId);
    lifecycleManager.syncTabsToLayout(activeWorktreeId);
  }, [activeWorktreeId, tabs, ensureDefaultTabs]);
```

- [ ] **Step 3: Replace the Cmd+T handler (lines 254-272)**

Replace:

```typescript
      // Cmd+T: new tab of same type as active pane's current tab
      if (event.metaKey && !event.shiftKey && event.key === "t") {
        event.preventDefault();
        if (activeWorktreeId) {
          const layoutState = useLayoutStore.getState();
          const activePaneId = layoutState.activePaneId[activeWorktreeId];
          const pane = activePaneId ? layoutState.panes[activeWorktreeId]?.[activePaneId] : null;
          const paneActiveTab = pane ? tabs.find((t) => t.id === pane.activeTabId) : activeTab;
          const type = (!paneActiveTab || paneActiveTab.type === "changes") ? "claude" : paneActiveTab.type;

          const prevTabs = useWorkspaceStore.getState().tabs[activeWorktreeId] ?? [];
          addTab(activeWorktreeId, type);
          const newTabs = useWorkspaceStore.getState().tabs[activeWorktreeId] ?? [];
          const newTab = newTabs.find((t) => !prevTabs.some((p) => p.id === t.id));
          if (newTab && activePaneId) {
            layoutState.addTabToPane(activeWorktreeId, activePaneId, newTab.id);
          }
        }
        return;
      }
```

With:

```typescript
      // Cmd+T: new tab of same type as active pane's current tab
      if (event.metaKey && !event.shiftKey && event.key === "t") {
        event.preventDefault();
        if (activeWorktreeId) {
          const layoutState = useLayoutStore.getState();
          const activePaneId = layoutState.activePaneId[activeWorktreeId];
          const pane = activePaneId ? layoutState.panes[activeWorktreeId]?.[activePaneId] : null;
          const paneActiveTab = pane ? tabs.find((t) => t.id === pane.activeTabId) : activeTab;
          const type = (!paneActiveTab || paneActiveTab.type === "changes") ? "claude" : paneActiveTab.type;
          lifecycleManager.addTab(activeWorktreeId, type, activePaneId ?? undefined);
        }
        return;
      }
```

- [ ] **Step 4: Replace server tab creation (lines 434-460)**

Replace the server tab creation block inside `handleToggleServer`:

```typescript
      // Create a fresh server tab with the run command stored on it
      const tabId = `${activeWorktreeId}:server:${crypto.randomUUID().slice(0, 8)}`;
      const newTab = {
        id: tabId,
        type: "server" as const,
        label: "Server",
        command: runScript.command,
      };
      const currentTabs = useWorkspaceStore.getState().tabs[activeWorktreeId] ?? [];
      const serverTabs = [...currentTabs];
      const changesIdx = serverTabs.findIndex((t) => t.type === "changes");
      if (changesIdx >= 0) {
        serverTabs.splice(changesIdx, 0, newTab);
      } else {
        serverTabs.push(newTab);
      }
      useWorkspaceStore.setState((state) => ({
        tabs: { ...state.tabs, [activeWorktreeId]: serverTabs },
      }));

      useWorkspaceStore.getState().setActiveTabId(activeWorktreeId, tabId);
```

With:

```typescript
      // Create a fresh server tab with the run command stored on it
      const tabId = lifecycleManager.addTab(activeWorktreeId, "server");
      if (tabId) {
        useWorkspaceStore.getState().updateTab(activeWorktreeId, tabId, {
          command: runScript.command,
        });
      }
```

And update the `setRunningServer` call that follows to use `tabId`:

```typescript
      setRunningServer({
        worktreeId: activeWorktreeId,
        sessionId: "",
        tabId: tabId ?? "",
      });
```

- [ ] **Step 5: Replace the old server tab cleanup (lines 435-440)**

The cleanup of old server tab also needs lifecycleManager. Replace:

```typescript
      const existingTabs = useWorkspaceStore.getState().tabs[activeWorktreeId] ?? [];
      const oldServerTab = existingTabs.find((t) => t.type === "server");
      if (oldServerTab) {
        await sessionManager.closeSession(oldServerTab.id);
        useWorkspaceStore.getState().removeTab(activeWorktreeId, oldServerTab.id);
      }
```

With:

```typescript
      const existingTabs = useWorkspaceStore.getState().tabs[activeWorktreeId] ?? [];
      const oldServerTab = existingTabs.find((t) => t.type === "server");
      if (oldServerTab) {
        await lifecycleManager.removeTab(activeWorktreeId, oldServerTab.id);
      }
```

- [ ] **Step 6: Replace the layout cleanup effect (lines 500-509)**

Replace:

```typescript
  // Clean up layout state for removed worktrees
  const worktreeIds = worktrees.map((wt) => wt.id);
  useEffect(() => {
    const layoutState = useLayoutStore.getState();
    for (const wtId of Object.keys(layoutState.layout)) {
      if (!worktreeIds.includes(wtId)) {
        layoutState.removeLayout(wtId);
      }
    }
  }, [worktreeIds.join(",")]);
```

With:

```typescript
  // Clean up orphaned layout state for removed worktrees
  const worktreeIds = worktrees.map((wt) => wt.id);
  useEffect(() => {
    const layoutState = useLayoutStore.getState();
    for (const wtId of Object.keys(layoutState.layout)) {
      if (!worktreeIds.includes(wtId)) {
        layoutState.removeLayout(wtId);
      }
    }
  }, [worktreeIds.join(",")]);
```

Note: this effect stays as-is — it's a safety net for any worktree removal path that doesn't go through lifecycleManager (e.g. git-level removal). The `removeLayout` call is idempotent so it's fine to run redundantly.

- [ ] **Step 7: Remove unused addTab import from useWorkspaceStore hook**

In `src/components/layout/AppShell.tsx`, remove:

```typescript
  const addTab = useWorkspaceStore((s) => s.addTab);
```

- [ ] **Step 8: Verify TypeScript compiles**

Run: `npm run typecheck 2>&1 | tail -20`
Expected: no type errors

- [ ] **Step 9: Commit**

```bash
git add src/components/layout/AppShell.tsx
git commit -m "refactor(appshell): migrate cross-store operations to lifecycleManager"
```

---

### Task 8: Sync Layout When PR Tabs Are Auto-Created

**Files:**
- Modify: `src/stores/workspaceStore.ts:246-264`

When `applyPrUpdates` auto-creates a PR tab, the layout store is never notified. Fix by syncing the layout after mutation.

- [ ] **Step 1: Add layout sync after PR tab creation**

In `src/stores/workspaceStore.ts`, at the end of the `applyPrUpdates` method (after the `return` statement at line 280-287), we can't call external stores from within a Zustand `set` callback. Instead, we'll use `subscribe` in the lifecycleManager to react to PR tab additions.

Actually, the cleanest approach: add a `zustand` `subscribe` in `lifecycleManager` that watches for new tabs and syncs them to layout. This handles PR tabs AND any other source of unsynced tabs.

In `src/services/lifecycleManager.ts`, add at the bottom of the class (before the closing brace):

```typescript
  /**
   * Start watching for workspace tab changes and sync to layout.
   * Call once at app startup.
   */
  startTabSync(): void {
    useWorkspaceStore.subscribe(
      (state) => state.tabs,
      (tabs, prevTabs) => {
        for (const worktreeId of Object.keys(tabs)) {
          const current = tabs[worktreeId] ?? [];
          const previous = prevTabs[worktreeId] ?? [];
          // Only sync if new tabs were added (not on removal)
          if (current.length > previous.length) {
            this.syncTabsToLayout(worktreeId);
          }
        }
      },
    );
  }
```

Wait — `zustand` `subscribe` with a selector requires `subscribeWithSelector` middleware. Let me check if the store uses it.

Actually, the simpler approach: just call `lifecycleManager.syncTabsToLayout` from the existing AppShell effect that already watches `tabs`. The effect we modified in Task 7 Step 2 already does this:

```typescript
  useEffect(() => {
    if (!activeWorktreeId) return;
    ensureDefaultTabs(activeWorktreeId);
    lifecycleManager.syncTabsToLayout(activeWorktreeId);
  }, [activeWorktreeId, tabs, ensureDefaultTabs]);
```

This effect watches `tabs` (the `allTabs` selector) and runs `syncTabsToLayout` whenever tabs change for the active worktree. PR tabs created by `applyPrUpdates` will trigger this effect because `tabs` is derived from `allTabs[activeWorktreeId]`.

However, there's a gap: PR tabs created for *non-active* worktrees won't sync until the user switches to them. This is acceptable — the layout is only needed when the worktree is active.

So no additional code change is needed. The Task 7 effect already handles this case for the active worktree. Mark this as complete.

- [ ] **Step 1 (revised): Verify PR tab sync works with existing effect**

No code change needed. The layout-sync effect from Task 7 already watches `tabs` and calls `syncTabsToLayout`, which will pick up any new PR tabs in the active worktree. Non-active worktrees sync when the user switches to them.

Run: `npm run typecheck 2>&1 | tail -20`
Expected: no type errors (no changes made)

---

### Task 9: Full Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Run Rust build**

Run: `cd src-tauri && cargo build 2>&1 | tail -20`
Expected: compilation succeeds

- [ ] **Step 2: Run TypeScript typecheck**

Run: `npm run typecheck 2>&1 | tail -20`
Expected: no type errors

- [ ] **Step 3: Run frontend build**

Run: `npm run build 2>&1 | tail -20`
Expected: build succeeds

- [ ] **Step 4: Verify acceptance criteria by reading code**

Read each file and confirm:

1. `src-tauri/src/lib.rs` — state server uses `block_on`, no async spawn
2. `src/services/sessionManager.ts` — no `HOOK_AUTHORITY_MS`, no `lastHookUpdate`, `agentState` case has single `if (session.hooksActive) break;` guard
3. `src/services/lifecycleManager.ts` — `addTab`, `removeTab`, `removeWorktree` all coordinate both stores + sessionManager
4. `src/components/layout/AppShell.tsx` — Cmd+T uses `lifecycleManager.addTab`, layout-sync effect uses `lifecycleManager.syncTabsToLayout`, no manual multi-store coordination
5. `src/components/sidebar/Sidebar.tsx` — `handleDeleteWorktree` is a single `lifecycleManager.removeWorktree` call
6. `src/components/layout/PaneTabBar.tsx` — close/add use lifecycleManager, no direct `removeTab`/`removeTabFromPane` calls

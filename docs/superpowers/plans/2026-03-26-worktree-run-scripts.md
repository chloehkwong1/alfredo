# Worktree Run Scripts (Dev Server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ability to configure a dev server command per repo, run it from any worktree via a tab bar button, see logs in a dedicated "Server" tab, and know which worktree owns the running server via animated equalizer bars in the sidebar.

**Architecture:** Extends the existing PTY session system — the server is just a shell PTY spawned with the configured command. New `runningServer` state in the workspace store tracks ownership. A new `"server"` tab type reuses `TerminalView`. The sidebar gets a small `ServerIndicator` component with CSS keyframe animations.

**Tech Stack:** React, Zustand, Tauri IPC (existing `spawn_pty`/`close_pty`), Tailwind CSS, lucide-react icons

---

### Task 1: Add `RunScript` type and config field

**Files:**
- Modify: `src-tauri/src/types.rs:127-207`
- Modify: `src/types.ts:89-134`

- [ ] **Step 1: Add `RunScript` struct to Rust types**

In `src-tauri/src/types.rs`, add after the `SetupScript` struct (line 135):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunScript {
    pub name: String,
    pub command: String,
}
```

Add the field to `AppConfig` (after `setup_scripts` on line 189):

```rust
    #[serde(default)]
    pub run_script: Option<RunScript>,
```

- [ ] **Step 2: Add `RunScript` interface to TypeScript types**

In `src/types.ts`, add after `SetupScript` (line 95):

```typescript
export interface RunScript {
  name: string;
  command: string;
}
```

Add to `AppConfig` interface (after `setupScripts` on line 123):

```typescript
  runScript?: RunScript | null;
```

- [ ] **Step 3: Verify the app still compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: no errors (the new fields are `Option`/`default` so existing configs still parse)

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | tail -5`
Expected: no type errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/types.rs src/types.ts
git commit -m "feat: add RunScript type to config"
```

---

### Task 2: Add `"server"` tab type and extend `TabType`

**Files:**
- Modify: `src/types.ts:189`
- Modify: `src/components/layout/AppShell.tsx:30-35`
- Modify: `src/stores/workspaceStore.ts:314-342`

- [ ] **Step 1: Extend `TabType` union**

In `src/types.ts`, change line 189:

```typescript
export type TabType = "claude" | "shell" | "server" | "changes" | "pr";
```

- [ ] **Step 2: Add Server icon to `TAB_ICONS` map**

In `src/components/layout/AppShell.tsx`, add `Play` to the lucide-react import (line 3):

```typescript
import { Plus, X, Terminal, Sparkles, GitCompareArrows, GitPullRequest, Play } from "lucide-react";
```

Update `TAB_ICONS` (line 30):

```typescript
const TAB_ICONS: Record<TabType, typeof Terminal> = {
  claude: Sparkles,
  shell: Terminal,
  server: Play,
  changes: GitCompareArrows,
  pr: GitPullRequest,
};
```

- [ ] **Step 3: Handle `"server"` tab type in the main content area**

In `AppShell.tsx`, update the `activeTab?.type` check (line 512). Replace:

```typescript
{(activeTab?.type === "claude" || activeTab?.type === "shell") && (
```

With:

```typescript
{(activeTab?.type === "claude" || activeTab?.type === "shell" || activeTab?.type === "server") && (
```

- [ ] **Step 4: Handle `"server"` mode in `TerminalView`**

In `src/components/terminal/TerminalView.tsx`, update the mode derivation (line 43). Replace:

```typescript
const mode = tabType === "shell" ? "shell" : "claude";
```

With:

```typescript
const mode = (tabType === "shell" || tabType === "server") ? "shell" : "claude";
```

- [ ] **Step 5: Allow closing server tabs in `canClose`**

In `AppShell.tsx` `TabBar`, the `canClose` function (line 71) already allows closing `pr` tabs and extra claude/shell tabs. Server tabs should always be closeable. No change needed — the existing logic returns `true` for any tab type that isn't `changes` and isn't the last `claude`/`shell`. Server tabs pass through fine.

- [ ] **Step 6: Don't show "Server" in the add-tab dropdown**

No changes needed — the dropdown (line 133-143) only offers `claude`, `shell`, and `pr`. Server tabs are only created by the play button (Task 4).

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: no type errors

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/components/layout/AppShell.tsx src/components/terminal/TerminalView.tsx
git commit -m "feat: add server tab type"
```

---

### Task 3: Add `runningServer` state to workspace store

**Files:**
- Modify: `src/stores/workspaceStore.ts`

- [ ] **Step 1: Add state and actions to the store interface**

In `src/stores/workspaceStore.ts`, add to the `WorkspaceState` interface after `disconnectedTabs` (line 32):

```typescript
  /** Tracks the currently running dev server, if any. */
  runningServer: { worktreeId: string; sessionId: string; tabId: string } | null;
```

Add actions after `clearStore` (line 61):

```typescript
  setRunningServer: (server: { worktreeId: string; sessionId: string; tabId: string } | null) => void;
```

- [ ] **Step 2: Add initial state and action implementation**

Add initial state after `disconnectedTabs: new Set<string>(),` (line 86):

```typescript
  runningServer: null,
```

Add the action implementation before the closing `}));` (after `clearStore`):

```typescript
  setRunningServer: (server) => set({ runningServer: server }),
```

- [ ] **Step 3: Clear `runningServer` in `clearStore`**

In the `clearStore` action (line 443), add `runningServer: null,` to the reset object.

- [ ] **Step 4: Clear `runningServer` when owning worktree is deleted**

In `removeWorktree` (line 91), add to the return object:

```typescript
        runningServer: state.runningServer?.worktreeId === id ? null : state.runningServer,
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: no type errors

- [ ] **Step 6: Commit**

```bash
git add src/stores/workspaceStore.ts
git commit -m "feat: add runningServer state to workspace store"
```

---

### Task 4: Add play/stop button to tab bar

**Files:**
- Modify: `src/components/layout/AppShell.tsx`

- [ ] **Step 1: Import dependencies**

Add to imports at top of `AppShell.tsx`:

```typescript
import { Square } from "lucide-react";
```

Add to the existing imports from `../../api`:

```typescript
import { listWorktrees, ensureAlfredoGitignore, getWorktreeDiffStats, setSyncRepoPath, getConfig } from "../../api";
```

Add:

```typescript
import { sessionManager } from "../../services/sessionManager";
import type { RunScript } from "../../types";
```

- [ ] **Step 2: Add server control logic to `TabBar`**

Inside the `TabBar` function, after the existing hooks (around line 48), add:

```typescript
  const runningServer = useWorkspaceStore((s) => s.runningServer);
  const setRunningServer = useWorkspaceStore((s) => s.setRunningServer);
  const { activeRepo: repoPath } = useAppConfig();
  const [runScript, setRunScript] = useState<RunScript | null>(null);

  // Load run script config
  useEffect(() => {
    if (!repoPath) return;
    getConfig(repoPath).then((config) => {
      setRunScript(config.runScript ?? null);
    }).catch(() => {});
  }, [repoPath]);

  const isServerRunningHere = runningServer?.worktreeId === activeWorktreeId;

  const handleToggleServer = useCallback(async () => {
    if (!activeWorktreeId || !runScript || !repoPath) return;

    const worktree = useWorkspaceStore.getState().worktrees.find((wt) => wt.id === activeWorktreeId);
    if (!worktree) return;

    if (isServerRunningHere) {
      // Stop server
      await sessionManager.closeSession(runningServer!.tabId);
      setRunningServer(null);
      return;
    }

    // Stop existing server on another worktree if running
    if (runningServer) {
      await sessionManager.closeSession(runningServer.tabId);
      // Remove the server tab from the old worktree
      const oldTabs = useWorkspaceStore.getState().tabs[runningServer.worktreeId] ?? [];
      const oldServerTab = oldTabs.find((t) => t.id === runningServer.tabId);
      if (oldServerTab) {
        useWorkspaceStore.getState().removeTab(runningServer.worktreeId, runningServer.tabId);
      }
      setRunningServer(null);
    }

    // Check if there's an existing server tab on this worktree we can reuse
    const existingTabs = useWorkspaceStore.getState().tabs[activeWorktreeId] ?? [];
    let serverTab = existingTabs.find((t) => t.type === "server");
    let tabId: string;

    if (serverTab) {
      tabId = serverTab.id;
    } else {
      // Create a new server tab — insert before Changes
      tabId = `${activeWorktreeId}:server:${crypto.randomUUID().slice(0, 8)}`;
      const newTab = { id: tabId, type: "server" as const, label: "Server" };
      const tabs = [...existingTabs];
      const changesIdx = tabs.findIndex((t) => t.type === "changes");
      if (changesIdx >= 0) {
        tabs.splice(changesIdx, 0, newTab);
      } else {
        tabs.push(newTab);
      }
      useWorkspaceStore.setState((state) => ({
        tabs: { ...state.tabs, [activeWorktreeId]: tabs },
      }));
    }

    // Switch to the server tab
    useWorkspaceStore.getState().setActiveTabId(activeWorktreeId, tabId);

    // Spawn PTY with the run script command
    const session = await sessionManager.getOrSpawn(
      tabId,
      activeWorktreeId,
      worktree.path,
      "shell",
      undefined,
      ["-c", runScript.command],
    );

    setRunningServer({
      worktreeId: activeWorktreeId,
      sessionId: session.sessionId,
      tabId,
    });
  }, [activeWorktreeId, runScript, repoPath, isServerRunningHere, runningServer, setRunningServer]);
```

- [ ] **Step 3: Render the play/stop button in the tab bar JSX**

In the `TabBar` return JSX, add the play/stop button after the add-tab dropdown `</DropdownMenu>` (around line 144) and before the spacer `<div className="flex-1" />`:

```tsx
      {/* Server play/stop button */}
      {runScript && (
        <button
          type="button"
          onClick={handleToggleServer}
          title={isServerRunningHere ? `Stop ${runScript.name}` : `Start ${runScript.name}`}
          className={[
            "h-10 px-2 transition-colors cursor-pointer flex items-center",
            isServerRunningHere
              ? "text-green-400 hover:text-red-400"
              : "text-text-tertiary hover:text-text-secondary",
          ].join(" ")}
        >
          {isServerRunningHere ? <Square size={14} /> : <Play size={14} />}
        </button>
      )}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: no type errors

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/AppShell.tsx
git commit -m "feat: add play/stop server button to tab bar"
```

---

### Task 5: Detect server process exit

**Files:**
- Modify: `src/components/layout/AppShell.tsx`

When the server process crashes or exits on its own, we need to clear `runningServer` state. The PTY channel will stop sending heartbeats. We can detect this by listening for the session to become stale.

- [ ] **Step 1: Add exit detection effect to `AppShell`**

In the `AppShell` function, after the existing effects, add a heartbeat-based exit detector:

```typescript
  // Detect server process exit via heartbeat timeout
  const runningServer = useWorkspaceStore((s) => s.runningServer);
  const setRunningServer = useWorkspaceStore((s) => s.setRunningServer);

  useEffect(() => {
    if (!runningServer) return;

    const interval = setInterval(() => {
      const session = sessionManager.getSession(runningServer.tabId);
      if (!session || !session.sessionId) {
        // Session was closed externally
        setRunningServer(null);
        return;
      }
      // Check if heartbeat is stale (>10s without heartbeat = dead)
      if (session.lastHeartbeat > 0 && Date.now() - session.lastHeartbeat > 10_000) {
        setRunningServer(null);
      }
    }, 3_000);

    return () => clearInterval(interval);
  }, [runningServer, setRunningServer]);
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: no type errors

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/AppShell.tsx
git commit -m "feat: detect server process exit via heartbeat"
```

---

### Task 6: Add equalizer bars indicator to sidebar

**Files:**
- Create: `src/components/sidebar/ServerIndicator.tsx`
- Modify: `src/components/sidebar/AgentItem.tsx`

- [ ] **Step 1: Create the `ServerIndicator` component**

Create `src/components/sidebar/ServerIndicator.tsx`:

```tsx
function ServerIndicator() {
  return (
    <div className="flex items-end gap-[1.5px] h-[14px] flex-shrink-0" title="Server running">
      <span className="w-[2.5px] rounded-[1px] bg-green-400 animate-eq-bar-1" />
      <span className="w-[2.5px] rounded-[1px] bg-green-400 animate-eq-bar-2" />
      <span className="w-[2.5px] rounded-[1px] bg-green-400 animate-eq-bar-3" />
      <span className="w-[2.5px] rounded-[1px] bg-green-400 animate-eq-bar-4" />
    </div>
  );
}

export { ServerIndicator };
```

- [ ] **Step 2: Add equalizer keyframe animations to Tailwind config**

Find the Tailwind config file and add the custom animations. Check `tailwind.config.ts` or `tailwind.config.js`:

Add to `theme.extend.animation`:

```javascript
"eq-bar-1": "eq-bar-1 1.2s ease-in-out infinite",
"eq-bar-2": "eq-bar-2 1.4s ease-in-out infinite",
"eq-bar-3": "eq-bar-3 1.0s ease-in-out infinite",
"eq-bar-4": "eq-bar-4 1.6s ease-in-out infinite",
```

Add to `theme.extend.keyframes`:

```javascript
"eq-bar-1": {
  "0%, 100%": { height: "3px" },
  "50%": { height: "12px" },
},
"eq-bar-2": {
  "0%, 100%": { height: "8px" },
  "50%": { height: "4px" },
},
"eq-bar-3": {
  "0%, 100%": { height: "5px" },
  "50%": { height: "14px" },
},
"eq-bar-4": {
  "0%, 100%": { height: "10px" },
  "50%": { height: "3px" },
},
```

- [ ] **Step 3: Render `ServerIndicator` in `AgentItem`**

In `src/components/sidebar/AgentItem.tsx`, add the import:

```typescript
import { ServerIndicator } from "./ServerIndicator";
import { useWorkspaceStore } from "../../stores/workspaceStore";
```

(Note: `useWorkspaceStore` is already imported — just add `ServerIndicator`.)

Inside the `AgentItem` component, add after the existing hooks:

```typescript
  const isServerRunning = useWorkspaceStore(
    (s) => s.runningServer?.worktreeId === worktree.id,
  );
```

Render the indicator in the name row. In the `div` with `flex items-center justify-between gap-2` (line 100), add after the PR number span (line 108) and before the closing `</div>`:

```tsx
                {isServerRunning && <ServerIndicator />}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: no type errors

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/ServerIndicator.tsx src/components/sidebar/AgentItem.tsx tailwind.config.*
git commit -m "feat: add equalizer bars server indicator to sidebar"
```

---

### Task 7: Add run script settings UI

**Files:**
- Modify: `src/components/settings/WorkspaceSettingsDialog.tsx`

- [ ] **Step 1: Add run script fields to the Scripts tab**

In `WorkspaceSettingsDialog.tsx`, in the `tab === "scripts"` conditional (around line 160), add a "Run Script" section above the existing `<ScriptEditor>`:

```tsx
{tab === "scripts" && (
  <>
    <div className="space-y-3 mb-6">
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-1">Run Script</h3>
        <p className="text-sm text-text-secondary">
          A dev server command that can be started from any worktree via the play button in the tab bar.
        </p>
      </div>
      <div className="space-y-2 rounded-[var(--radius-md)] border border-border-default bg-bg-secondary p-3">
        <Input
          placeholder="Name (e.g. Dev Server)"
          value={config.runScript?.name ?? ""}
          onChange={(e) =>
            updateConfig({
              runScript: e.target.value || config.runScript?.command
                ? { name: e.target.value, command: config.runScript?.command ?? "" }
                : null,
            })
          }
        />
        <Input
          placeholder="Command (e.g. npm run dev)"
          value={config.runScript?.command ?? ""}
          onChange={(e) =>
            updateConfig({
              runScript: config.runScript?.name || e.target.value
                ? { name: config.runScript?.name ?? "", command: e.target.value }
                : null,
            })
          }
        />
      </div>
    </div>
    <div>
      <h3 className="text-sm font-medium text-text-primary mb-1">Setup Scripts</h3>
      <ScriptEditor
        scripts={config.setupScripts}
        onChange={(scripts: SetupScript[]) =>
          updateConfig({ setupScripts: scripts })
        }
      />
    </div>
  </>
)}
```

Note: Check how `Input` is imported in `WorkspaceSettingsDialog.tsx` — it's likely already used for other tabs. If not, add `import { Input } from "../ui/Input";`.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: no type errors

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/WorkspaceSettingsDialog.tsx
git commit -m "feat: add run script configuration to settings"
```

---

### Task 8: Manual testing and polish

**Files:**
- No new files

- [ ] **Step 1: Configure a test run script**

Open Alfredo, go to Settings → Scripts, add a run script:
- Name: "Dev Server"
- Command: `npx http-server -p 8080` (or whatever test command works for the active repo)

- [ ] **Step 2: Test the play button**

1. Select a worktree
2. Click the play button in the tab bar
3. Verify: Server tab opens, shows command output
4. Verify: Equalizer bars appear on the worktree in the sidebar
5. Verify: Play button changes to stop button (square icon)

- [ ] **Step 3: Test auto-stop on worktree switch**

1. With server running on worktree A, select worktree B
2. Click play on worktree B
3. Verify: Server on A is stopped (equalizer bars disappear from A)
4. Verify: New Server tab opens on B with fresh output
5. Verify: Equalizer bars appear on B

- [ ] **Step 4: Test server stop**

1. Click the stop button (square icon)
2. Verify: Server process terminates
3. Verify: Server tab stays open with logs scrollable
4. Verify: Equalizer bars disappear
5. Verify: Button reverts to play icon

- [ ] **Step 5: Test process crash detection**

1. Start the server
2. Kill the process externally (e.g., `kill` the PID)
3. Verify: Within ~10 seconds, equalizer bars disappear
4. Verify: Server tab shows disconnected state

- [ ] **Step 6: Test worktree deletion with running server**

1. Start the server on a worktree
2. Right-click → Delete worktree
3. Verify: Server is stopped, no crash or console errors

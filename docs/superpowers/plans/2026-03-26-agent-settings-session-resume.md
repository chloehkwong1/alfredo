# Agent Settings & Session Auto-Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable Claude CLI settings (global defaults + per-worktree overrides) and auto-resume Claude conversations on app restart.

**Architecture:** Settings are stored in `.alfredo.json` (per-repo) as `claudeDefaults` and `worktreeOverrides`. On PTY spawn, settings are resolved (global merged with branch overrides) and converted to CLI flags. On app restart, Claude tabs load scrollback but defer spawning until the user clicks "Resume" or "Start fresh" in an overlay.

**Tech Stack:** Rust/Tauri (config persistence), React/TypeScript (settings UI, overlay component), Zustand (state management), xterm.js (terminal)

**Spec:** `docs/superpowers/specs/2026-03-21-agent-settings-ci-integration-design.md` (Features 1 and 1b)

---

## File Structure

**New files:**
- `src/components/settings/AgentSettings.tsx` — Agent tab content for GlobalSettingsDialog
- `src/components/terminal/SessionResumeOverlay.tsx` — Compact resume/fresh overlay bar
- `src/components/terminal/AgentSettingsPopover.tsx` — Per-worktree override popover (gear icon)
- `src/services/claudeSettingsResolver.ts` — Resolves global defaults + overrides → CLI args

**Modified files:**
- `src/types.ts` — Add `ClaudeDefaults`, `ClaudeOverrides`, extend `WorkspaceTab`, `AppConfig`
- `src-tauri/src/types.rs` — Add `ClaudeDefaults`, `ClaudeOverrides` structs, extend `AppConfig`
- `src-tauri/src/config_manager.rs` — Add new fields to `ConfigFile`, `load_config`, `save_config`
- `src/stores/workspaceStore.ts` — Add `disconnectedTabs` set and actions
- `src/services/sessionManager.ts` — Accept args in `getOrSpawn()`, add `loadScrollbackOnly()` method
- `src/hooks/usePty.ts` — Accept `args` and `disconnected` options
- `src/components/terminal/TerminalView.tsx` — Render overlay when disconnected, pass args
- `src/components/settings/GlobalSettingsDialog.tsx` — Add "Agent" tab
- `src/components/layout/AppShell.tsx` — Mark Claude tabs as disconnected on restore
- `src/services/SessionPersistence.ts` — No structural changes (new `WorkspaceTab` fields persist automatically)

---

### Task 1: Add Claude Settings Types (Rust + TypeScript)

**Files:**
- Modify: `src-tauri/src/types.rs:153-171`
- Modify: `src/types.ts:103-114,181-185`

- [ ] **Step 1: Add Rust types for Claude settings**

Add these structs above the existing `AppConfig` struct in `src-tauri/src/types.rs` (before line 153):

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeDefaults {
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(default)]
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub dangerously_skip_permissions: Option<bool>,
    #[serde(default)]
    pub output_style: Option<String>,
    #[serde(default)]
    pub verbose: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeOverrides {
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(default)]
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub output_style: Option<String>,
}
```

Then add these fields to `AppConfig` (after `archive_after_days`):

```rust
    #[serde(default)]
    pub claude_defaults: Option<ClaudeDefaults>,
    #[serde(default)]
    pub worktree_overrides: Option<HashMap<String, ClaudeOverrides>>,
```

- [ ] **Step 2: Add TypeScript types for Claude settings**

Add these types in `src/types.ts` after the `AppConfig` interface (after line 114):

```typescript
export interface ClaudeDefaults {
  model?: string;
  effort?: string;
  permissionMode?: string;
  dangerouslySkipPermissions?: boolean;
  outputStyle?: string;
  verbose?: boolean;
}

export interface ClaudeOverrides {
  model?: string;
  effort?: string;
  permissionMode?: string;
  outputStyle?: string;
}
```

Then add to the `AppConfig` interface (after `archiveAfterDays`):

```typescript
  claudeDefaults?: ClaudeDefaults;
  worktreeOverrides?: Record<string, ClaudeOverrides>;
```

- [ ] **Step 3: Extend WorkspaceTab type**

Update `WorkspaceTab` in `src/types.ts` (lines 181-185) to:

```typescript
export interface WorkspaceTab {
  id: string;
  type: TabType;
  label: string;
  command?: string;
  args?: string[];
  claudeSettings?: {
    model?: string;
    effort?: string;
    permissionMode?: string;
    outputStyle?: string;
  };
}
```

- [ ] **Step 4: Verify types compile**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors (or only pre-existing ones unrelated to these changes)

Run: `cd /Users/chloe/dev/alfredo && cd src-tauri && cargo check 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src-tauri/src/types.rs
git commit -m "feat: add Claude settings types to Rust and TypeScript"
```

---

### Task 2: Update Config Manager for Claude Settings

**Files:**
- Modify: `src-tauri/src/config_manager.rs:14-35,38-76,79-102`

- [ ] **Step 1: Add fields to ConfigFile struct**

In `src-tauri/src/config_manager.rs`, add these fields to the `ConfigFile` struct (after `archive_after_days` on line 34):

```rust
    #[serde(default)]
    pub claude_defaults: Option<ClaudeDefaults>,
    #[serde(default)]
    pub worktree_overrides: Option<HashMap<String, ClaudeOverrides>>,
```

Also update the import on line 6 to include the new types:

```rust
use crate::types::{AppConfig, AppError, ClaudeDefaults, ClaudeOverrides, KanbanColumn, NotificationConfig, SetupScript};
```

- [ ] **Step 2: Update load_config to include new fields**

In the `load_config` function, add to the defaults return (inside the `Ok(AppConfig { ... })` block starting at line 43):

```rust
            claude_defaults: None,
            worktree_overrides: None,
```

And to the parsed config mapping (inside the `Ok(AppConfig { ... })` block starting at line 64):

```rust
        claude_defaults: file.claude_defaults,
        worktree_overrides: file.worktree_overrides,
```

- [ ] **Step 3: Update save_config to persist new fields**

In the `save_config` function, add to the `ConfigFile` construction (inside the `let file = ConfigFile { ... }` block starting at line 82):

```rust
        claude_defaults: config.claude_defaults.clone(),
        worktree_overrides: config.worktree_overrides.clone(),
```

- [ ] **Step 4: Update tests to include new fields**

In the `test_save_and_load_config` test, add new fields to the `AppConfig` literal (after `archive_after_days: Some(2),`):

```rust
            claude_defaults: Some(ClaudeDefaults {
                model: Some("claude-sonnet-4-6".into()),
                effort: Some("high".into()),
                ..Default::default()
            }),
            worktree_overrides: None,
```

After `save_config` and `load_config`, assert:

```rust
        assert_eq!(
            loaded.claude_defaults.as_ref().unwrap().model,
            Some("claude-sonnet-4-6".to_string())
        );
```

- [ ] **Step 5: Run Rust tests**

Run: `cd /Users/chloe/dev/alfredo/src-tauri && cargo test config_manager 2>&1 | tail -20`
Expected: All 3 tests pass

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/config_manager.rs
git commit -m "feat: persist Claude settings in .alfredo.json"
```

---

### Task 3: Settings Resolver Service

**Files:**
- Create: `src/services/claudeSettingsResolver.ts`

- [ ] **Step 1: Create the resolver**

```typescript
import type { ClaudeDefaults, ClaudeOverrides } from "../types";

export interface ResolvedClaudeSettings {
  model?: string;
  effort?: string;
  permissionMode?: string;
  dangerouslySkipPermissions?: boolean;
  outputStyle?: string;
  verbose?: boolean;
}

/**
 * Merge global defaults with per-branch overrides.
 * Override fields take precedence; only defined fields are merged.
 */
export function resolveSettings(
  defaults?: ClaudeDefaults,
  overrides?: ClaudeOverrides,
): ResolvedClaudeSettings {
  return {
    model: overrides?.model ?? defaults?.model,
    effort: overrides?.effort ?? defaults?.effort,
    permissionMode: overrides?.permissionMode ?? defaults?.permissionMode,
    dangerouslySkipPermissions: defaults?.dangerouslySkipPermissions,
    outputStyle: overrides?.outputStyle ?? defaults?.outputStyle,
    verbose: defaults?.verbose,
  };
}

/**
 * Convert resolved settings to an array of CLI flags for claude.
 * Note: outputStyle requires a temp settings file — call buildOutputStyleFile()
 * separately and pass the path via --settings. This function handles all other flags.
 */
export function buildClaudeArgs(settings: ResolvedClaudeSettings): string[] {
  const args: string[] = [];

  if (settings.model) {
    args.push("--model", settings.model);
  }
  if (settings.effort) {
    args.push("--effort", settings.effort);
  }
  if (settings.permissionMode && settings.permissionMode !== "default") {
    args.push("--permission-mode", settings.permissionMode);
  }
  if (settings.dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions");
  }
  if (settings.verbose) {
    args.push("--verbose");
  }

  return args;
}

/**
 * If outputStyle is set and not "Default", returns the JSON content for a
 * temporary settings file. The caller is responsible for writing this to disk
 * and appending `--settings <path>` to the args array.
 *
 * Returns null if no settings file is needed.
 */
export function buildOutputStyleFileContent(
  settings: ResolvedClaudeSettings,
): string | null {
  if (!settings.outputStyle || settings.outputStyle === "Default") return null;
  return JSON.stringify({ outputStyle: settings.outputStyle }, null, 2);
}

/**
 * Extract the overridable subset of resolved settings for snapshot comparison.
 * Used in WorkspaceTab.claudeSettings to detect settings changes on restore.
 */
export function settingsSnapshot(
  settings: ResolvedClaudeSettings,
): { model?: string; effort?: string; permissionMode?: string; outputStyle?: string } {
  return {
    model: settings.model,
    effort: settings.effort,
    permissionMode: settings.permissionMode,
    outputStyle: settings.outputStyle,
  };
}

/**
 * Compare two settings snapshots and return a human-readable diff.
 * Returns null if they are identical.
 */
export function diffSettings(
  saved: { model?: string; effort?: string; permissionMode?: string; outputStyle?: string } | undefined,
  current: { model?: string; effort?: string; permissionMode?: string; outputStyle?: string },
): string | null {
  if (!saved) return null;

  const changes: string[] = [];
  if (saved.model !== current.model) {
    changes.push(`model: ${saved.model ?? "default"} → ${current.model ?? "default"}`);
  }
  if (saved.effort !== current.effort) {
    changes.push(`effort: ${saved.effort ?? "default"} → ${current.effort ?? "default"}`);
  }
  if (saved.permissionMode !== current.permissionMode) {
    changes.push(`permissions: ${saved.permissionMode ?? "default"} → ${current.permissionMode ?? "default"}`);
  }
  if (saved.outputStyle !== current.outputStyle) {
    changes.push(`output: ${saved.outputStyle ?? "default"} → ${current.outputStyle ?? "default"}`);
  }

  return changes.length > 0 ? changes.join(", ") : null;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/services/claudeSettingsResolver.ts
git commit -m "feat: add Claude settings resolver and CLI args builder"
```

---

### Task 4: Update SessionManager to Accept Args

**Files:**
- Modify: `src/services/sessionManager.ts:47-140`

- [ ] **Step 1: Add args parameter to getOrSpawn()**

Update the `getOrSpawn` method signature (line 47) to accept an optional `args` parameter:

```typescript
  async getOrSpawn(
    sessionKey: string,
    worktreeId: string,
    worktreePath: string,
    mode: "claude" | "shell" = "claude",
    initialScrollback?: string,
    args?: string[],
  ): Promise<ManagedSession> {
```

Then update the `spawnPty` call (lines 120-127) to pass the args:

```typescript
    const sessionId = await spawnPty(
      worktreeId,
      worktreePath,
      command,
      args ?? [],
      channel,
      agentType,
    );
```

- [ ] **Step 2: Add loadScrollbackOnly() method for disconnected tabs**

Add this method to the `SessionManager` class (after the `getOrSpawn` method, before `getSession`):

```typescript
  /**
   * Create a terminal with scrollback loaded but no PTY process spawned.
   * Used for session restore — the user decides whether to resume or start fresh.
   */
  loadScrollbackOnly(
    sessionKey: string,
    initialScrollback?: string,
  ): ManagedSession {
    const existing = this.sessions.get(sessionKey);
    if (existing) return existing;

    const terminal = new Terminal({
      allowProposedApi: true,
      scrollback: 10_000,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    if (initialScrollback) {
      try {
        const bytes = Uint8Array.from(atob(initialScrollback), (c) => c.charCodeAt(0));
        terminal.write(bytes);
      } catch {
        // Invalid base64 — skip replay
      }
    }

    const session: ManagedSession = {
      sessionId: "", // No PTY — filled when user chooses to spawn
      terminal,
      fitAddon,
      agentState: "notRunning",
      lastHookUpdate: 0,
      outputBuffer: new Uint8Array(OUTPUT_BUFFER_CAPACITY),
      outputBufferPos: 0,
      outputBufferTotal: 0,
    };

    this.sessions.set(sessionKey, session);
    return session;
  }

  /**
   * Spawn a PTY for an existing disconnected session (one created by loadScrollbackOnly).
   * Wires up the Tauri channel and starts pumping events.
   */
  async spawnForExisting(
    sessionKey: string,
    worktreeId: string,
    worktreePath: string,
    mode: "claude" | "shell" = "claude",
    args?: string[],
  ): Promise<ManagedSession> {
    const session = this.sessions.get(sessionKey);
    if (!session) throw new Error(`No session found for key: ${sessionKey}`);
    if (session.sessionId) return session; // Already spawned

    const channel = createPtyChannel((event) => {
      switch (event.event) {
        case "output": {
          const bytes = new Uint8Array(event.data);
          session.terminal.write(bytes);
          this.appendToBuffer(session, bytes);
          break;
        }
        case "hookAgentState": {
          session.agentState = event.data;
          session.lastHookUpdate = Date.now();
          useWorkspaceStore
            .getState()
            .updateWorktree(worktreeId, { agentStatus: event.data });
          break;
        }
        case "agentState": {
          if (Date.now() - session.lastHookUpdate < HOOK_AUTHORITY_MS) {
            break;
          }
          session.agentState = event.data;
          useWorkspaceStore
            .getState()
            .updateWorktree(worktreeId, { agentStatus: event.data });
          break;
        }
      }
    });

    const command = mode === "shell" ? "/bin/zsh" : "claude";
    const agentType = mode === "claude" ? "claudeCode" : undefined;

    const sessionId = await spawnPty(
      worktreeId,
      worktreePath,
      command,
      args ?? [],
      channel,
      agentType,
    );
    session.sessionId = sessionId;
    session.agentState = mode === "shell" ? "notRunning" : "idle";
    session.lastHookUpdate = Date.now();

    if (mode === "claude") {
      useWorkspaceStore
        .getState()
        .updateWorktree(worktreeId, { agentStatus: session.agentState });
    }

    return session;
  }
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/services/sessionManager.ts
git commit -m "feat: sessionManager accepts CLI args and supports disconnected mode"
```

---

### Task 5: Add disconnectedTabs to Workspace Store

**Files:**
- Modify: `src/stores/workspaceStore.ts:12-56,68-79,334-338,351-364`

- [ ] **Step 1: Add disconnectedTabs state and actions**

Add to the `WorkspaceState` interface (after `archiveAfterDays` on line 30):

```typescript
  /** Tab IDs awaiting resume/fresh decision after app restart. */
  disconnectedTabs: Set<string>;
```

Add actions (after `clearStore` declaration on line 55):

```typescript
  addDisconnectedTab: (tabId: string) => void;
  removeDisconnectedTab: (tabId: string) => void;
  isTabDisconnected: (tabId: string) => boolean;
```

- [ ] **Step 2: Initialize state and implement actions**

Add to the initial state in the `create` call (after `checkRuns: {}` on line 79):

```typescript
  disconnectedTabs: new Set<string>(),
```

Add action implementations (before the `clearStore` action):

```typescript
  addDisconnectedTab: (tabId) =>
    set((state) => ({
      disconnectedTabs: new Set(state.disconnectedTabs).add(tabId),
    })),

  removeDisconnectedTab: (tabId) =>
    set((state) => {
      const next = new Set(state.disconnectedTabs);
      next.delete(tabId);
      return { disconnectedTabs: next };
    }),

  isTabDisconnected: (tabId) => get().disconnectedTabs.has(tabId),
```

- [ ] **Step 3: Add disconnectedTabs to clearStore**

Update the `clearStore` action to also reset `disconnectedTabs`:

```typescript
  clearStore: () =>
    set({
      worktrees: [],
      activeWorktreeId: null,
      columnOverrides: {},
      lastPrState: {},
      seenWorktrees: new Set<string>(),
      tabs: {},
      activeTabId: {},
      annotations: {},
      sidebarCollapsed: false,
      archiveAfterDays: 2,
      checkRuns: {},
      disconnectedTabs: new Set<string>(),
    }),
```

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/stores/workspaceStore.ts
git commit -m "feat: add disconnectedTabs tracking to workspace store"
```

---

### Task 6: Update usePty Hook for Disconnected Mode

**Files:**
- Modify: `src/hooks/usePty.ts`

- [ ] **Step 1: Add disconnected and args options**

Update the `UsePtyOptions` interface to:

```typescript
interface UsePtyOptions {
  sessionKey: string;
  worktreeId: string;
  worktreePath: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  mode?: "claude" | "shell";
  initialScrollback?: string;
  /** CLI args to pass to the spawned process. */
  args?: string[];
  /** If true, load scrollback but don't spawn a PTY process. */
  disconnected?: boolean;
}
```

- [ ] **Step 2: Update the attach function to handle disconnected mode**

Update the function signature to accept `args` and `disconnected`:

```typescript
export function usePty({
  sessionKey,
  worktreeId,
  worktreePath,
  containerRef,
  mode = "claude",
  initialScrollback,
  args,
  disconnected = false,
}: UsePtyOptions): UsePtyReturn {
```

Replace the `attach` function body inside the `useEffect` (the `async function attach()` block) with:

```typescript
    async function attach() {
      let session: ManagedSession;

      if (disconnected) {
        // Load scrollback without spawning — user will choose resume/fresh
        session = sessionManager.loadScrollbackOnly(sessionKey, initialScrollback);
      } else {
        session = await sessionManager.getOrSpawn(
          sessionKey, worktreeId, worktreePath, mode, initialScrollback, args,
        );
      }
      if (disposed) return;

      sessionRef.current = session;
      const { terminal: term, fitAddon } = session;

      if (term.element) {
        container.appendChild(term.element);
      } else {
        term.open(container);
      }

      try {
        fitAddon.fit();
      } catch {
        // Container might not be visible yet
      }

      // Only wire up input forwarding if we have a live PTY
      if (session.sessionId) {
        onDataDisposable = term.onData((data: string) => {
          const bytes = Array.from(new TextEncoder().encode(data));
          writePty(session.sessionId, bytes).catch(console.error);
        });

        onResizeDisposable = term.onResize(
          ({ rows, cols }: { rows: number; cols: number }) => {
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
              resizePty(session.sessionId, rows, cols).catch(console.error);
            }, 100);
          },
        );
      }

      resizeObserver = new ResizeObserver(() => {
        try {
          fitAddon.fit();
        } catch {
          // ignore
        }
      });
      resizeObserver.observe(container);

      setTerminal(term);
      setAgentState(session.agentState);
      setIsConnected(!disconnected);
    }
```

- [ ] **Step 3: Update the effect dependency array**

Update the dependency array at the end of the useEffect (line 139):

```typescript
  }, [sessionKey, worktreeId, worktreePath, mode, containerRef, initialScrollback, args, disconnected]);
```

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePty.ts
git commit -m "feat: usePty supports disconnected mode and CLI args"
```

---

### Task 7: Session Resume Overlay Component

**Files:**
- Create: `src/components/terminal/SessionResumeOverlay.tsx`

- [ ] **Step 1: Create the overlay component**

```typescript
import { useCallback, useEffect } from "react";
import { RotateCcw, Plus } from "lucide-react";
import { Button } from "../ui/Button";

interface SessionResumeOverlayProps {
  settingsChangedText: string | null;
  onResume: () => void;
  onStartFresh: () => void;
}

function SessionResumeOverlay({
  settingsChangedText,
  onResume,
  onStartFresh,
}: SessionResumeOverlayProps) {
  // Enter → Resume, Escape → dismiss (handled by parent)
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onResume();
      }
    },
    [onResume],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-accent-primary/20 bg-bg-primary/95 backdrop-blur-sm px-4 py-3 flex items-center justify-between">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm text-text-secondary">
          Previous session ended
        </span>
        {settingsChangedText && (
          <span className="text-xs text-text-tertiary">
            Settings changed: {settingsChangedText}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" onClick={onResume}>
          <RotateCcw size={12} />
          Resume conversation
        </Button>
        <Button size="sm" variant="ghost" onClick={onStartFresh}>
          <Plus size={12} />
          Start fresh
        </Button>
      </div>
    </div>
  );
}

export { SessionResumeOverlay };
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/terminal/SessionResumeOverlay.tsx
git commit -m "feat: add SessionResumeOverlay component"
```

---

### Task 8: Wire Up TerminalView with Disconnected Mode + Overlay

**Files:**
- Modify: `src/components/terminal/TerminalView.tsx`

- [ ] **Step 1: Import new dependencies**

Add imports at the top of `TerminalView.tsx`:

```typescript
import { SessionResumeOverlay } from "./SessionResumeOverlay";
import { sessionManager } from "../../services/sessionManager";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import {
  resolveSettings,
  buildClaudeArgs,
  settingsSnapshot,
  diffSettings,
} from "../../services/claudeSettingsResolver";
import { getConfig } from "../../api";
```

Note: `sessionManager` and `useWorkspaceStore` are already imported — just add the others.

- [ ] **Step 2: Add disconnected state and settings resolution**

Inside the `TerminalView` function, after the existing `savedScrollback` state (line 41), add:

```typescript
  const isDisconnected = useWorkspaceStore((s) =>
    tabId ? s.disconnectedTabs.has(tabId) : false,
  );
  const removeDisconnectedTab = useWorkspaceStore((s) => s.removeDisconnectedTab);

  // Get the current tab's saved settings for change detection
  const currentTab = useWorkspaceStore((s) => {
    if (!activeWorktreeId || !tabId) return undefined;
    return s.tabs[activeWorktreeId]?.find((t) => t.id === tabId);
  });

  const [resolvedArgs, setResolvedArgs] = useState<string[]>([]);
  const [currentSnapshot, setCurrentSnapshot] = useState<{
    model?: string; effort?: string; permissionMode?: string; outputStyle?: string;
  }>({});

  // Resolve settings when component mounts
  useEffect(() => {
    if (mode !== "claude" || !repoPath) return;
    getConfig(repoPath).then((config) => {
      const branch = worktree?.branch ?? "";
      const resolved = resolveSettings(
        config.claudeDefaults,
        config.worktreeOverrides?.[branch],
      );
      setResolvedArgs(buildClaudeArgs(resolved));
      setCurrentSnapshot(settingsSnapshot(resolved));
    }).catch(() => {});
  }, [repoPath, worktree?.branch, mode]);

  const settingsChangedText = diffSettings(currentTab?.claudeSettings, currentSnapshot);
```

- [ ] **Step 3: Pass disconnected and args to usePty**

Update the `usePty` call to:

```typescript
  const { agentState } = usePty({
    sessionKey,
    worktreeId: activeWorktreeId ?? "",
    worktreePath: worktree?.path ?? "",
    containerRef,
    mode,
    initialScrollback: savedScrollback,
    args: resolvedArgs,
    disconnected: isDisconnected,
  });
```

- [ ] **Step 4: Add resume and start-fresh handlers**

Add these handlers after the existing `handleClearAnnotations`:

```typescript
  const handleResume = useCallback(async () => {
    if (!tabId || !activeWorktreeId || !worktree) return;
    removeDisconnectedTab(tabId);

    // Spawn with --continue plus current settings
    const resumeArgs = ["--continue", ...resolvedArgs];
    await sessionManager.spawnForExisting(
      sessionKey,
      activeWorktreeId,
      worktree.path,
      "claude",
      resumeArgs,
    );

    // Wire up input forwarding after spawn
    const session = sessionManager.getSession(sessionKey);
    if (session?.sessionId && containerRef.current) {
      session.terminal.onData((data: string) => {
        const bytes = Array.from(new TextEncoder().encode(data));
        writePty(session.sessionId, bytes).catch(console.error);
      });
    }
  }, [tabId, activeWorktreeId, worktree, sessionKey, resolvedArgs, removeDisconnectedTab]);

  const handleStartFresh = useCallback(async () => {
    if (!tabId || !activeWorktreeId || !worktree) return;
    removeDisconnectedTab(tabId);

    // Close the scrollback-only session and clear the terminal
    await sessionManager.closeSession(sessionKey);

    // getOrSpawn will create a fresh session (no scrollback, no --continue)
    await sessionManager.getOrSpawn(
      sessionKey,
      activeWorktreeId,
      worktree.path,
      "claude",
      undefined,
      resolvedArgs,
    );

    // Wire up input forwarding
    const session = sessionManager.getSession(sessionKey);
    if (session?.sessionId && containerRef.current) {
      const term = session.terminal;
      // Re-attach to DOM
      if (term.element && containerRef.current) {
        containerRef.current.appendChild(term.element);
      } else if (containerRef.current) {
        term.open(containerRef.current);
      }
      term.onData((data: string) => {
        const bytes = Array.from(new TextEncoder().encode(data));
        writePty(session.sessionId, bytes).catch(console.error);
      });
    }
  }, [tabId, activeWorktreeId, worktree, sessionKey, resolvedArgs, removeDisconnectedTab]);
```

- [ ] **Step 5: Render the overlay**

Update the return JSX. Add the overlay inside the main container div, after the annotation bar and before the terminal container div. Change the terminal container to `relative`:

```typescript
  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {annotations.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-1.5 bg-accent-primary/8 border-b border-accent-primary/20 flex-shrink-0">
          {/* ... existing annotation bar ... */}
        </div>
      )}
      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="h-full p-1" />
        {isDisconnected && (
          <SessionResumeOverlay
            settingsChangedText={settingsChangedText}
            onResume={handleResume}
            onStartFresh={handleStartFresh}
          />
        )}
      </div>
    </div>
  );
```

- [ ] **Step 6: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/components/terminal/TerminalView.tsx
git commit -m "feat: TerminalView renders resume overlay for disconnected tabs"
```

---

### Task 9: Update AppShell to Mark Claude Tabs as Disconnected on Restore

**Files:**
- Modify: `src/components/layout/AppShell.tsx:245-251`

- [ ] **Step 1: Mark restored Claude tabs as disconnected**

In `AppShell.tsx`, find the session restore loop (lines 246-251). After `restoreTabs`, add logic to mark Claude tabs as disconnected:

```typescript
        // Restore saved sessions for each worktree
        for (const wt of wts) {
          const session = await loadSession(repoPath, wt.id);
          if (session) {
            restoreTabs(wt.id, session.tabs, session.activeTabId);
            // Mark Claude tabs as disconnected — user decides resume/fresh
            for (const tab of session.tabs) {
              if (tab.type === "claude") {
                useWorkspaceStore.getState().addDisconnectedTab(tab.id);
              }
            }
          }
        }
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/AppShell.tsx
git commit -m "feat: mark restored Claude tabs as disconnected on app startup"
```

---

### Task 10: Agent Settings Tab in Global Settings Dialog

**Files:**
- Create: `src/components/settings/AgentSettings.tsx`
- Modify: `src/components/settings/GlobalSettingsDialog.tsx`

- [ ] **Step 1: Create AgentSettings component**

```typescript
import type { ClaudeDefaults } from "../../types";

const MODEL_OPTIONS = [
  { value: "claude-opus-4-6", label: "Opus 4.6 (1M context)" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6 (200K context)" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5 (200K context)" },
];

const EFFORT_OPTIONS = ["low", "medium", "high", "max"] as const;

const PERMISSION_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "accept-edits", label: "Accept Edits" },
  { value: "plan", label: "Plan" },
  { value: "auto", label: "Auto" },
];

const OUTPUT_OPTIONS = ["Default", "Explanatory", "Learning"] as const;

interface AgentSettingsProps {
  settings: ClaudeDefaults;
  onChange: (settings: ClaudeDefaults) => void;
}

function AgentSettings({ settings, onChange }: AgentSettingsProps) {
  const update = (patch: Partial<ClaudeDefaults>) =>
    onChange({ ...settings, ...patch });

  return (
    <div className="space-y-6">
      <p className="text-xs text-text-tertiary">
        Default settings for all new sessions — Override per worktree using the
        gear icon in the status bar.
      </p>

      {/* Model & Performance */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-text-primary">
          Model & Performance
        </h3>

        <div className="space-y-1.5">
          <label className="text-xs text-text-secondary">Model</label>
          <select
            value={settings.model ?? ""}
            onChange={(e) => update({ model: e.target.value || undefined })}
            className="w-full px-3 py-1.5 text-sm bg-bg-hover text-text-primary border border-border-default rounded-[var(--radius-md)] focus:outline-none focus:ring-1 focus:ring-accent-primary"
          >
            <option value="">Default</option>
            {MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-text-secondary">Effort</label>
          <div className="flex rounded-[var(--radius-md)] border border-border-default overflow-hidden">
            {EFFORT_OPTIONS.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => update({ effort: level })}
                className={[
                  "flex-1 px-3 py-1.5 text-xs font-medium capitalize transition-colors cursor-pointer",
                  settings.effort === level
                    ? "bg-accent-primary text-white"
                    : "bg-bg-hover text-text-secondary hover:text-text-primary",
                ].join(" ")}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Permissions */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-text-primary">Permissions</h3>

        <div className="space-y-1.5">
          <label className="text-xs text-text-secondary">Permission Mode</label>
          <select
            value={settings.permissionMode ?? "default"}
            onChange={(e) =>
              update({
                permissionMode:
                  e.target.value === "default" ? undefined : e.target.value,
              })
            }
            className="w-full px-3 py-1.5 text-sm bg-bg-hover text-text-primary border border-border-default rounded-[var(--radius-md)] focus:outline-none focus:ring-1 focus:ring-accent-primary"
          >
            {PERMISSION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <label className="text-xs text-text-secondary">
              Skip Permissions
            </label>
            <p className="text-xs text-text-tertiary">
              Dangerously skip all permission prompts
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              update({
                dangerouslySkipPermissions:
                  !settings.dangerouslySkipPermissions,
              })
            }
            className={[
              "relative w-9 h-5 rounded-full transition-colors cursor-pointer",
              settings.dangerouslySkipPermissions
                ? "bg-accent-primary"
                : "bg-bg-hover border border-border-default",
            ].join(" ")}
          >
            <span
              className={[
                "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                settings.dangerouslySkipPermissions
                  ? "translate-x-4"
                  : "translate-x-0",
              ].join(" ")}
            />
          </button>
        </div>
      </div>

      {/* Output */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-text-primary">Output</h3>

        <div className="space-y-1.5">
          <label className="text-xs text-text-secondary">Output Style</label>
          <div className="flex rounded-[var(--radius-md)] border border-border-default overflow-hidden">
            {OUTPUT_OPTIONS.map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => update({ outputStyle: style })}
                className={[
                  "flex-1 px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                  (settings.outputStyle ?? "Default") === style
                    ? "bg-accent-primary text-white"
                    : "bg-bg-hover text-text-secondary hover:text-text-primary",
                ].join(" ")}
              >
                {style}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <label className="text-xs text-text-secondary">Verbose output</label>
          <button
            type="button"
            onClick={() => update({ verbose: !settings.verbose })}
            className={[
              "relative w-9 h-5 rounded-full transition-colors cursor-pointer",
              settings.verbose
                ? "bg-accent-primary"
                : "bg-bg-hover border border-border-default",
            ].join(" ")}
          >
            <span
              className={[
                "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                settings.verbose ? "translate-x-4" : "translate-x-0",
              ].join(" ")}
            />
          </button>
        </div>
      </div>

      <p className="text-xs text-text-tertiary pt-2 border-t border-border-default">
        Applies to new sessions — existing sessions keep their settings.
      </p>
    </div>
  );
}

export { AgentSettings };
```

- [ ] **Step 2: Add "Agent" tab to GlobalSettingsDialog**

In `GlobalSettingsDialog.tsx`, update the `GlobalTab` type (line 17):

```typescript
type GlobalTab =
  | "appearance"
  | "terminal"
  | "agent"
  | "notifications"
  | "integrations"
  | "shortcuts";
```

Update the `TABS` array (line 24) to include "Agent" after "Terminal":

```typescript
const TABS: { id: GlobalTab; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "terminal", label: "Terminal" },
  { id: "agent", label: "Agent" },
  { id: "notifications", label: "Notifications" },
  { id: "integrations", label: "Integrations" },
  { id: "shortcuts", label: "Shortcuts" },
];
```

Add the import at the top:

```typescript
import { AgentSettings } from "./AgentSettings";
```

Add the tab content rendering (after the `{tab === "terminal" ...}` block, around line 173):

```typescript
            {tab === "agent" && (
              <AgentSettings
                settings={repoConfig.claudeDefaults ?? {}}
                onChange={(claudeDefaults) =>
                  updateRepoConfig({ claudeDefaults })
                }
              />
            )}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/AgentSettings.tsx src/components/settings/GlobalSettingsDialog.tsx
git commit -m "feat: add Agent tab to Global Settings dialog"
```

---

### Task 11: Per-Worktree Override Popover

**Files:**
- Create: `src/components/terminal/AgentSettingsPopover.tsx`

- [ ] **Step 1: Create the popover component**

```typescript
import { useState, useEffect, useCallback } from "react";
import { Settings, RotateCcw } from "lucide-react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { getConfig, saveConfig } from "../../api";
import { useAppConfig } from "../../hooks/useAppConfig";
import type { ClaudeOverrides } from "../../types";

const MODEL_OPTIONS = [
  { value: "", label: "Default" },
  { value: "claude-opus-4-6", label: "Opus 4.6" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5" },
];

const EFFORT_OPTIONS = ["low", "medium", "high", "max"] as const;
const PERMISSION_OPTIONS = [
  { value: "", label: "Default" },
  { value: "accept-edits", label: "Accept Edits" },
  { value: "plan", label: "Plan" },
  { value: "auto", label: "Auto" },
];
const OUTPUT_OPTIONS = ["Default", "Explanatory", "Learning"] as const;

interface AgentSettingsPopoverProps {
  branch: string;
  onRestartSession: () => void;
}

function AgentSettingsPopover({ branch, onRestartSession }: AgentSettingsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [overrides, setOverrides] = useState<ClaudeOverrides>({});
  const { activeRepo: repoPath } = useAppConfig();

  useEffect(() => {
    if (!open || !repoPath) return;
    getConfig(repoPath).then((config) => {
      setOverrides(config.worktreeOverrides?.[branch] ?? {});
    }).catch(() => {});
  }, [open, repoPath, branch]);

  const hasOverrides = Object.values(overrides).some((v) => v !== undefined);

  const save = useCallback(async (next: ClaudeOverrides) => {
    if (!repoPath) return;
    const config = await getConfig(repoPath);
    const allOverrides = { ...config.worktreeOverrides };

    // Clean out undefined values
    const cleaned: ClaudeOverrides = {};
    if (next.model) cleaned.model = next.model;
    if (next.effort) cleaned.effort = next.effort;
    if (next.permissionMode) cleaned.permissionMode = next.permissionMode;
    if (next.outputStyle && next.outputStyle !== "Default") cleaned.outputStyle = next.outputStyle;

    if (Object.keys(cleaned).length > 0) {
      allOverrides[branch] = cleaned;
    } else {
      delete allOverrides[branch];
    }

    await saveConfig(repoPath, {
      ...config,
      worktreeOverrides: Object.keys(allOverrides).length > 0 ? allOverrides : undefined,
    });
  }, [repoPath, branch]);

  const update = useCallback(async (patch: Partial<ClaudeOverrides>) => {
    const next = { ...overrides, ...patch };
    setOverrides(next);
    await save(next);
  }, [overrides, save]);

  const resetAll = useCallback(async () => {
    setOverrides({});
    await save({});
  }, [save]);

  if (!open) {
    return (
      <IconButton
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        tooltip="Agent settings for this worktree"
      >
        <Settings size={14} className={hasOverrides ? "text-accent-primary" : ""} />
      </IconButton>
    );
  }

  return (
    <>
      <IconButton
        size="sm"
        variant="ghost"
        onClick={() => setOpen(false)}
        tooltip="Close agent settings"
      >
        <Settings size={14} className="text-accent-primary" />
      </IconButton>

      {/* Popover */}
      <div className="absolute bottom-full right-0 mb-2 w-72 bg-bg-primary border border-border-default rounded-[var(--radius-lg)] shadow-lg p-4 space-y-3 z-50">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-text-primary">
            Worktree Settings
          </h3>
          {hasOverrides && (
            <button
              type="button"
              onClick={resetAll}
              className="text-xs text-accent-primary hover:underline cursor-pointer"
            >
              Reset all
            </button>
          )}
        </div>

        {/* Model */}
        <div className="space-y-1">
          <label className="text-xs text-text-secondary">Model</label>
          <select
            value={overrides.model ?? ""}
            onChange={(e) => update({ model: e.target.value || undefined })}
            className={[
              "w-full px-2 py-1 text-xs bg-bg-hover text-text-primary border rounded-[var(--radius-sm)] focus:outline-none focus:ring-1 focus:ring-accent-primary",
              overrides.model ? "border-accent-primary text-accent-primary" : "border-border-default",
            ].join(" ")}
          >
            {MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Effort */}
        <div className="space-y-1">
          <label className="text-xs text-text-secondary">Effort</label>
          <div className="flex rounded-[var(--radius-sm)] border border-border-default overflow-hidden">
            {EFFORT_OPTIONS.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => update({ effort: overrides.effort === level ? undefined : level })}
                className={[
                  "flex-1 px-2 py-1 text-xs capitalize transition-colors cursor-pointer",
                  overrides.effort === level
                    ? "bg-accent-primary text-white"
                    : "bg-bg-hover text-text-secondary hover:text-text-primary",
                ].join(" ")}
              >
                {level}
              </button>
            ))}
          </div>
        </div>

        {/* Output Style */}
        <div className="space-y-1">
          <label className="text-xs text-text-secondary">Output Style</label>
          <div className="flex rounded-[var(--radius-sm)] border border-border-default overflow-hidden">
            {OUTPUT_OPTIONS.map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => update({ outputStyle: overrides.outputStyle === style ? undefined : style })}
                className={[
                  "flex-1 px-2 py-1 text-xs transition-colors cursor-pointer",
                  overrides.outputStyle === style
                    ? "bg-accent-primary text-white"
                    : "bg-bg-hover text-text-secondary hover:text-text-primary",
                ].join(" ")}
              >
                {style}
              </button>
            ))}
          </div>
        </div>

        {/* Permission Mode */}
        <div className="space-y-1">
          <label className="text-xs text-text-secondary">Permission Mode</label>
          <select
            value={overrides.permissionMode ?? ""}
            onChange={(e) => update({ permissionMode: e.target.value || undefined })}
            className={[
              "w-full px-2 py-1 text-xs bg-bg-hover text-text-primary border rounded-[var(--radius-sm)] focus:outline-none focus:ring-1 focus:ring-accent-primary",
              overrides.permissionMode ? "border-accent-primary" : "border-border-default",
            ].join(" ")}
          >
            {PERMISSION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-border-default flex items-center justify-between">
          <span className="text-xs text-text-tertiary">Requires session restart</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setOpen(false);
              onRestartSession();
            }}
          >
            <RotateCcw size={10} />
            Restart now
          </Button>
        </div>
      </div>
    </>
  );
}

export { AgentSettingsPopover };
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/terminal/AgentSettingsPopover.tsx
git commit -m "feat: add per-worktree agent settings popover"
```

---

### Task 12: Wire AgentSettingsPopover into Status Bar

**Files:**
- Modify: Wherever the status bar is rendered (likely in `AppShell.tsx` or a dedicated status bar component)

- [ ] **Step 1: Find and read the status bar component**

Search for the status bar in the codebase. Look for components that render the bottom bar of the terminal area, annotation count badge, or similar status indicators. The spec says the gear icon goes "in the status bar after the annotation count badge."

Run: `cd /Users/chloe/dev/alfredo && grep -rn "status.bar\|StatusBar\|statusbar\|annotation.*badge\|badge.*annotation" src/components/ --include="*.tsx" | head -20`

Then read the identified file and add the `AgentSettingsPopover` next to the existing status elements. The popover needs:
- `branch` prop from the active worktree
- `onRestartSession` callback that kills the current PTY and respawns with new settings

Implementation details depend on the exact status bar structure — the implementer should read the file and place the gear icon appropriately.

- [ ] **Step 2: Add restart session logic**

The `onRestartSession` handler should:
1. Get the active Claude tab's session key
2. Call `sessionManager.closeSession(sessionKey)`
3. Resolve fresh settings via `resolveSettings()`
4. Call `sessionManager.getOrSpawn()` with new args

- [ ] **Step 3: Verify it compiles and commit**

```bash
git add <modified-status-bar-file>
git commit -m "feat: add agent settings gear icon to status bar"
```

---

### Task 13: Save Settings Snapshot in Tab on Spawn

**Files:**
- Modify: `src/services/sessionManager.ts`
- Modify: `src/stores/workspaceStore.ts`

- [ ] **Step 1: Add updateTab action to workspace store**

Add to the `WorkspaceState` interface:

```typescript
  updateTab: (worktreeId: string, tabId: string, patch: Partial<WorkspaceTab>) => void;
```

Implement it:

```typescript
  updateTab: (worktreeId, tabId, patch) =>
    set((state) => ({
      tabs: {
        ...state.tabs,
        [worktreeId]: (state.tabs[worktreeId] ?? []).map((t) =>
          t.id === tabId ? { ...t, ...patch } : t,
        ),
      },
    })),
```

- [ ] **Step 2: Snapshot settings when spawning**

In `sessionManager.ts`, in both `getOrSpawn()` and `spawnForExisting()`, after the PTY is successfully spawned (after `session.sessionId = sessionId`), call the store to save the command, args, and settings snapshot.

This requires the caller to pass the settings snapshot — update the method signatures to accept an optional `claudeSettings` parameter, or have `TerminalView` call `updateTab` after spawn. The cleaner approach is to have `TerminalView` update the tab after spawning:

In `TerminalView.tsx`, after `handleResume` and `handleStartFresh` successfully spawn, add:

```typescript
    // Save settings snapshot to tab for future change detection
    if (activeWorktreeId && tabId) {
      useWorkspaceStore.getState().updateTab(activeWorktreeId, tabId, {
        command: "claude",
        args: resumeArgs, // or resolvedArgs for fresh
        claudeSettings: currentSnapshot,
      });
    }
```

Also add this to the initial `usePty` effect — when a non-disconnected Claude tab spawns for the first time, save the snapshot.

- [ ] **Step 3: Verify and commit**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | head -10`

```bash
git add src/stores/workspaceStore.ts src/components/terminal/TerminalView.tsx
git commit -m "feat: snapshot Claude settings into tab metadata on spawn"
```

---

### Task 14: Manual Testing & Polish

- [ ] **Step 1: Test global settings flow**

1. Open Alfredo
2. Open Settings → Agent tab
3. Set model to Sonnet, effort to High
4. Save
5. Open a new Claude tab — verify Claude starts with `--model claude-sonnet-4-6 --effort high`

Verification: Check the Rust PTY logs or add temporary console logging in `sessionManager.ts` to print the args being passed to `spawnPty`.

- [ ] **Step 2: Test per-worktree override flow**

1. Click gear icon in status bar
2. Override model to Haiku
3. Click "Restart now"
4. Verify session restarts with `--model claude-haiku-4-5 --effort high` (effort from global, model from override)

- [ ] **Step 3: Test session resume flow**

1. Have a Claude conversation in progress
2. Quit Alfredo
3. Reopen Alfredo
4. Verify scrollback is visible with compact overlay at bottom
5. Click "Resume conversation" — verify Claude starts with `--continue` and prior context is accessible
6. Repeat, but click "Start fresh" — verify terminal clears and Claude starts without `--continue`

- [ ] **Step 4: Test settings changed detection**

1. Start a Claude session with Opus model
2. Quit Alfredo
3. Change global model to Sonnet in `.alfredo.json`
4. Reopen Alfredo
5. Verify overlay shows "Settings changed: model: claude-opus-4-6 → claude-sonnet-4-6"

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "polish: minor fixes from manual testing"
```

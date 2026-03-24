# First-Run UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-screen first-run flow with a single OnboardingScreen that evolves in-place, hide the sidebar until the first worktree exists, and wire up the native directory picker.

**Architecture:** A new `OnboardingScreen` component with two states (welcome / create-worktree) replaces `WelcomeScreen` and `EmptyWorkspace`. Repo path is persisted via `tauri-plugin-store` (file-system-backed, survives WebView resets). A new `validate_git_repo` Tauri command validates paths. The Tauri dialog plugin provides the native OS directory picker. Tauri v2's `onDragDropEvent` handles folder drops. Framer Motion handles transitions.

**Tech Stack:** React, Tauri v2, Framer Motion, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-store`, `tauri-plugin-dialog`, `tauri-plugin-store`

**Spec:** `docs/superpowers/specs/2026-03-24-first-run-ux-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/components/onboarding/OnboardingScreen.tsx` | Single onboarding component with welcome + create-worktree states |
| Create | `src/hooks/useRepoPath.ts` | Persist/load repo path via tauri-plugin-store, validate with `validate_git_repo` |
| Modify | `src/components/layout/AppShell.tsx` | Replace two-screen logic with OnboardingScreen, hide sidebar during onboarding |
| Modify | `src/components/kanban/CreateWorktreeDialog.tsx` | Accept `repoPath` prop instead of hardcoding `"."` |
| Modify | `src-tauri/Cargo.toml:17-18` | Add `tauri-plugin-dialog` and `tauri-plugin-store` dependencies |
| Modify | `src-tauri/src/lib.rs:22-23` | Register dialog and store plugins, add `validate_git_repo` command |
| Modify | `src-tauri/capabilities/default.json:6-11` | Add dialog and store permissions |
| Create | `src-tauri/src/commands/repo.rs` | `validate_git_repo` Tauri command |
| Modify | `src-tauri/src/commands/mod.rs` (or equivalent) | Export new repo module |
| Delete | `src/components/empty/WelcomeScreen.tsx` | Replaced by OnboardingScreen |
| Delete | `src/components/empty/EmptyWorkspace.tsx` | Replaced by OnboardingScreen |

---

## Task 1: Install Tauri dialog and store plugins

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `package.json` (JS dependencies)

- [ ] **Step 1: Add Rust dependencies**

In `src-tauri/Cargo.toml`, add after line 18 (`tauri-plugin-shell = "2"`):

```toml
tauri-plugin-dialog = "2"
tauri-plugin-store = "2"
```

- [ ] **Step 2: Register plugins in Tauri builder**

In `src-tauri/src/lib.rs`, add after line 23 (`.plugin(tauri_plugin_shell::init())`):

```rust
.plugin(tauri_plugin_dialog::init())
.plugin(tauri_plugin_store::Builder::default().build())
```

- [ ] **Step 3: Add capability permissions**

In `src-tauri/capabilities/default.json`, update the permissions array:

```json
"permissions": [
  "core:default",
  "opener:default",
  "shell:allow-execute",
  "shell:allow-open",
  "dialog:default",
  "store:default"
]
```

- [ ] **Step 4: Install JS packages**

Run: `npm install @tauri-apps/plugin-dialog @tauri-apps/plugin-store`

- [ ] **Step 5: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles without errors

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/default.json package.json package-lock.json
git commit -m "feat: install tauri-plugin-dialog and tauri-plugin-store"
```

---

## Task 2: Add validate_git_repo Tauri command

**Files:**
- Modify: `src-tauri/src/commands/` (check if commands are a module dir or single file)
- Modify: `src-tauri/src/lib.rs` (register command)

First, check how commands are organized. The existing `lib.rs` imports `use commands::{branch, config, diff, github, linear, pty, worktree};` — so `commands` is a module with sub-modules.

- [ ] **Step 1: Check commands module structure**

Run: `ls src-tauri/src/commands/`
This determines whether to create `repo.rs` inside a `commands/` directory or add to an existing file.

- [ ] **Step 2: Create the validate_git_repo command**

If `commands/` is a directory with `mod.rs`, create `src-tauri/src/commands/repo.rs`:

```rust
use std::path::Path;

/// Check if a directory is a git repository (has .git dir or .git file).
#[tauri::command]
pub fn validate_git_repo(path: String) -> Result<bool, String> {
    let p = Path::new(&path);
    if !p.is_dir() {
        return Ok(false);
    }
    let git_path = p.join(".git");
    // .git can be a directory (normal repo) or a file (worktree)
    Ok(git_path.exists())
}
```

Then add `pub mod repo;` to `src-tauri/src/commands/mod.rs`.

If commands are organized differently (e.g., as separate files imported in `lib.rs`), follow the existing pattern and add the function to a new `src-tauri/src/commands/repo.rs` file.

- [ ] **Step 3: Register the command in lib.rs**

In `src-tauri/src/lib.rs`:

1. Add `repo` to the use statement: `use commands::{branch, config, diff, github, linear, pty, repo, worktree};`
2. Add `repo::validate_git_repo` to the `invoke_handler` macro, e.g. after the Config section:

```rust
// Repo
repo::validate_git_repo,
```

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles without errors

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/ src-tauri/src/lib.rs
git commit -m "feat: add validate_git_repo Tauri command"
```

---

## Task 3: Create useRepoPath hook with store persistence

**Files:**
- Create: `src/hooks/useRepoPath.ts`
- Create: `src/api.ts` (add `validateGitRepo` wrapper)

- [ ] **Step 1: Add validateGitRepo to api.ts**

Add at the end of `src/api.ts`:

```typescript
// ── Repo ───────────────────────────────────────────────────────

export function validateGitRepo(path: string): Promise<boolean> {
  return invoke("validate_git_repo", { path });
}
```

- [ ] **Step 2: Create the hook**

Create `src/hooks/useRepoPath.ts`:

```typescript
import { useState, useEffect, useCallback } from "react";
import { load } from "@tauri-apps/plugin-store";
import { validateGitRepo } from "../api";

const STORE_FILE = "app-settings.json";
const STORE_KEY = "repoPath";

export function useRepoPath() {
  const [repoPath, setRepoPathState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load persisted path on mount and validate it
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const store = await load(STORE_FILE);
        const stored = await store.get<string>(STORE_KEY);
        if (!stored) {
          if (!cancelled) setLoading(false);
          return;
        }

        const valid = await validateGitRepo(stored);
        if (!cancelled) {
          if (valid) {
            setRepoPathState(stored);
          } else {
            // Stale path — silently discard
            await store.delete(STORE_KEY);
            await store.save();
          }
          setLoading(false);
        }
      } catch {
        // Store not available (e.g., running in browser without Tauri)
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  const setRepoPath = useCallback(async (path: string) => {
    setError(null);
    try {
      const valid = await validateGitRepo(path);
      if (valid) {
        const store = await load(STORE_FILE);
        await store.set(STORE_KEY, path);
        await store.save();
        setRepoPathState(path);
      } else {
        setError("This folder isn't a git repository.");
      }
    } catch {
      setError("This folder isn't a git repository.");
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { repoPath, setRepoPath, error, clearError, loading } as const;
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build 2>&1 | head -20`
Expected: no TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useRepoPath.ts src/api.ts
git commit -m "feat: add useRepoPath hook with tauri-plugin-store persistence"
```

---

## Task 4: Create OnboardingScreen component

**Files:**
- Create: `src/components/onboarding/OnboardingScreen.tsx`

The drag-and-drop uses Tauri v2's `onDragDropEvent` from `@tauri-apps/api/webviewWindow` instead of DOM `File.path` (which is a Tauri v1 API). The `getCurrentWebviewWindow().onDragDropEvent()` listener receives file paths directly as strings.

- [ ] **Step 1: Create the component**

Create `src/components/onboarding/OnboardingScreen.tsx`:

```typescript
import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { FolderOpen, Plus } from "lucide-react";
import { Button } from "../ui/Button";
import logoSvg from "../../assets/logo-cat.svg";

interface OnboardingScreenProps {
  repoPath: string | null;
  error: string | null;
  onRepoSelected: (path: string) => void;
  onClearError: () => void;
  onCreateWorktree: () => void;
}

const transition = { duration: 0.2, ease: "easeInOut" };

function OnboardingScreen({
  repoPath,
  error,
  onRepoSelected,
  onClearError,
  onCreateWorktree,
}: OnboardingScreenProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  // Tauri v2 drag-and-drop via webview events
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    getCurrentWebviewWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over") {
          setIsDragOver(true);
          onClearError();
        } else if (event.payload.type === "drop") {
          setIsDragOver(false);
          const paths = event.payload.paths;
          if (paths.length > 0) {
            onRepoSelected(paths[0]);
          }
        } else if (event.payload.type === "leave") {
          setIsDragOver(false);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, [onRepoSelected, onClearError]);

  const handleOpenPicker = useCallback(async () => {
    onClearError();
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected) {
        onRepoSelected(selected as string);
      }
    } catch {
      // User cancelled or error — no-op
    }
  }, [onRepoSelected, onClearError]);

  const repoName = repoPath?.split("/").filter(Boolean).pop() ?? "";

  return (
    <div className="flex-1 flex items-center justify-center h-screen relative">
      {/* Drag-over indicator */}
      {isDragOver && (
        <div className="absolute inset-4 border-2 border-dashed border-border-hover rounded-[var(--radius-lg)] pointer-events-none z-10" />
      )}

      <div className="flex flex-col items-center text-center max-w-[420px] px-6">
        {/* Cat logo — stable anchor across both states */}
        <img
          src={logoSvg}
          alt="Alfredo"
          width={72}
          height={72}
          className="mb-8 opacity-70"
        />

        <AnimatePresence mode="wait">
          {!repoPath ? (
            <motion.div
              key="welcome"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={transition}
              className="flex flex-col items-center"
            >
              <h1 className="text-[26px] font-semibold text-text-primary mb-3 tracking-[-0.3px]">
                Welcome to Alfredo
              </h1>
              <p className="text-[15px] text-text-secondary leading-relaxed mb-9">
                Manage your AI coding agents across git worktrees.
              </p>
              <Button size="lg" onClick={handleOpenPicker}>
                <FolderOpen className="h-[18px] w-[18px]" />
                Open a repository
              </Button>
              {error && (
                <p className="text-sm text-status-error mt-4">{error}</p>
              )}
              <p className="text-[13px] text-text-tertiary mt-5">
                or drag a folder here
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="create-worktree"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={transition}
              className="flex flex-col items-center w-full"
            >
              {/* Repo confirmation card */}
              <div className="flex items-center gap-3 w-full px-4 py-3 bg-bg-secondary border border-border-default rounded-[10px] mb-8 text-left">
                <div className="h-7 w-7 rounded-full bg-[rgba(74,222,128,0.12)] flex items-center justify-center flex-shrink-0">
                  <span className="text-status-idle text-sm">✓</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-text-primary">
                    {repoName}
                  </div>
                  <div className="text-[11px] text-text-tertiary font-mono truncate">
                    {repoPath}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-xs text-accent-primary hover:underline flex-shrink-0 cursor-pointer"
                  onClick={handleOpenPicker}
                >
                  Change
                </button>
              </div>

              <h2 className="text-xl font-semibold text-text-primary mb-2.5 tracking-[-0.2px]">
                Create your first worktree
              </h2>
              <p className="text-sm text-text-secondary leading-relaxed mb-8">
                Each worktree gets its own branch, terminal, and agent.
              </p>
              <Button size="lg" onClick={onCreateWorktree}>
                <Plus className="h-[18px] w-[18px]" />
                Create a worktree
              </Button>
              {error && (
                <p className="text-sm text-status-error mt-4">{error}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export { OnboardingScreen };
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | head -20`
Expected: no TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add src/components/onboarding/OnboardingScreen.tsx
git commit -m "feat: add OnboardingScreen with welcome and create-worktree states"
```

---

## Task 5: Thread repoPath into CreateWorktreeDialog

**Files:**
- Modify: `src/components/kanban/CreateWorktreeDialog.tsx`

The dialog currently hardcodes `"."` as the repo path in `createWorktreeFrom(".", ...)` calls (lines 101 and 107). It needs to accept a `repoPath` prop.

- [ ] **Step 1: Add repoPath prop to the interface**

In `src/components/kanban/CreateWorktreeDialog.tsx`, update the interface (line 19-22):

```typescript
interface CreateWorktreeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoPath?: string;
}
```

- [ ] **Step 2: Use the prop in the component**

Update the function signature (line 31) to destructure `repoPath`:

```typescript
function CreateWorktreeDialog({ open, onOpenChange, repoPath = "." }: CreateWorktreeDialogProps) {
```

- [ ] **Step 3: Replace hardcoded "." with the prop**

Replace the two `createWorktreeFrom(".", ...)` calls (lines 101 and 107) with `createWorktreeFrom(repoPath, ...)`:

Line 101: `worktree = await createWorktreeFrom(repoPath, {`
Line 107: `worktree = await createWorktreeFrom(repoPath, {`

- [ ] **Step 4: Verify it compiles**

Run: `npm run build 2>&1 | head -20`
Expected: no TypeScript errors (the prop is optional with a default)

- [ ] **Step 5: Commit**

```bash
git add src/components/kanban/CreateWorktreeDialog.tsx
git commit -m "feat: accept repoPath prop in CreateWorktreeDialog instead of hardcoding '.'"
```

---

## Task 6: Update AppShell to use OnboardingScreen and hide sidebar

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Delete: `src/components/empty/WelcomeScreen.tsx`
- Delete: `src/components/empty/EmptyWorkspace.tsx`

Key changes:
- Import `OnboardingScreen` and `useRepoPath` instead of `WelcomeScreen`/`EmptyWorkspace`
- Remove the `getConfig(".")` useEffect for repo path loading (replaced by `useRepoPath` hook)
- When `worktrees.length === 0`: render `OnboardingScreen` with **no sidebar**
- Pass `repoPath` to `CreateWorktreeDialog`
- When worktrees exist: render normal layout with sidebar
- Use a `useRef` flag to only animate the sidebar slide-in on the first transition from onboarding
- Show cat logo during loading instead of blank screen

- [ ] **Step 1: Rewrite AppShell**

Replace the contents of `src/components/layout/AppShell.tsx`:

```typescript
import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Sidebar } from "../sidebar/Sidebar";
import { StatusBar } from "./StatusBar";
import { TerminalView } from "../terminal";
import { ChangesView } from "../changes/ChangesView";
import { OnboardingScreen } from "../onboarding/OnboardingScreen";
import { CreateWorktreeDialog } from "../kanban/CreateWorktreeDialog";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useRepoPath } from "../../hooks/useRepoPath";
import logoSvg from "../../assets/logo-cat.svg";

function TabBar() {
  const activeWorktreeId = useWorkspaceStore((s) => s.activeWorktreeId);
  const activeTab = useWorkspaceStore((s) => s.activeTab);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);

  const currentTab = activeWorktreeId
    ? (activeTab[activeWorktreeId] ?? "terminal")
    : "terminal";

  function handleTabClick(tab: "terminal" | "changes") {
    if (activeWorktreeId) {
      setActiveTab(activeWorktreeId, tab);
    }
  }

  return (
    <div className="flex items-center h-9 bg-bg-secondary border-b border-border-default flex-shrink-0">
      <button
        type="button"
        onClick={() => handleTabClick("terminal")}
        className={[
          "h-full px-4 text-sm font-medium transition-colors cursor-pointer",
          currentTab === "terminal"
            ? "text-text-primary border-b-2 border-b-accent-primary"
            : "text-text-tertiary hover:text-text-secondary border-b-2 border-b-transparent",
        ].join(" ")}
      >
        Terminal
      </button>
      <button
        type="button"
        onClick={() => handleTabClick("changes")}
        className={[
          "h-full px-4 text-sm font-medium transition-colors cursor-pointer flex items-center gap-1.5",
          currentTab === "changes"
            ? "text-text-primary border-b-2 border-b-accent-primary"
            : "text-text-tertiary hover:text-text-secondary border-b-2 border-b-transparent",
        ].join(" ")}
      >
        Changes
      </button>
    </div>
  );
}

function AppShell() {
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const activeWorktreeId = useWorkspaceStore((s) => s.activeWorktreeId);
  const worktree = useWorkspaceStore((s) =>
    s.worktrees.find((wt) => wt.id === activeWorktreeId),
  );
  const activeTab = useWorkspaceStore((s) => s.activeTab);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const annotations = useWorkspaceStore((s) => s.annotations);

  const { repoPath, setRepoPath, error, clearError, loading } = useRepoPath();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Track whether we just transitioned from onboarding to animate sidebar
  const wasOnboarding = useRef(true);
  const shouldAnimateSidebar = useRef(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (document.activeElement as HTMLElement)?.isContentEditable
      )
        return;

      if (event.metaKey && event.shiftKey) {
        if (event.key === "T") {
          event.preventDefault();
          if (activeWorktreeId) setActiveTab(activeWorktreeId, "terminal");
        } else if (event.key === "C") {
          event.preventDefault();
          if (activeWorktreeId) setActiveTab(activeWorktreeId, "changes");
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeWorktreeId, setActiveTab]);

  const currentTab = activeWorktreeId
    ? (activeTab[activeWorktreeId] ?? "terminal")
    : "terminal";

  const annotationCount = activeWorktreeId
    ? (annotations[activeWorktreeId]?.length ?? 0)
    : 0;

  // Show cat logo while loading persisted repo path
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <img src={logoSvg} alt="Alfredo" width={72} height={72} className="opacity-70" />
      </div>
    );
  }

  const isOnboarding = worktrees.length === 0;

  // Track onboarding → normal transition for sidebar animation
  if (isOnboarding) {
    wasOnboarding.current = true;
  } else if (wasOnboarding.current) {
    shouldAnimateSidebar.current = true;
    wasOnboarding.current = false;
  }

  // Onboarding — no sidebar
  if (isOnboarding) {
    return (
      <>
        <OnboardingScreen
          repoPath={repoPath}
          error={error}
          onRepoSelected={setRepoPath}
          onClearError={clearError}
          onCreateWorktree={() => setCreateDialogOpen(true)}
        />
        <CreateWorktreeDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          repoPath={repoPath ?? undefined}
        />
      </>
    );
  }

  // Normal state — worktrees exist, show sidebar
  const sidebarAnimation = shouldAnimateSidebar.current
    ? { initial: { x: -260, opacity: 0 }, animate: { x: 0, opacity: 1 }, transition: { duration: 0.2, ease: "easeOut" } }
    : {};

  // Clear the flag after first render with animation
  if (shouldAnimateSidebar.current) {
    shouldAnimateSidebar.current = false;
  }

  return (
    <div className="flex h-screen">
      <motion.div {...sidebarAnimation}>
        <Sidebar hasRepo={!!repoPath} />
      </motion.div>
      <div className="flex-1 flex flex-col min-w-0">
        <TabBar />
        <main className="flex-1 min-h-0">
          {currentTab === "terminal" ? (
            <TerminalView />
          ) : activeWorktreeId ? (
            <ChangesView
              worktreeId={activeWorktreeId}
              repoPath={worktree?.path ?? "."}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
              Select a worktree to view changes
            </div>
          )}
        </main>
        <StatusBar worktree={worktree} annotationCount={annotationCount} />
      </div>
    </div>
  );
}

export { AppShell };
```

- [ ] **Step 2: Delete old components**

```bash
rm src/components/empty/WelcomeScreen.tsx
rm src/components/empty/EmptyWorkspace.tsx
rmdir src/components/empty 2>/dev/null || true
```

- [ ] **Step 3: Check for stale imports**

Run: `grep -r "WelcomeScreen\|EmptyWorkspace" src/ --include="*.ts" --include="*.tsx" -l`
Expected: no results

- [ ] **Step 4: Verify it compiles**

Run: `npm run build 2>&1 | head -30`
Expected: no TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/AppShell.tsx src/components/onboarding/ src/hooks/useRepoPath.ts
git rm src/components/empty/WelcomeScreen.tsx src/components/empty/EmptyWorkspace.tsx
git commit -m "feat: replace two-screen onboarding with single OnboardingScreen

Hide sidebar during onboarding. Use useRepoPath hook for tauri-plugin-store
persistence. Wire up native directory picker via tauri-plugin-dialog.
Thread repoPath into CreateWorktreeDialog."
```

---

## Task 7: Visual verification and polish

**Files:**
- Possibly modify: `src/components/onboarding/OnboardingScreen.tsx` (spacing tweaks)

- [ ] **Step 1: Start the dev server and take screenshots**

Run: `npm run dev` (if not already running)

Open `http://localhost:1420` in agent-browser. Screenshot the welcome state (State 1).

- [ ] **Step 2: Verify State 1 layout**

Check:
- No sidebar visible
- Cat logo centered, ~72px, 70% opacity
- Title "Welcome to Alfredo" with generous spacing below
- Single-line description
- Purple "Open a repository" button with shadow
- "or drag a folder here" hint below with breathing room
- Nothing feels cramped

- [ ] **Step 3: Click "Open repository" and verify State 2**

Click the button. After selecting a repo, verify:
- Smooth crossfade transition (200ms)
- Repo confirmation card with green check, name, mono path, "Change" link
- "Create your first worktree" heading with good spacing
- "Create a worktree" button
- No sidebar still

- [ ] **Step 4: Click "Create a worktree" and verify sidebar appears**

After creating a worktree via the dialog, verify:
- Sidebar slides in from the left
- Normal app layout with TabBar + content area
- Smooth transition, no jank

- [ ] **Step 5: Fix any spacing or visual issues found**

Adjust Tailwind classes in `OnboardingScreen.tsx` as needed.

- [ ] **Step 6: Commit any fixes**

```bash
git add src/components/onboarding/OnboardingScreen.tsx
git commit -m "fix: polish onboarding screen spacing and transitions"
```

---

## Task 8: Test edge cases

- [ ] **Step 1: Verify returning user skips welcome**

1. Open the app → select a repo → close the app
2. Reopen the app
3. Should land directly on State 2 (create worktree) with the previously selected repo shown in the confirmation card

- [ ] **Step 2: Verify stale repo path is handled**

1. Open browser dev tools → Application → Storage → find `app-settings.json` store
2. Set the repo path to a non-existent directory
3. Reload the app
4. Should show State 1 (welcome) — stale path silently discarded

- [ ] **Step 3: Verify "Change" link works**

1. In State 2, click "Change"
2. Should open the native directory picker
3. After selecting a new repo, the confirmation card should update

- [ ] **Step 4: Verify non-git-repo directory shows error**

1. In State 1, click "Open a repository"
2. Select a directory that is NOT a git repo (e.g., `/tmp`)
3. Should show inline error: "This folder isn't a git repository."
4. Error should clear when clicking the button again

- [ ] **Step 5: Verify drag-and-drop**

1. Drag a git repo folder from Finder onto the welcome screen
2. Dashed border should appear on drag-over
3. On drop, should validate and transition to State 2

- [ ] **Step 6: Verify cancel behavior**

1. Click "Open a repository"
2. Cancel the native picker dialog
3. Should remain on current state with no change

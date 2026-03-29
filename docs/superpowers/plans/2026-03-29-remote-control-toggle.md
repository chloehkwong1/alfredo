# Remote Control Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-worktree toggle to enable Claude Code's built-in `/remote-control` from the Alfredo sidebar, with a contextual bottom bar showing QR code and session URL.

**Architecture:** Inline icon on each worktree sidebar row sends `/remote-control\n` to the active PTY session. A new `RemoteControlBar` component renders contextually above the existing `StatusBar` when the selected worktree has RC active. Remote-control state lives in a new lightweight Zustand store.

**Tech Stack:** React, Zustand, Lucide icons, `qrcode.react` for QR generation, existing `writePty` API.

---

### Task 1: Install `qrcode.react` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

```bash
cd /Users/chloe/dev/alfredo && npm install qrcode.react
```

- [ ] **Step 2: Verify installation**

```bash
cd /Users/chloe/dev/alfredo && node -e "require('qrcode.react')" && echo "OK"
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add qrcode.react for remote-control QR codes"
```

---

### Task 2: Create remote-control store

**Files:**
- Create: `src/stores/remoteControlStore.ts`

- [ ] **Step 1: Create the store**

```typescript
// src/stores/remoteControlStore.ts
import { create } from "zustand";

interface RemoteControlSession {
  sessionUrl: string;
  /** Whether a remote device is actively connected (future use). */
  connected: boolean;
}

interface RemoteControlState {
  /** Map of worktreeId → active remote-control session. */
  sessions: Record<string, RemoteControlSession>;
  /** Set a worktree as RC-active with the parsed session URL. */
  enable: (worktreeId: string, sessionUrl: string) => void;
  /** Remove RC state for a worktree. */
  disable: (worktreeId: string) => void;
  /** Check if a worktree has RC enabled. */
  isActive: (worktreeId: string) => boolean;
}

const useRemoteControlStore = create<RemoteControlState>((set, get) => ({
  sessions: {},
  enable: (worktreeId, sessionUrl) =>
    set((s) => ({
      sessions: { ...s.sessions, [worktreeId]: { sessionUrl, connected: false } },
    })),
  disable: (worktreeId) =>
    set((s) => {
      const { [worktreeId]: _, ...rest } = s.sessions;
      return { sessions: rest };
    }),
  isActive: (worktreeId) => worktreeId in get().sessions,
}));

export { useRemoteControlStore };
export type { RemoteControlSession, RemoteControlState };
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/chloe/dev/alfredo && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/stores/remoteControlStore.ts
git commit -m "feat: add remoteControlStore for per-worktree RC state"
```

---

### Task 3: Create `RemoteControlIcon` sidebar component

**Files:**
- Create: `src/components/sidebar/RemoteControlIcon.tsx`
- Modify: `src/components/sidebar/AgentItem.tsx`

- [ ] **Step 1: Create the icon component**

This is a small inline icon button for the worktree row. It sends `/remote-control\n` to the active PTY session on click (to enable), or disables with confirmation (when already active).

```typescript
// src/components/sidebar/RemoteControlIcon.tsx
import { Smartphone } from "lucide-react";
import { useRemoteControlStore } from "../../stores/remoteControlStore";

interface RemoteControlIconProps {
  worktreeId: string;
  /** Whether a Claude session is currently running in this worktree. */
  hasActiveSession: boolean;
  onToggle: (worktreeId: string) => void;
}

function RemoteControlIcon({ worktreeId, hasActiveSession, onToggle }: RemoteControlIconProps) {
  const isActive = useRemoteControlStore((s) => worktreeId in s.sessions);
  const disabled = !hasActiveSession && !isActive;

  return (
    <button
      type="button"
      title={
        disabled
          ? "No active session"
          : isActive
            ? "Remote Control: On"
            : "Remote Control: Off"
      }
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation(); // Don't select the worktree row
        onToggle(worktreeId);
      }}
      className={[
        "flex-shrink-0 p-0 bg-transparent border-none cursor-pointer transition-all duration-[var(--transition-fast)]",
        disabled ? "opacity-30 cursor-not-allowed" : "",
        isActive
          ? "text-accent-primary drop-shadow-[0_0_4px_var(--accent-primary)]"
          : "text-fg-tertiary hover:text-text-secondary",
      ].join(" ")}
    >
      <Smartphone size={14} />
    </button>
  );
}

export { RemoteControlIcon };
```

- [ ] **Step 2: Add the icon to `AgentItemContent` in `AgentItem.tsx`**

In `src/components/sidebar/AgentItem.tsx`, add the import at the top:

```typescript
import { RemoteControlIcon } from "./RemoteControlIcon";
```

Then in the `AgentItemContentProps` interface, add:

```typescript
  onToggleRemoteControl?: (worktreeId: string) => void;
```

In the `AgentItemContent` function signature, add the new prop:

```typescript
function AgentItemContent({
  worktree, effectiveStatus, shouldPulse, isServerRunning, prSummary,
  repoPath, repoColors, repoDisplayNames, repoIndex = 0, showRepoTag = false,
  onToggleRemoteControl,
}: AgentItemContentProps) {
```

In the Line 1 `<div>`, add the icon between `ServerIndicator` and `RelativeTime`:

```tsx
{isServerRunning && <ServerIndicator />}
{onToggleRemoteControl && (
  <RemoteControlIcon
    worktreeId={worktree.id}
    hasActiveSession={worktree.agentStatus !== "notRunning"}
    onToggle={onToggleRemoteControl}
  />
)}
<RelativeTime
```

- [ ] **Step 3: Pass the prop through `AgentItem`**

In the `AgentItemProps` interface, add:

```typescript
  onToggleRemoteControl?: (worktreeId: string) => void;
```

In the `AgentItem` function destructuring, add the new prop, and pass it to `AgentItemContent`:

```tsx
<AgentItemContent
  worktree={worktree}
  effectiveStatus={effectiveStatus}
  shouldPulse={shouldPulse}
  isServerRunning={isServerRunning}
  prSummary={prSummary}
  repoPath={repoPath}
  repoColors={repoColors}
  repoDisplayNames={repoDisplayNames}
  repoIndex={repoIndex}
  showRepoTag={showRepoTag}
  onToggleRemoteControl={onToggleRemoteControl}
/>
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/chloe/dev/alfredo && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/RemoteControlIcon.tsx src/components/sidebar/AgentItem.tsx
git commit -m "feat: add RemoteControlIcon to worktree sidebar rows"
```

---

### Task 4: Wire up the toggle handler (PTY write + output parsing)

**Files:**
- Create: `src/services/remoteControl.ts`
- Modify: `src/components/sidebar/Sidebar.tsx` (pass handler down)

- [ ] **Step 1: Create the remote-control service**

This service sends `/remote-control\n` to the PTY and parses the session URL from terminal output.

```typescript
// src/services/remoteControl.ts
import { writePty } from "../api";
import { useRemoteControlStore } from "../stores/remoteControlStore";
import { sessionManager } from "./sessionManager";

/** Regex to extract the session URL from Claude Code's remote-control output.
 *  Claude Code prints something like: "Remote control URL: https://claude.ai/code/session/..." */
const SESSION_URL_RE = /https:\/\/claude\.ai\/code\/[^\s\x1b]+/;

/**
 * Toggle remote-control for a worktree's active Claude session.
 * - If RC is off: sends `/remote-control` to the PTY, watches output for the URL.
 * - If RC is on: sends `/remote-control` again to toggle off, clears store state.
 */
async function toggleRemoteControl(
  worktreeId: string,
  sessionKey: string,
): Promise<void> {
  const store = useRemoteControlStore.getState();
  const session = sessionManager.getSession(sessionKey);
  if (!session || !session.sessionId) return;

  if (store.isActive(worktreeId)) {
    // Disable: clear state. The actual RC process will time out or can be
    // stopped by sending the command again if Claude Code supports toggle-off.
    store.disable(worktreeId);
    return;
  }

  // Send the slash command
  const bytes = Array.from(new TextEncoder().encode("/remote-control\n"));
  await writePty(session.sessionId, bytes);

  // Watch terminal output for the session URL.
  // We poll the output buffer for up to 10 seconds.
  const startTime = Date.now();
  const pollInterval = setInterval(() => {
    const current = sessionManager.getSession(sessionKey);
    if (!current) {
      clearInterval(pollInterval);
      return;
    }

    // Read recent output from the circular buffer
    const buf = current.outputBuffer;
    const total = current.outputBufferTotal;
    const pos = current.outputBufferPos;
    const capacity = buf.length;

    let recentBytes: Uint8Array;
    if (total <= capacity) {
      recentBytes = buf.slice(0, pos);
    } else {
      // Buffer has wrapped — concatenate tail + head
      recentBytes = new Uint8Array(capacity);
      recentBytes.set(buf.slice(pos), 0);
      recentBytes.set(buf.slice(0, pos), capacity - pos);
    }

    const recentText = new TextDecoder().decode(recentBytes);
    const match = recentText.match(SESSION_URL_RE);
    if (match) {
      store.enable(worktreeId, match[0]);
      clearInterval(pollInterval);
      return;
    }

    // Timeout after 10 seconds
    if (Date.now() - startTime > 10_000) {
      clearInterval(pollInterval);
      console.warn("[RemoteControl] Timed out waiting for session URL");
    }
  }, 500);
}

export { toggleRemoteControl };
```

- [ ] **Step 2: Wire the handler in `Sidebar.tsx`**

In `src/components/sidebar/Sidebar.tsx`, add the import:

```typescript
import { toggleRemoteControl } from "../../services/remoteControl";
```

Add a handler function inside the Sidebar component:

```typescript
const handleToggleRemoteControl = useCallback((worktreeId: string) => {
  // Find the claude tab's session key for this worktree
  const worktreeTabs = tabs[worktreeId] ?? [];
  const claudeTab = worktreeTabs.find((t) => t.type === "claude");
  if (!claudeTab) return;
  const sessionKey = `${worktreeId}:${claudeTab.id}`;
  toggleRemoteControl(worktreeId, sessionKey);
}, [tabs]);
```

Pass it to each `AgentItem`:

```tsx
<AgentItem
  ...existing props...
  onToggleRemoteControl={handleToggleRemoteControl}
/>
```

Note: Check how `tabs` is accessed in Sidebar — it may come from `useTabStore`. Import it if not already imported.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/chloe/dev/alfredo && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/services/remoteControl.ts src/components/sidebar/Sidebar.tsx
git commit -m "feat: wire remote-control toggle — sends /remote-control to PTY and parses URL"
```

---

### Task 5: Create `RemoteControlBar` bottom bar component

**Files:**
- Create: `src/components/layout/RemoteControlBar.tsx`
- Modify: `src/components/layout/AppShell.tsx`

- [ ] **Step 1: Create the bottom bar component**

```tsx
// src/components/layout/RemoteControlBar.tsx
import { Copy, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { useRemoteControlStore } from "../../stores/remoteControlStore";
import { Button } from "../ui";

interface RemoteControlBarProps {
  worktreeId: string;
}

function RemoteControlBar({ worktreeId }: RemoteControlBarProps) {
  const session = useRemoteControlStore((s) => s.sessions[worktreeId]);
  const disable = useRemoteControlStore((s) => s.disable);
  const [copied, setCopied] = useState(false);

  if (!session) return null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(session.sessionUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDisconnect = () => {
    disable(worktreeId);
  };

  return (
    <div className="h-14 flex items-center gap-4 px-4 bg-bg-secondary border-t border-border-subtle flex-shrink-0 animate-slide-up">
      {/* QR Code */}
      <div className="flex-shrink-0 rounded overflow-hidden bg-white p-1">
        <QRCodeSVG value={session.sessionUrl} size={40} />
      </div>

      {/* URL + copy */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-xs text-text-secondary truncate font-mono">
          {session.sessionUrl}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex-shrink-0 text-text-tertiary hover:text-text-secondary transition-colors"
          title="Copy URL"
        >
          <Copy size={14} />
        </button>
        {copied && (
          <span className="text-2xs text-accent-primary flex-shrink-0">Copied!</span>
        )}
      </div>

      {/* Status */}
      <span className="flex items-center gap-1.5 text-xs flex-shrink-0">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        <span className="text-text-tertiary">Waiting</span>
      </span>

      {/* Disconnect */}
      <Button
        variant="secondary"
        onClick={handleDisconnect}
        className="flex-shrink-0 h-7 px-2 text-xs gap-1"
      >
        <X size={12} />
        Disconnect
      </Button>
    </div>
  );
}

export { RemoteControlBar };
```

- [ ] **Step 2: Add the `animate-slide-up` animation**

Check if `animate-slide-up` already exists in `tailwind.config.ts`. If not, add it to the `extend.animation` and `extend.keyframes` sections:

```typescript
// In tailwind.config.ts extend.keyframes:
"slide-up": {
  "0%": { transform: "translateY(100%)", opacity: "0" },
  "100%": { transform: "translateY(0)", opacity: "1" },
},
// In extend.animation:
"slide-up": "slide-up 150ms ease-out",
```

- [ ] **Step 3: Add `RemoteControlBar` to `AppShell.tsx`**

In `src/components/layout/AppShell.tsx`, add the import:

```typescript
import { RemoteControlBar } from "./RemoteControlBar";
```

Render it directly above the `StatusBar`, inside the same flex column (around line 284):

```tsx
<RemoteControlBar worktreeId={activeWorktreeId} />
<StatusBar worktree={worktree} annotationCount={annotationCount} />
```

Note: `activeWorktreeId` should already be available in scope. If it might be null, guard with:

```tsx
{activeWorktreeId && <RemoteControlBar worktreeId={activeWorktreeId} />}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/chloe/dev/alfredo && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/RemoteControlBar.tsx src/components/layout/AppShell.tsx tailwind.config.ts
git commit -m "feat: add RemoteControlBar with QR code, URL, and disconnect button"
```

---

### Task 6: Clean up RC state on session exit

**Files:**
- Modify: `src/services/sessionManager.ts`

- [ ] **Step 1: Clean up RC state when a session ends**

In `src/services/sessionManager.ts`, add the import:

```typescript
import { useRemoteControlStore } from "../stores/remoteControlStore";
```

In the `stopSession` method (around line 404), after clearing the sessionId, clean up RC state. The `sessionKey` has the format `{worktreeId}:{tabId}`, so extract the worktreeId:

```typescript
async stopSession(sessionKey: string): Promise<void> {
  const session = this.sessions.get(sessionKey);
  if (!session) return;

  // Clean up remote-control state for this worktree
  const worktreeId = sessionKey.split(":")[0];
  useRemoteControlStore.getState().disable(worktreeId);

  try {
    await closePty(session.sessionId);
  } catch {
    // Session may already be dead on the Rust side — that's fine.
  }
  session.sessionId = "";
}
```

Do the same in `closeSession` (around line 417):

```typescript
async closeSession(sessionKey: string): Promise<void> {
  const session = this.sessions.get(sessionKey);
  if (!session) return;

  // Clean up remote-control state for this worktree
  const worktreeId = sessionKey.split(":")[0];
  useRemoteControlStore.getState().disable(worktreeId);

  this.sessions.delete(sessionKey);
  try {
    await closePty(session.sessionId);
  } catch {
    // Session may already be dead on the Rust side — that's fine.
  }
  session.terminal.dispose();
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/chloe/dev/alfredo && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/services/sessionManager.ts
git commit -m "fix: clean up remote-control state when session stops or closes"
```

---

### Task 7: Visual verify and polish

- [ ] **Step 1: Start the app and visually verify**

```bash
cd /Users/chloe/dev/alfredo && npm run tauri dev
```

Verify:
1. Each worktree row shows the phone icon in `text-fg-tertiary`
2. Icon is disabled (dimmed) when no Claude session is running
3. Clicking the icon on an active session sends `/remote-control` (check terminal output)
4. If URL is parsed, the bottom bar appears with QR code, URL, copy button
5. Switching to a different worktree hides the bar
6. Clicking Disconnect clears the bar and resets the icon
7. Icon glows blue (`text-accent-primary`) when RC is active

- [ ] **Step 2: Adjust the URL regex if needed**

The `SESSION_URL_RE` regex in `src/services/remoteControl.ts` may need adjustment based on the actual Claude Code output format. Run `/remote-control` manually in a terminal to see the exact output, and update the regex to match.

- [ ] **Step 3: Final commit if any polish changes**

```bash
git add -A
git commit -m "fix: remote-control toggle polish and regex adjustments"
```

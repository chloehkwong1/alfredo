# Worktree Run Scripts (Dev Server)

## Problem

When working across multiple worktrees, Chloe needs to run a dev server (`npm run dev`, etc.) from a specific worktree and easily see which worktree the server is running from. Today this is done manually in an external terminal with a kill-all-first script. Alfredo should manage this natively.

## Design Decisions

- **Single server per repo** — only one worktree can run the dev server at a time (they share the same port)
- **Auto-stop** — starting the server on worktree B automatically kills the one running on worktree A (no confirmation)
- **Server tab** — opens a new "Server" terminal tab (PTY session) on the owning worktree
- **Tab persists** — the Server tab stays open after the server stops so logs are scrollable
- **Equalizer bars indicator** — animated equalizer bars on the right side of the sidebar worktree row that owns the running server

## Configuration

Add a `runScript` field to `AppConfig` (`.alfredo.json`):

```json
{
  "runScript": {
    "name": "Dev Server",
    "command": "npm run dev"
  }
}
```

Single command per repo. No per-worktree overrides — every worktree shares the same project structure.

### Rust type

```rust
// types.rs
pub struct RunScript {
    pub name: String,
    pub command: String,
}
```

Add to `AppConfig`:
```rust
pub run_script: Option<RunScript>,
```

### TypeScript type

```typescript
// types.ts
export interface RunScript {
  name: string;
  command: string;
}
```

### Settings UI

Add a "Run Script" section to the settings dialog, below setup scripts. Simple name + command fields — similar to a single SetupScript entry but without `runOn`. Show it only when `runScript` is configured, or provide an "Add run script" button.

## Starting the Server

### Tab bar button

A play/stop button in the tab bar area of the active worktree. Visible only when a `runScript` is configured.

- **No server running anywhere** → play button (▶). Click starts the server on this worktree.
- **Server running on this worktree** → stop button (■). Click stops the server.
- **Server running on a different worktree** → play button (▶). Click auto-stops the other worktree's server and starts here.

### Execution flow

1. If a server is already running (any worktree), kill that PTY session
2. Spawn a new PTY session on the target worktree with the configured command
3. Auto-open a "Server" tab on the target worktree (tab type: `server`)
4. Set the active tab to the new Server tab
5. Track which worktree owns the running server in workspace store state

### Backend

No new Rust command needed. Reuse `spawn_pty` with:
- `command`: the shell (e.g., `/bin/zsh`)
- `args`: `["-c", runScript.command]`
- `agent_type`: `None` (no agent state tracking)

Kill via existing `close_pty` when auto-stopping.

## Server Tab

A new tab type `"server"` that behaves like a Shell tab (full PTY terminal with xterm.js) but:
- Has a distinct label: "Server" instead of "Shell"
- Has a play icon (▶) in green when running, grey when stopped
- Cannot be created manually from the "+" dropdown — only created by the play button
- Stays open after the server process exits (for log review)
- Closeable manually like any other tab

### Tab icon

Use a `Play` icon from lucide-react (or similar) instead of the `Terminal` icon used for Shell tabs.

### When the server stops

- The tab remains open
- The play icon in the tab changes from green to grey
- The terminal shows the process exit (natural PTY behavior)
- The equalizer bars in the sidebar disappear

## Sidebar Indicator

### Equalizer bars animation

When a worktree owns the running server, show animated equalizer bars on the right side of the worktree row in the sidebar (`AgentItem.tsx`).

- **4 thin bars** (2-3px wide each) with independent animation timing
- **Green color** (`#4ade80` / Tailwind `green-400`) matching the agent status palette
- **Smooth animation** — each bar oscillates height at a slightly different rate (1.0s–1.6s) for an organic feel
- **Bars disappear** when the server stops

Implementation: a small `ServerIndicator` component rendered conditionally in `AgentItem` when `worktreeId === runningServerWorktreeId`.

## State Management

### Workspace store additions

```typescript
// New state
runningServer: {
  worktreeId: string;
  sessionId: string;  // PTY session ID for killing
} | null;

// New actions
startServer(worktreeId: string): void;
stopServer(): void;
```

- `startServer`: kills existing server if any, spawns PTY, opens Server tab, sets `runningServer`
- `stopServer`: kills PTY session, clears `runningServer` (tab stays open)

### Persistence

`runningServer` is **not persisted** across app restarts. On restart, no server is running — the user clicks play to start fresh. The Server tab from the previous session can remain as a disconnected tab (existing behavior for PTY tabs on restart).

## Edge Cases

- **Worktree deleted while server is running on it**: stop the server first, then delete
- **Run script not configured**: play/stop button hidden, no equalizer bars ever shown
- **Server process crashes/exits on its own**: detect via PTY exit event, clear `runningServer` state, remove equalizer bars. Tab stays open with the error output.
- **Multiple Server tabs**: if you start → stop → start on the same worktree, reuse the existing Server tab (spawn a fresh PTY into it) rather than creating a second tab. If the Server tab was manually closed, create a new one.

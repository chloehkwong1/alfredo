# PTY Channel Resilience

## Problem

The terminal occasionally freezes mid-session: the child process (Claude Code) keeps running and hooks still update the sidebar state, but no new output reaches the xterm.js terminal. The user sees stale content with no indication anything is wrong, and the only recovery is closing and reopening the session.

**Root cause (known):** The state server registers hook channels by `worktree_id` only. Opening a second tab for the same worktree overwrites the first tab's hook channel. Additionally, `unregister_channel()` is never called, leaving stale entries.

**Root cause (unknown):** Why the PTY reader thread's `channel.send(Output)` fails or output stops arriving at the JS side. No logging exists in the reader thread, so we can't diagnose this yet.

## Design

Four changes, ordered by value:

### 1. Fix state server channel registration

**Problem:** `StateServerHandle.channels` is a `HashMap<String, Channel<PtyEvent>>` keyed by `worktree_id`. A second session for the same worktree overwrites the first. `unregister_channel()` exists but is never called.

**Fix:**
- Key the map by `session_id` instead of `worktree_id`. Each PTY session gets its own channel entry.
- Add a reverse lookup: `worktree_id → Vec<session_id>` so hook events can fan out to all sessions in a worktree.
- Call `unregister_channel(session_id)` in the `close_pty` command.
- When a hook fires for a worktree, send the event to all registered sessions for that worktree (not just one).

**Files:** `state_server.rs`, `commands/pty.rs`

### 2. Add reader thread logging

**Problem:** The reader thread at `pty_manager.rs:112-167` silently exits on channel errors. No log output exists to diagnose failures.

**Fix:** Add `eprintln!` logging for:
- Channel send failures (output and agent state) with the error details
- Reader loop exit reason (EOF, EIO, channel failure, other error)
- A startup log line so we know the reader is running

Use `eprintln!` with a `[pty-reader {session_id}]` prefix (matching the existing pattern on line 152).

**Files:** `pty_manager.rs`

### 3. Add heartbeat to the reader thread

**Problem:** No way to distinguish "channel is dead but process is alive" from "process is thinking quietly." The frontend can only guess.

**Fix:**
- Add `PtyEvent::Heartbeat` variant to the enum.
- Reader thread sends a heartbeat every ~2 seconds. Use a `last_heartbeat: Instant` tracker — after each read, if 2s have elapsed since the last heartbeat, send one.
- Heartbeat is sent even when there's no output (use `read` with a timeout or a parallel heartbeat via a timer). Since `portable_pty` read is blocking, the simplest approach: spawn a tiny sibling thread that sends heartbeats on a 2s interval using the same shared channel. This keeps the heartbeat independent of output flow.

**Implementation detail:** Before spawning the reader thread, clone the channel into an `Arc<Channel<PtyEvent>>`. Pass one `Arc` clone to the reader thread, one to the heartbeat thread. The heartbeat thread loops: sleep 2s → `channel.send(Heartbeat)`. If send fails, log and exit (the reader thread will also fail soon). Both threads check a shared `Arc<AtomicBool>` stop flag, set to `true` when the session is closed. The `close()` method sets the flag so both threads exit cleanly.

**Files:** `types.rs` (PtyEvent enum), `pty_manager.rs` (heartbeat thread)

### 4. Frontend disconnected indicator

**Problem:** When output stops flowing, the terminal looks frozen with no user affordance.

**Fix:**

**sessionManager.ts:**
- Add `lastHeartbeat: number` to `ManagedSession`, initialized to `Date.now()`.
- Handle `heartbeat` event in the channel callback: update `lastHeartbeat`.

**usePty.ts:**
- Expose a new `channelAlive: boolean` state.
- In the existing 500ms poll interval, check `Date.now() - session.lastHeartbeat < 6000` (3 missed heartbeats = dead).
- Return `channelAlive` from the hook.

**TerminalView.tsx:**
- When `channelAlive` is `false`, render a small overlay banner at the top of the terminal:
  - Text: "Terminal disconnected"
  - Button: "Restart session" (wired to existing `handleRestartSession`)
- Style: semi-transparent background so terminal content is still visible underneath. Use Nightingale components for the button.

**workspaceStore / AgentItem.tsx:**
- Add `channelAlive: boolean` to the worktree store entry, default `true`.
- Update it from the same 500ms poll in `usePty`.
- In `AgentItem`, when `channelAlive` is `false`, override the status dot to amber/yellow with "Disconnected" text regardless of `agentStatus`.

**Files:** `sessionManager.ts`, `usePty.ts`, `TerminalView.tsx`, `AgentItem.tsx`, `workspaceStore.ts`

## Out of Scope

- **Replaceable channel / auto-reconnect:** Deferred until we understand the root cause via logging. May not be needed if the underlying bug is fixable.
- **Rust-side output ring buffer:** The existing 50KB buffer in `ManagedSession` (TS-side) is sufficient for scrollback replay on session restart.
- **Process health monitoring:** Detecting zombie/exited processes is a separate concern. The heartbeat only tracks channel liveness.

## Testing

- Unit test the state server fan-out: register two channels for the same worktree, fire a hook, verify both receive the event.
- Unit test channel cleanup: close a session, verify its channel is removed from the registry.
- Manual test: open two tabs for the same worktree (Claude + Shell), verify both receive hook state updates independently.
- Manual test: verify the disconnected banner appears when the reader thread is killed (e.g. via `kill` on the heartbeat thread's process).

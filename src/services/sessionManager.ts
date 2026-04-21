import { FitAddon } from "@xterm/addon-fit";
import type { AgentType, SessionType } from "../types";
import { spawnPty, closePty, resizePty, reattachPty, getConfig } from "../api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSessionStatusStore } from "../stores/sessionStatusStore";
import { useRemoteControlStore } from "../stores/remoteControlStore";
import type { TerminalPreferences } from "./terminalPreferences";
import { computeStaleBusy } from "../hooks/usePty";

import type { ManagedSession } from "./sessionTypes";
import { OUTPUT_BUFFER_CAPACITY } from "./sessionTypes";
import { createTerminal, registerKittyProtocol } from "./terminalFactory";
import {
  AGENT_TYPE_MAP,
  RECONCILE_INTERVAL_MS,
  STALE_HOOK_MS,
  STALE_OUTPUT_IDLE_MS,
  STALE_HOOK_FORCE_MS,
  createSessionChannel,
  fireDebugNotification,
  type SessionWriter,
} from "./sessionChannel";

// Re-export for external consumers
export type { ManagedSession } from "./sessionTypes";
export { shouldAcceptDetectorState, stateSourceMap } from "./sessionChannel";

// ── SessionManager ─────────────────────────────────────────────

export class SessionManager implements SessionWriter {
  private sessions = new Map<string, ManagedSession>();

  private reconcileTimer: ReturnType<typeof setInterval> | null = null;

  /** Start the global reconciler if not already running. Idempotent. */
  private startReconciler(): void {
    if (this.reconcileTimer !== null) return;
    this.reconcileTimer = setInterval(() => this.reconcileAll(), RECONCILE_INTERVAL_MS);
  }

  /** Stop the global reconciler. Called from closeAll and from closeSession when the session map empties. */
  private stopReconciler(): void {
    if (this.reconcileTimer === null) return;
    clearInterval(this.reconcileTimer);
    this.reconcileTimer = null;
  }

  private reconcileAll(): void {
    const now = Date.now();
    const store = useWorkspaceStore.getState();

    for (const [sessionKey, session] of this.sessions.entries()) {
      if (!session.hooksActive) continue;
      if (session.ptyExited) continue;
      const worktreeId = sessionKey.split(":")[0];

      // ── busy → idle reconciliation ──────────────────────────
      // ORDERING INVARIANT: the soft check (hook silence + output silence)
      // MUST come before the force check (hook silence only). The soft
      // check's `continue` skips the force path, allowing long-running
      // tools that stream output to stay busy even when hooks are silent.
      // Reordering these blocks breaks that guard — see e03b8c5.
      //
      // Both paths are additionally gated on workDepth === 0: a tool in
      // flight (workDepth > 0) means we have structural proof work is
      // happening — no time-based rescue should fire until toolEnd
      // decrements the counter or turnEnd resets it.
      if (
        session.agentState === "busy"
        && session.workDepth === 0
        && session.lastHookAt > 0
        && now - session.lastHookAt > STALE_HOOK_MS
        && session.lastOutputAt > 0
        && now - session.lastOutputAt > STALE_OUTPUT_IDLE_MS
      ) {
        const silentSec = Math.round((now - session.lastHookAt) / 1000);
        const wt = store.worktrees.find((w) => w.id === worktreeId);
        const branch = wt?.branch ?? worktreeId;
        console.warn(`[reconcile:${worktreeId}] busy → idle (hooks silent ${now - session.lastHookAt}ms, no output ${now - session.lastOutputAt}ms, last hook: ${session.lastHookDesc || "?"}, sessionKey=${sessionKey}, sessionId=${session.sessionId})`);
        fireDebugNotification(`${branch}: stuck busy rescued (last hook: ${session.lastHookDesc || "?"}, ${silentSec}s ago, output stopped)`);
        session.agentState = "idle";
        useSessionStatusStore.getState().setSessionStatus(sessionKey, "idle");
        continue;
      }

      // Force idle when hooks have been silent long enough, even if output
      // is still flowing. Claude Code's TUI produces output bytes while idle
      // (status bar redraws, cursor repositioning), which keeps lastOutputAt
      // fresh and prevents the check above from ever triggering.
      if (
        session.agentState === "busy"
        && session.workDepth === 0
        && session.lastHookAt > 0
        && now - session.lastHookAt > STALE_HOOK_FORCE_MS
      ) {
        const silentSec = Math.round((now - session.lastHookAt) / 1000);
        const wt = store.worktrees.find((w) => w.id === worktreeId);
        const branch = wt?.branch ?? worktreeId;
        console.warn(`[reconcile:${worktreeId}] busy → idle (force: hooks silent ${now - session.lastHookAt}ms, output still flowing, last hook: ${session.lastHookDesc || "?"}, sessionKey=${sessionKey}, sessionId=${session.sessionId})`);
        fireDebugNotification(`${branch}: stuck busy rescued (last hook: ${session.lastHookDesc || "?"}, ${silentSec}s ago)`);
        session.agentState = "idle";
        useSessionStatusStore.getState().setSessionStatus(sessionKey, "idle");
        continue;
      }

      // ── staleBusy display flag ──────────────────────────────
      const alive = !session.sessionId || now - session.lastHeartbeat < 6000;
      const staleBusy = computeStaleBusy(session.agentState, alive, session.lastOutputAt, now);
      const current = useWorkspaceStore.getState().worktrees.find((w) => w.id === worktreeId);
      if (current && current.staleBusy !== staleBusy) {
        useWorkspaceStore.getState().updateWorktree(worktreeId, { staleBusy });
      }
    }
  }

  /**
   * Return an existing session for the given key, or spawn a new one.
   * The channel callback is wired up immediately so agent-state events
   * flow to the workspace store even when no terminal UI is mounted.
   *
   * @param sessionKey  Unique key for this session (typically a tab ID).
   * @param worktreeId  The worktree this session belongs to (for store updates).
   * @param worktreePath  Filesystem path of the worktree.
   * @param mode  "claude" spawns Claude Code; "shell" spawns the user's default shell.
   */
  async getOrSpawn(
    sessionKey: string,
    worktreeId: string,
    worktreePath: string,
    mode: "claude" | "codex" | "gemini" | "shell" = "claude",
    initialScrollback?: string,
    args?: string[],
    sessionType?: SessionType,
  ): Promise<ManagedSession> {
    const prefix = sessionKey.split(":", 1)[0];
    if (prefix && prefix !== worktreeId) {
      console.warn(
        `[sessionManager] getOrSpawn prefix mismatch: sessionKey=${sessionKey} worktreeId=${worktreeId} worktreePath=${worktreePath} mode=${mode} sessionType=${sessionType}`,
      );
    }
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      // Scrollback-only session (no PTY yet) — spawn a PTY for it
      if (!existing.sessionId && existing.lastHeartbeat === 0) {
        return this.spawnForExisting(sessionKey, worktreeId, worktreePath, mode, args, sessionType);
      }
      // Zombie detection: session exists but PTY never spawned or died
      const isZombie = !existing.sessionId && existing.lastHeartbeat > 0 &&
        Date.now() - existing.lastHeartbeat > 10_000;
      if (!isZombie) return existing;
      // Clean up the zombie so we can spawn fresh. Clearing the session
      // status triggers the status mirror to project "notRunning" to the
      // worktree, so the new session's notRunning → idle doesn't fire
      // a false notification.
      useSessionStatusStore.getState().clearSessionStatus(sessionKey);
      existing.terminal.dispose();
      this.sessions.delete(sessionKey);
    }

    // Create xterm instance (headless — not attached to DOM yet)
    const { terminal, searchAddon } = createTerminal();
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // Replay saved scrollback BEFORE spawning the PTY
    if (initialScrollback) {
      try {
        const bytes = Uint8Array.from(atob(initialScrollback), (c) => c.charCodeAt(0));
        terminal.write(bytes);
      } catch {
        // Invalid base64 — skip replay
      }
    }

    const session: ManagedSession = {
      sessionId: "", // filled after spawn
      terminal,
      fitAddon,
      searchAddon,
      webglLoaded: false,
      agentState: mode === "shell" ? "notRunning" : "busy",
      hooksActive: false,
      outputBuffer: new Uint8Array(OUTPUT_BUFFER_CAPACITY),
      outputBufferPos: 0,
      outputBufferTotal: 0,
      lastHeartbeat: Date.now(),
      ptyExited: false,
      lastOutputAt: Date.now(),
      pendingOutput: [],
      writeScheduled: false,
      restoredFromScrollback: false,
      startupCommandSent: false,
      allowNextClearScrollback: false,
      lastHookAt: 0,
      lastHookDesc: "",
      hookDerivedState: null,
      pendingIdleTimer: null,
      turnEndAt: 0,
      workDepth: 0,
    };

    // Wire up the Tauri channel — this keeps pumping events regardless of UI.
    const channel = createSessionChannel(this, session, worktreeId, sessionKey);

    const agentType = AGENT_TYPE_MAP[mode] as AgentType | undefined;

    this.sessions.set(sessionKey, session);

    const worktree = useWorkspaceStore.getState().worktrees.find((w) => w.id === worktreeId);
    const assignedPort = worktree?.assignedPort ?? undefined;
    let portEnvVar: string | undefined;
    if (assignedPort && worktree?.repoPath) {
      portEnvVar = (await getConfig(worktree.repoPath)).portEnvVar ?? undefined;
    }

    let sessionId: string;
    try {
      sessionId = await spawnPty(
        worktreeId,
        worktreePath,
        mode,
        args ?? [],
        channel,
        agentType,
        sessionType,
        assignedPort,
        portEnvVar,
      );
    } catch (err) {
      // Spawn failed — remove session from map to prevent zombie
      session.terminal.dispose();
      this.sessions.delete(sessionKey);
      throw err;
    }
    session.sessionId = sessionId;
    console.debug(`[sessionManager] spawned sessionKey=${sessionKey} worktreeId=${worktreeId} sessionId=${sessionId} mode=${mode}`);
    registerKittyProtocol(terminal, sessionId);

    // Push initial state. The "busy" status (projected by the mirror)
    // clears seenWorktrees, so re-mark as seen to prevent the upcoming
    // busy→idle transition from firing a false "finished" notification —
    // this is a boot, not task completion.
    useSessionStatusStore.getState().setSessionStatus(sessionKey, session.agentState);
    if (mode === "claude") {
      useWorkspaceStore.getState().markWorktreeSeen(worktreeId);
    }

    this.startReconciler();
    return session;
  }

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

    const { terminal, searchAddon } = createTerminal();
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    let restoredBuffer = new Uint8Array(OUTPUT_BUFFER_CAPACITY);
    let restoredPos = 0;
    let restoredTotal = 0;

    if (initialScrollback) {
      try {
        const bytes = Uint8Array.from(atob(initialScrollback), (c) => c.charCodeAt(0));
        terminal.write(bytes);

        // Populate the output buffer so auto-save can re-persist scrollback
        // even before a PTY is spawned for this session.
        const cap = restoredBuffer.length;
        if (bytes.length <= cap) {
          restoredBuffer.set(bytes);
          restoredPos = bytes.length;
        } else {
          // Scrollback exceeds buffer capacity — keep the tail
          restoredBuffer.set(bytes.subarray(bytes.length - cap));
          restoredPos = 0;
        }
        restoredTotal = bytes.length;
      } catch {
        // Invalid base64 — skip replay
      }
    }

    const session: ManagedSession = {
      sessionId: "", // No PTY — filled when user chooses to spawn
      terminal,
      fitAddon,
      searchAddon,
      webglLoaded: false,
      agentState: "notRunning",
      hooksActive: false,
      outputBuffer: restoredBuffer,
      outputBufferPos: restoredPos,
      outputBufferTotal: restoredTotal,
      lastHeartbeat: 0,
      ptyExited: false,
      lastOutputAt: 0,
      pendingOutput: [],
      writeScheduled: false,
      restoredFromScrollback: true,
      startupCommandSent: false,
      allowNextClearScrollback: false,
      lastHookAt: 0,
      lastHookDesc: "",
      hookDerivedState: null,
      pendingIdleTimer: null,
      turnEndAt: 0,
      workDepth: 0,
    };

    this.sessions.set(sessionKey, session);
    useSessionStatusStore.getState().setSessionStatus(sessionKey, "notRunning");
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
    mode: "claude" | "codex" | "gemini" | "shell" = "claude",
    args?: string[],
    sessionType?: SessionType,
  ): Promise<ManagedSession> {
    const session = this.sessions.get(sessionKey);
    if (!session) throw new Error(`No session found for key: ${sessionKey}`);
    if (session.sessionId) return session; // Already spawned

    // Clear stale scrollback before spawning a fresh PTY so old session
    // content doesn't persist above the new prompt.
    session.terminal.clear();

    const channel = createSessionChannel(this, session, worktreeId, sessionKey);

    const agentType = AGENT_TYPE_MAP[mode] as AgentType | undefined;
    const wt = useWorkspaceStore.getState().worktrees.find((w) => w.id === worktreeId);
    const assignedPort = wt?.assignedPort ?? undefined;
    let portEnvVar: string | undefined;
    if (assignedPort && wt?.repoPath) {
      portEnvVar = (await getConfig(wt.repoPath)).portEnvVar ?? undefined;
    }

    let sessionId: string;
    try {
      sessionId = await spawnPty(
        worktreeId,
        worktreePath,
        mode,
        args ?? [],
        channel,
        agentType,
        sessionType,
        assignedPort,
        portEnvVar,
      );
    } catch (e) {
      // Spawn failed — remove session so it doesn't get stuck as scrollback-only
      session.terminal.dispose();
      this.sessions.delete(sessionKey);
      useSessionStatusStore.getState().clearSessionStatus(sessionKey);
      throw e;
    }
    session.sessionId = sessionId;
    session.ptyExited = false;
    session.agentState = mode === "shell" ? "notRunning" : "busy";
    session.workDepth = 0;
    session.lastHeartbeat = Date.now();
    // Reset lastOutputAt so callers (e.g. auto-resume) can detect when the
    // PTY actually produces output, rather than seeing the stale value from
    // the scrollback-only phase.
    session.lastOutputAt = 0;
    registerKittyProtocol(session.terminal, sessionId);

    // Resize PTY immediately to match the terminal's current dimensions.
    // The PTY starts at 80×24 but the terminal was already fitted to the
    // container during the disconnected/scrollback phase.
    const { rows, cols } = session.terminal;
    if (rows > 0 && cols > 0) {
      resizePty(sessionId, rows, cols).catch(e => console.warn(`[sessionManager] Failed to resize PTY for ${sessionId}:`, e));
    }

    // Push initial state and re-mark as seen (same rationale as getOrSpawn).
    useSessionStatusStore.getState().setSessionStatus(sessionKey, session.agentState);
    if (mode === "claude") {
      useWorkspaceStore.getState().markWorktreeSeen(worktreeId);
    }

    this.startReconciler();
    return session;
  }

  /**
   * Reattach to a PTY session that survived a frontend reload.
   * Creates a new ManagedSession with a fresh Channel wired to the existing
   * Rust-side PTY process.
   */
  async reattachToSession(
    sessionKey: string,
    sessionId: string,
    worktreeId: string,
  ): Promise<ManagedSession> {
    // Don't double-reattach
    const existing = this.sessions.get(sessionKey);
    if (existing && existing.sessionId === sessionId) return existing;

    const { terminal, searchAddon } = createTerminal();
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // Write a banner so the user knows why the terminal is empty
    terminal.write("\r\n\x1b[2m[reattached to running server — waiting for output...]\x1b[0m\r\n");

    const session: ManagedSession = {
      sessionId,
      terminal,
      fitAddon,
      searchAddon,
      webglLoaded: false,
      agentState: "busy",
      hooksActive: false,
      outputBuffer: new Uint8Array(OUTPUT_BUFFER_CAPACITY),
      outputBufferPos: 0,
      outputBufferTotal: 0,
      lastHeartbeat: Date.now(),
      ptyExited: false,
      lastOutputAt: 0,
      pendingOutput: [],
      writeScheduled: false,
      restoredFromScrollback: false,
      startupCommandSent: true,
      allowNextClearScrollback: false,
      lastHookAt: 0,
      lastHookDesc: "",
      hookDerivedState: null,
      pendingIdleTimer: null,
      turnEndAt: 0,
      workDepth: 0,
    };

    const channel = createSessionChannel(this, session, worktreeId, sessionKey);

    console.debug(`[sessionManager] reattaching sessionKey=${sessionKey} sessionId=${sessionId} worktreeId=${worktreeId}`);
    const returnedWorktreeId = await reattachPty(sessionId, channel);
    console.debug(`[sessionManager] reattached sessionKey=${sessionKey} sessionId=${sessionId} returnedWorktreeId=${returnedWorktreeId}`);
    if (returnedWorktreeId !== worktreeId) {
      console.warn(
        `[sessionManager] reattach worktree mismatch: expected ${worktreeId}, got ${returnedWorktreeId}`,
      );
    }

    this.sessions.set(sessionKey, session);
    useSessionStatusStore.getState().setSessionStatus(sessionKey, session.agentState);
    this.startReconciler();
    return session;
  }

  /** Retrieve a managed session without spawning. Returns `null` if none exists. */
  getSession(sessionKey: string): ManagedSession | null {
    return this.sessions.get(sessionKey) ?? null;
  }

  /** Kill the PTY process but keep the session and terminal alive so logs
   *  remain visible. Clears sessionId so usePty won't wire up input/resize. */
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
    session.ptyExited = false;
    if (session.pendingIdleTimer !== null) {
      clearTimeout(session.pendingIdleTimer);
      session.pendingIdleTimer = null;
    }

    // Reset session state so a subsequent spawnForExisting starts clean.
    // Without this, stale hooksActive=true would permanently reject detector events.
    session.hooksActive = false;
    session.agentState = "notRunning";
    session.workDepth = 0;
    session.hookDerivedState = null;

    // Intentionally kept as "notRunning" (not cleared): the session still exists,
    // just without a PTY, so the tab dot should stay visible. The status mirror
    // projects this onto the worktree's agentStatus.
    useSessionStatusStore.getState().setSessionStatus(sessionKey, "notRunning");
  }

  /** Close a single PTY session and dispose its terminal. */
  async closeSession(sessionKey: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) return;

    if (session.pendingIdleTimer !== null) {
      clearTimeout(session.pendingIdleTimer);
      session.pendingIdleTimer = null;
    }

    // Clean up remote-control state for this worktree
    const worktreeId = sessionKey.split(":")[0];
    useRemoteControlStore.getState().disable(worktreeId);

    // Clearing the session status causes the status mirror to project
    // "notRunning" onto the worktree, so the subsequent session spawn's
    // notRunning → idle transition doesn't trigger a false "finished"
    // notification.
    useSessionStatusStore.getState().clearSessionStatus(sessionKey);

    this.sessions.delete(sessionKey);
    if (this.sessions.size === 0) this.stopReconciler();
    try {
      await closePty(session.sessionId);
    } catch {
      // Session may already be dead on the Rust side — that's fine.
    }
    session.terminal.dispose();
  }

  /** Close every managed session. Intended for app shutdown / cleanup. */
  async closeAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    await Promise.allSettled(ids.map((id) => this.closeSession(id)));
    this.stopReconciler();
  }

  // ── Internal helpers ───────────────────────────────────────────

  /**
   * Batch terminal writes via requestAnimationFrame so the browser's event
   * loop can process click/input events between frames. Without this, rapid
   * PTY output (hundreds of IPC events/sec) can starve the main thread.
   */
  /** @internal Exposed for createSessionChannel — not part of the public API. */
  scheduleWrite(session: ManagedSession, bytes: Uint8Array): void {
    session.pendingOutput.push(bytes);
    if (session.writeScheduled) return;
    session.writeScheduled = true;
    requestAnimationFrame(() => {
      const chunks = session.pendingOutput;
      session.pendingOutput = [];
      session.writeScheduled = false;
      if (chunks.length === 1) {
        session.terminal.write(chunks[0]);
      } else if (chunks.length > 1) {
        const total = chunks.reduce((sum, c) => sum + c.length, 0);
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        session.terminal.write(merged);
      }
    });
  }

  /** @internal Exposed for createSessionChannel — not part of the public API. */
  appendToBuffer(session: ManagedSession, bytes: Uint8Array): void {
    const buf = session.outputBuffer;
    const cap = buf.length;

    for (let i = 0; i < bytes.length; i++) {
      buf[session.outputBufferPos] = bytes[i];
      session.outputBufferPos = (session.outputBufferPos + 1) % cap;
    }
    session.outputBufferTotal += bytes.length;
  }

  /** Apply terminal preferences to all existing sessions. */
  applyPreferences(prefs: TerminalPreferences): void {
    for (const session of this.sessions.values()) {
      const { terminal } = session;
      terminal.options.fontFamily = `"${prefs.fontFamily}", monospace`;
      terminal.options.fontSize = prefs.fontSize;
      terminal.options.lineHeight = prefs.lineHeight;
      terminal.options.letterSpacing = prefs.letterSpacing;
      terminal.options.cursorStyle = prefs.cursorStyle;
      terminal.options.cursorBlink = prefs.cursorBlink;
      try {
        session.fitAddon.fit();
      } catch {
        // Terminal may not be attached to DOM
      }
    }
  }

  /** Get all active session keys. */
  getSessionKeys(): string[] {
    return [...this.sessions.keys()];
  }

  /**
   * Refresh lastHeartbeat to now for all sessions that have received at least
   * one heartbeat. Called on system wake to prevent false-positive stale
   * detection: when the laptop sleeps, Date.now() jumps forward on wake, but
   * Rust's heartbeat thread only resumes ~2 s later — the stale check fires
   * before the first post-wake heartbeat arrives.
   */
  refreshHeartbeats(): void {
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (session.lastHeartbeat > 0 && !session.ptyExited) {
        session.lastHeartbeat = now;
      }
    }
  }

  /** Get buffered output for a session as a base64 string for persistence. */
  getBufferedOutputBase64(sessionKey: string): string {
    const bytes = this.getBufferedOutput(sessionKey);
    return btoa(String.fromCharCode(...bytes));
  }

  /**
   * Read the circular buffer contents in chronological order.
   * Useful for replaying output when a terminal UI re-attaches.
   */
  getBufferedOutput(sessionKey: string): Uint8Array {
    const session = this.sessions.get(sessionKey);
    if (!session) return new Uint8Array(0);

    const { outputBuffer: buf, outputBufferPos: pos, outputBufferTotal: total } =
      session;
    const cap = buf.length;

    if (total <= cap) {
      // Buffer hasn't wrapped — return [0..pos)
      return buf.slice(0, pos);
    }

    // Buffer has wrapped — read from pos (oldest) to pos (newest)
    const result = new Uint8Array(cap);
    result.set(buf.subarray(pos), 0);
    result.set(buf.subarray(0, pos), cap - pos);
    return result;
  }
}

// ── Singleton (HMR-safe) ───────────────────────────────────────
// Preserve the session manager across Vite HMR reloads so active PTY
// sessions aren't orphaned when editing this file during development.

const HMR_KEY = "__alfredo_sessionManager";

export const sessionManager: SessionManager =
  (window as any)[HMR_KEY] ?? ((window as any)[HMR_KEY] = new SessionManager());

// Live-update all terminals when preferences change in settings
window.addEventListener("terminal-preferences-changed", ((e: CustomEvent<TerminalPreferences>) => {
  sessionManager.applyPreferences(e.detail);
}) as EventListener);

// On system wake (laptop lid open / display unsleep), refresh lastHeartbeat
// for all live sessions so stale-server checks don't false-positive before
// Rust's heartbeat thread resumes (~2 s after wake).
// Guard against HMR double-registration: module re-evaluates on each hot reload
// but document listeners are never removed, so without the guard each reload
// would add another listener.
const WAKE_LISTENER_KEY = "__alfredo_wakeListener";
if (!(window as any)[WAKE_LISTENER_KEY]) {
  (window as any)[WAKE_LISTENER_KEY] = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      sessionManager.refreshHeartbeats();
    }
  });
}

if (import.meta.hot) {
  import.meta.hot.accept();
}

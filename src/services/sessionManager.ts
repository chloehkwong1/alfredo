import { FitAddon } from "@xterm/addon-fit";
import FontFaceObserver from "fontfaceobserver";
import type { AgentType, SessionType } from "../types";
import { spawnPty, closePty, resizePty, reattachPty, getConfig, debugLog, getAssignedWorktreePort } from "../api";
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
  STALE_SUBAGENT_FORCE_MS,
  createSessionChannel,
  fireDebugNotification,
  hasWorkInFlight,
  type SessionWriter,
} from "./sessionChannel";

// Re-export for external consumers
export type { ManagedSession } from "./sessionTypes";
export { shouldAcceptDetectorState, stateSourceMap } from "./sessionChannel";

// ── SessionManager ─────────────────────────────────────────────

export class SessionManager implements SessionWriter {
  private sessions = new Map<string, ManagedSession>();

  private reconcileTimer: ReturnType<typeof setInterval> | null = null;

  /** Incremented on each applyPreferences call so a slower-resolving font-load
   * from an older call can't stamp its fontFamily over a newer one. */
  private prefsSeq = 0;

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
      // Both paths are additionally gated on !hasWorkInFlight (workDepth === 0
      // AND subagentDepth === 0): a tool in flight (workDepth > 0) or a
      // background subagent in flight (subagentDepth > 0) is structural proof
      // work is happening — no time-based rescue should fire until
      // toolEnd/subagentEnd decrements the counter or turnEnd/promptStart
      // resets it. Without the subagentDepth arm, a worktree running silent
      // background agents for 60s+ would be falsely marked stale.

      // Stranded-subagent self-heal: subagentDepth is normally cleared by
      // subagentEnd or the next promptStart, but a dropped SubagentStop hook
      // (curl --max-time 2 timeout) would otherwise strand it > 0 forever —
      // and because the rescue paths below are gated on !hasWorkInFlight, the
      // session would be stuck "Running N agents…" with no recovery. If BOTH
      // channels have been silent well past the normal thresholds, treat the
      // count as lost and clear it so the standard rescue can proceed on this
      // same tick. The output-silence requirement means a genuinely long
      // background agent that is still streaming output is never false-healed.
      if (
        session.subagentDepth > 0
        && session.lastHookAt > 0
        && now - session.lastHookAt > STALE_SUBAGENT_FORCE_MS
        && session.lastOutputAt > 0
        && now - session.lastOutputAt > STALE_OUTPUT_IDLE_MS
      ) {
        const lostMsg = `[reconcile:${worktreeId}] stranded subagentDepth=${session.subagentDepth} cleared (hooks silent ${now - session.lastHookAt}ms, no output ${now - session.lastOutputAt}ms — assuming dropped SubagentStop, sessionKey=${sessionKey})`;
        console.warn(lostMsg);
        debugLog(lostMsg).catch(() => {});
        session.subagentDepth = 0;
      }

      if (
        session.agentState === "busy"
        && !hasWorkInFlight(session)
        && session.lastHookAt > 0
        && now - session.lastHookAt > STALE_HOOK_MS
        && session.lastOutputAt > 0
        && now - session.lastOutputAt > STALE_OUTPUT_IDLE_MS
      ) {
        const silentSec = Math.round((now - session.lastHookAt) / 1000);
        const wt = store.worktrees.find((w) => w.id === worktreeId);
        const branch = wt?.branch ?? worktreeId;
        const softMsg = `[reconcile:${worktreeId}] busy → idle (SOFT: hooks silent ${now - session.lastHookAt}ms, no output ${now - session.lastOutputAt}ms, depth=${session.workDepth}, last hook: ${session.lastHookDesc || "?"}, sessionKey=${sessionKey}, sessionId=${session.sessionId})`;
        console.warn(softMsg);
        debugLog(softMsg).catch(() => {});
        fireDebugNotification(`${branch}: stuck busy rescued (last hook: ${session.lastHookDesc || "?"}, ${silentSec}s ago, output stopped)`);
        session.agentState = "idle";
        useSessionStatusStore.getState().setSessionStatus(sessionKey, "idle");
        continue;
      }

      // Hook channel silent past force threshold while output is still flowing.
      // We can't tell whether work is genuinely done (TUI status-bar redraws
      // keep lastOutputAt fresh after idle) or whether claude is busy with a
      // broken hook channel (e.g. settings.local.json hooks stripped out).
      // Both possibilities mean "we don't know" — surface that as staleBusy
      // so the sidebar renders "stale" instead of confidently lying with
      // "idle". A real idle state will arrive via a fresh hook or via the
      // soft path once output also goes silent.
      if (
        session.agentState === "busy"
        && !hasWorkInFlight(session)
        && session.lastHookAt > 0
        && now - session.lastHookAt > STALE_HOOK_FORCE_MS
      ) {
        const current = store.worktrees.find((w) => w.id === worktreeId);
        if (current && !current.staleBusy) {
          useWorkspaceStore.getState().updateWorktree(worktreeId, { staleBusy: true });
        }
        if (session.staleHookNotifiedAt === 0) {
          const silentSec = Math.round((now - session.lastHookAt) / 1000);
          const branch = current?.branch ?? worktreeId;
          const forceMsg = `[reconcile:${worktreeId}] busy marked stale (hooks silent ${now - session.lastHookAt}ms, output still flowing, depth=${session.workDepth}, last hook: ${session.lastHookDesc || "?"}, sessionKey=${sessionKey}, sessionId=${session.sessionId})`;
          console.warn(forceMsg);
          debugLog(forceMsg).catch(() => {});
          fireDebugNotification(`${branch}: hook channel silent (last hook: ${session.lastHookDesc || "?"}, ${silentSec}s ago) — status may be stale`);
          session.staleHookNotifiedAt = now;
        }
        continue;
      }

      // ── staleBusy display flag ──────────────────────────────
      // Gate on subagentDepth === 0: a session running background agents is
      // legitimately busy even when its own output goes silent, so it must show
      // "Running N agents…", not "Unresponsive".
      const alive = !session.sessionId || now - session.lastHeartbeat < 6000;
      const staleBusy = session.subagentDepth === 0
        && computeStaleBusy(session.agentState, alive, session.lastOutputAt, now);
      const current = useWorkspaceStore.getState().worktrees.find((w) => w.id === worktreeId);
      if (current && current.staleBusy !== staleBusy) {
        useWorkspaceStore.getState().updateWorktree(worktreeId, { staleBusy });
      }
    }

    // ── runningAgents count (sidebar "Running N agents…") ──────
    // Aggregate background-subagent depth across every session of each worktree
    // and project the total onto the worktree. Kept separate from the rescue
    // loop above (which has several early `continue`s) so the count is computed
    // for every live session. 500ms lag on the *number* is fine — the busy
    // status itself flips in real time via the hook handler + status mirror.
    const subagentCounts = new Map<string, number>();
    for (const [key, sess] of this.sessions.entries()) {
      if (sess.ptyExited) continue;
      if (sess.subagentDepth > 0) {
        const wid = key.split(":")[0];
        subagentCounts.set(wid, (subagentCounts.get(wid) ?? 0) + sess.subagentDepth);
      }
    }
    for (const wt of useWorkspaceStore.getState().worktrees) {
      const n = subagentCounts.get(wt.id) ?? 0;
      if ((wt.runningAgents ?? 0) !== n) {
        useWorkspaceStore.getState().updateWorktree(wt.id, { runningAgents: n });
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
      existing.disposed = true;
      existing.pendingOutput = [];
      existing.terminal.dispose();
      this.sessions.delete(sessionKey);
    }

    // Create xterm instance (headless — not attached to DOM yet)
    const { terminal, searchAddon } = createTerminal({ cwd: worktreePath });
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
      webglAddon: null,
      agentState: mode === "shell" ? "notRunning" : "busy",
      hooksActive: false,
      outputBuffer: new Uint8Array(OUTPUT_BUFFER_CAPACITY),
      outputBufferPos: 0,
      outputBufferTotal: 0,
      lastHeartbeat: Date.now(),
      ptyExited: false,
      lastOutputAt: Date.now(),
      pendingOutput: [],
      writeInFlight: false,
      disposed: false,
      restoredFromScrollback: false,
      startupCommandSent: false,
      allowNextClearScrollback: false,
      lastHookAt: 0,
      lastHookDesc: "",
      hookDerivedState: null,
      pendingIdleTimer: null,
      turnEndAt: 0,
      workDepth: 0,
      subagentDepth: 0,
      lastSubagentActivityAt: 0,
      pasteDiagDrainChain: 0,
      pasteDiagLastLogAt: 0,
      staleHookNotifiedAt: 0,
    };

    // Wire up the Tauri channel — this keeps pumping events regardless of UI.
    const channel = createSessionChannel(this, session, worktreeId, sessionKey);

    const agentType = AGENT_TYPE_MAP[mode] as AgentType | undefined;

    this.sessions.set(sessionKey, session);

    const worktree = useWorkspaceStore.getState().worktrees.find((w) => w.id === worktreeId);
    // Read-only lookup: we never claim a port at session spawn. The explicit
    // "Start server" path (useServer.handleToggleServer) is the only place
    // that can assign a new port and surface the exhaustion dialog. Sessions
    // for worktrees that have never run a server simply spawn portless.
    let assignedPort: number | undefined;
    let portEnvVar: string | undefined;
    if (worktree?.repoPath) {
      // Port-assignment is non-essential. A malformed alfredo.json or any
      // other config-read failure must not block the PTY spawn — the user
      // still needs a working terminal. The error surfaces separately in
      // Repository Settings, which calls getConfig directly.
      try {
        const repoConfig = await getConfig(worktree.repoPath);
        if (repoConfig.autoAssignPorts) {
          const persisted = await getAssignedWorktreePort(worktree.repoPath, worktreeId);
          if (persisted) {
            assignedPort = persisted;
            portEnvVar = repoConfig.portEnvVar ?? undefined;
          }
        }
      } catch (err) {
        console.error(`[sessionManager] port lookup failed for ${worktree.repoPath} — spawning without auto-assigned port:`, err);
      }
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
        worktree?.repoPath,
      );
    } catch (err) {
      // Spawn failed — remove session from map to prevent zombie
      session.disposed = true;
      session.pendingOutput = [];
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
    worktreePath?: string,
  ): ManagedSession {
    const existing = this.sessions.get(sessionKey);
    if (existing) return existing;

    const { terminal, searchAddon } = createTerminal({ cwd: worktreePath });
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
      webglAddon: null,
      agentState: "notRunning",
      hooksActive: false,
      outputBuffer: restoredBuffer,
      outputBufferPos: restoredPos,
      outputBufferTotal: restoredTotal,
      lastHeartbeat: 0,
      ptyExited: false,
      lastOutputAt: 0,
      pendingOutput: [],
      writeInFlight: false,
      disposed: false,
      restoredFromScrollback: true,
      startupCommandSent: false,
      allowNextClearScrollback: false,
      lastHookAt: 0,
      lastHookDesc: "",
      hookDerivedState: null,
      pendingIdleTimer: null,
      turnEndAt: 0,
      workDepth: 0,
      subagentDepth: 0,
      lastSubagentActivityAt: 0,
      pasteDiagDrainChain: 0,
      pasteDiagLastLogAt: 0,
      staleHookNotifiedAt: 0,
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
    let assignedPort: number | undefined;
    let portEnvVar: string | undefined;
    if (wt?.repoPath) {
      // See getOrSpawn — port lookup is non-essential, must not block spawn.
      try {
        const repoConfig = await getConfig(wt.repoPath);
        if (repoConfig.autoAssignPorts) {
          const persisted = await getAssignedWorktreePort(wt.repoPath, worktreeId);
          if (persisted) {
            assignedPort = persisted;
            portEnvVar = repoConfig.portEnvVar ?? undefined;
          }
        }
      } catch (err) {
        console.error(`[sessionManager] port lookup failed for ${wt.repoPath} — spawning without auto-assigned port:`, err);
      }
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
        wt?.repoPath,
      );
    } catch (e) {
      // Spawn failed — remove session so it doesn't get stuck as scrollback-only
      session.disposed = true;
      session.pendingOutput = [];
      session.terminal.dispose();
      this.sessions.delete(sessionKey);
      useSessionStatusStore.getState().clearSessionStatus(sessionKey);
      throw e;
    }
    session.sessionId = sessionId;
    session.ptyExited = false;
    session.agentState = mode === "shell" ? "notRunning" : "busy";
    session.workDepth = 0;
    session.subagentDepth = 0;
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

    const cwd = useWorkspaceStore.getState().worktrees.find((w) => w.id === worktreeId)?.path;
    const { terminal, searchAddon } = createTerminal({ cwd });
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
      webglAddon: null,
      agentState: "busy",
      hooksActive: false,
      outputBuffer: new Uint8Array(OUTPUT_BUFFER_CAPACITY),
      outputBufferPos: 0,
      outputBufferTotal: 0,
      lastHeartbeat: Date.now(),
      ptyExited: false,
      lastOutputAt: 0,
      pendingOutput: [],
      writeInFlight: false,
      disposed: false,
      restoredFromScrollback: false,
      startupCommandSent: true,
      allowNextClearScrollback: false,
      lastHookAt: 0,
      lastHookDesc: "",
      hookDerivedState: null,
      pendingIdleTimer: null,
      turnEndAt: 0,
      workDepth: 0,
      subagentDepth: 0,
      lastSubagentActivityAt: 0,
      pasteDiagDrainChain: 0,
      pasteDiagLastLogAt: 0,
      staleHookNotifiedAt: 0,
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

    // Clean up remote-control state for this session
    useRemoteControlStore.getState().disable(sessionKey);

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
    session.subagentDepth = 0;
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

    // Clean up remote-control state for this session
    useRemoteControlStore.getState().disable(sessionKey);

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
    // Mark disposed BEFORE dispose() so an in-flight write callback bails
    // instead of calling .write() on a disposed terminal.
    session.disposed = true;
    session.pendingOutput = [];
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
   * Feed PTY output into xterm with back-pressure. Only one write() is in
   * flight at a time; new output accumulates in pendingOutput until xterm's
   * parsed-callback fires, at which point we merge everything pending into
   * a single write and loop. Prevents xterm's internal WriteBuffer from
   * growing unbounded when PTY throughput exceeds parse+render throughput
   * (e.g. a noisy `rails console`), which otherwise queues keystroke echo
   * behind minutes of backlog.
   *
   * Per-call cap: merge up to PER_WRITE_CAP bytes; leave the remainder in
   * pendingOutput so no single write() call parks xterm's parser for too
   * long. xterm internally yields every 65 KB, so 256 KB = ~4 yields per
   * call — plenty of room for keydown events to interleave.
   */
  /** @internal Exposed for createSessionChannel — not part of the public API. */
  scheduleWrite(session: ManagedSession, bytes: Uint8Array): void {
    session.pendingOutput.push(bytes);
    this.drainPending(session);
  }

  private drainPending(session: ManagedSession): void {
    if (session.writeInFlight) return;
    if (session.disposed) {
      session.pendingOutput = [];
      return;
    }
    if (session.pendingOutput.length === 0) return;

    const PER_WRITE_CAP = 256 * 1024;
    const chunks = session.pendingOutput;
    let total = 0;
    let consumed = 0;
    for (const c of chunks) {
      if (total + c.length > PER_WRITE_CAP && consumed > 0) break;
      total += c.length;
      consumed++;
    }

    let merged: Uint8Array;
    if (consumed === 1) {
      merged = chunks[0];
    } else {
      merged = new Uint8Array(total);
      let offset = 0;
      for (let i = 0; i < consumed; i++) {
        merged.set(chunks[i], offset);
        offset += chunks[i].length;
      }
    }
    session.pendingOutput = chunks.slice(consumed);

    session.writeInFlight = true;
    session.pasteDiagDrainChain += 1;
    const writeStartAt = Date.now();
    const writeBytes = total;
    session.terminal.write(merged, () => {
      const parseLatencyMs = Date.now() - writeStartAt;
      session.writeInFlight = false;

      if (session.disposed) {
        session.pendingOutput = [];
        return;
      }

      const pendingAfter = session.pendingOutput.reduce((s, c) => s + c.length, 0);
      const tripped =
        parseLatencyMs > 200 ||
        pendingAfter > 512 * 1024 ||
        session.pasteDiagDrainChain > 50;
      const now = Date.now();
      if (tripped && now - session.pasteDiagLastLogAt > 1000) {
        session.pasteDiagLastLogAt = now;
        debugLog(
          `[paste-diag] sessionId=${session.sessionId} bytes=${writeBytes} parseMs=${parseLatencyMs} pendingAfter=${pendingAfter}B chain=${session.pasteDiagDrainChain}`,
        ).catch(() => {});
      }

      if (session.pendingOutput.length === 0) {
        session.pasteDiagDrainChain = 0;
      }
      this.drainPending(session);
    });
  }

  /** @internal Exposed for createSessionChannel — not part of the public API. */
  appendToBuffer(session: ManagedSession, bytes: Uint8Array): void {
    const buf = session.outputBuffer;
    const cap = buf.length;
    const len = bytes.length;

    // Bytes larger than the ring capacity: keep only the tail — older bytes
    // would be overwritten by the wraparound anyway. Single set() is enough.
    if (len >= cap) {
      buf.set(bytes.subarray(len - cap), 0);
      session.outputBufferPos = 0;
      session.outputBufferTotal += len;
      return;
    }

    const pos = session.outputBufferPos;
    const tail = cap - pos;
    if (len <= tail) {
      buf.set(bytes, pos);
      session.outputBufferPos = (pos + len) % cap;
    } else {
      buf.set(bytes.subarray(0, tail), pos);
      buf.set(bytes.subarray(tail), 0);
      session.outputBufferPos = len - tail;
    }
    session.outputBufferTotal += len;
  }

  /** Rebuild the WebGL glyph atlas for every live session.
   *
   *  xterm's WebGL renderer can leave the atlas desynced from the cell buffer
   *  after events that invalidate GPU texture state (display sleep/wake, DPI
   *  change, monitor swap). The buffer is correct — only the rendered glyphs
   *  are stale, and `term.refresh()` redraws against the same broken atlas.
   *  Match VS Code's `forceRedraw` (called on OS resume) and Tabby's
   *  display-metrics handler by calling `clearTextureAtlas()` on the known-bad
   *  triggers. Sessions without WebGL (canvas-renderer fallback after a
   *  context-loss) are skipped — the canvas renderer doesn't have the atlas
   *  bug, so a refresh would just be a free repaint. */
  rebuildAtlases(reason: string): void {
    if (this.sessions.size === 0) return;
    let rebuilt = 0;
    for (const session of this.sessions.values()) {
      if (!session.webglAddon) continue;
      try {
        session.webglAddon.clearTextureAtlas();
        rebuilt++;
      } catch {
        // Renderer may have lost context between the trigger and now;
        // its context-loss handler will reload the addon on next attach.
      }
    }
    if (rebuilt > 0) {
      // eslint-disable-next-line no-console
      console.debug(`[atlas] rebuilt ${rebuilt} session(s): ${reason}`);
    }
  }

  /** Apply terminal preferences to all existing sessions. */
  applyPreferences(prefs: TerminalPreferences): void {
    // Apply non-font options synchronously so UI feels responsive; defer the
    // fontFamily swap until regular + bold are loaded, otherwise xterm rebuilds
    // its WebGL atlas against the fallback font and we get synthetic-bold blur
    // (GH#19) until the next reload.
    for (const session of this.sessions.values()) {
      const { terminal, fitAddon } = session;
      terminal.options.fontSize = prefs.fontSize;
      terminal.options.lineHeight = prefs.lineHeight;
      terminal.options.letterSpacing = prefs.letterSpacing;
      terminal.options.cursorStyle = prefs.cursorStyle;
      terminal.options.cursorBlink = prefs.cursorBlink;
      // Cell geometry changed — refit immediately so xterm's cols/rows track
      // the new cell size. The async fit gated on FontFaceObserver can land
      // hundreds of ms later, during which the canvas paints at the new cell
      // size against the old grid (overflow + mid-word reflow on landing).
      try {
        fitAddon.fit();
      } catch {
        // Terminal may not be attached to DOM
      }
    }

    const seq = ++this.prefsSeq;
    // FontFaceObserver verifies canvas-rasterization readiness (measures text
    // width vs fallback), which `document.fonts.load` does not guarantee —
    // without this, the WebGL atlas can rebake against the fallback (GH#19).
    Promise.allSettled([
      new FontFaceObserver(prefs.fontFamily).load(null, 3000),
      new FontFaceObserver(prefs.fontFamily, { weight: 700 }).load(null, 3000),
    ]).finally(() => {
      // Bail if a newer applyPreferences call superseded us — otherwise a
      // slower-loading older font could stamp itself over the new family.
      if (seq !== this.prefsSeq) return;
      for (const session of this.sessions.values()) {
        session.terminal.options.fontFamily = `"${prefs.fontFamily}", monospace`;
        try {
          session.fitAddon.fit();
        } catch {
          // Terminal may not be attached to DOM
        }
      }
    });
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
// Rust's heartbeat thread resumes (~2 s after wake). Also rebuild WebGL
// glyph atlases — GPU texture state can be invalidated across sleep/wake,
// producing the bold-glyph desync that resize otherwise has to fix.
// Guard against HMR double-registration: module re-evaluates on each hot reload
// but document listeners are never removed, so without the guard each reload
// would add another listener.
const WAKE_LISTENER_KEY = "__alfredo_wakeListener";
if (!(window as any)[WAKE_LISTENER_KEY]) {
  (window as any)[WAKE_LISTENER_KEY] = true;
  // Only rebuild the atlas after a meaningful hidden window — alt-tab and
  // brief focus changes don't invalidate GPU texture state, but lid-close /
  // display-sleep / "left the laptop overnight" do, and those manifest as
  // long hidden gaps. The 30 s floor keeps us aligned with VS Code's
  // resume-only intent without needing the Rust NSWorkspace observer.
  const VISIBILITY_REBUILD_FLOOR_MS = 30_000;
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    if (document.visibilityState === "visible") {
      sessionManager.refreshHeartbeats();
      if (hiddenAt > 0 && Date.now() - hiddenAt >= VISIBILITY_REBUILD_FLOOR_MS) {
        sessionManager.rebuildAtlases("visibility-visible");
      }
      hiddenAt = 0;
    }
  });
}

// DPI / display change (external monitor plugged in, scale factor change,
// monitor swap). xterm.js handles font-metric recompute internally, but the
// WebGL texture upload can race the metric change and leave glyphs at the
// wrong slot. Match Tabby's `displayMetricsChanged$` handler.
const DPR_LISTENER_KEY = "__alfredo_dprListener";
if (!(window as any)[DPR_LISTENER_KEY] && typeof window.matchMedia === "function") {
  (window as any)[DPR_LISTENER_KEY] = true;
  const armDprWatch = () => {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener(
      "change",
      () => {
        // Re-arm BEFORE rebuilding so a synchronously-delivered follow-up
        // event (e.g. macOS coalescing a multi-monitor scale-factor drag
        // through several ratios) still has a live MediaQueryList to fire
        // against. matchMedia's resolution query is pinned to the value at
        // construction time, so without the re-arm we'd drop subsequent
        // changes once devicePixelRatio drifts past the original.
        armDprWatch();
        sessionManager.rebuildAtlases("dpr-change");
      },
      { once: true },
    );
  };
  armDprWatch();
}

if (import.meta.hot) {
  import.meta.hot.accept();
}

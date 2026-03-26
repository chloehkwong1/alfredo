import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { AgentState } from "../types";
import { spawnPty, closePty, createPtyChannel } from "../api";
import { useWorkspaceStore } from "../stores/workspaceStore";

// ── Types ──────────────────────────────────────────────────────

/** Maximum bytes retained in the circular output buffer for replay on re-attach. */
const OUTPUT_BUFFER_CAPACITY = 50_000;

/** Duration (ms) during which detector-sourced state changes are suppressed
 *  after an authoritative hook update arrives. */
const HOOK_AUTHORITY_MS = 5_000;

export interface ManagedSession {
  sessionId: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  agentState: AgentState;
  /** Timestamp of the last hook-sourced state update. Detector updates are
   *  suppressed for HOOK_AUTHORITY_MS after this to avoid false overrides. */
  lastHookUpdate: number;
  /** Circular buffer of recent output bytes for replay when re-attaching a UI. */
  outputBuffer: Uint8Array;
  /** Current write position in the circular buffer. */
  outputBufferPos: number;
  /** Total bytes written (used to determine if buffer has wrapped). */
  outputBufferTotal: number;
}

// ── SessionManager ─────────────────────────────────────────────

export class SessionManager {
  private sessions = new Map<string, ManagedSession>();

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
    mode: "claude" | "shell" = "claude",
    initialScrollback?: string,
    args?: string[],
  ): Promise<ManagedSession> {
    const existing = this.sessions.get(sessionKey);
    if (existing) return existing;

    // Create xterm instance (headless — not attached to DOM yet)
    const terminal = new Terminal({
      allowProposedApi: true,
      scrollback: 10_000,
    });
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
      agentState: mode === "shell" ? "notRunning" : "idle",
      lastHookUpdate: Date.now(),
      outputBuffer: new Uint8Array(OUTPUT_BUFFER_CAPACITY),
      outputBufferPos: 0,
      outputBufferTotal: 0,
    };

    // Wire up the Tauri channel — this keeps pumping events regardless of UI.
    const channel = createPtyChannel((event) => {
      switch (event.event) {
        case "output": {
          const bytes = new Uint8Array(event.data);
          terminal.write(bytes);
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

    // Determine command and agent type based on mode
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

    this.sessions.set(sessionKey, session);

    // Push initial state for Claude sessions
    if (mode === "claude") {
      useWorkspaceStore
        .getState()
        .updateWorktree(worktreeId, { agentStatus: session.agentState });
    }

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

  /** Retrieve a managed session without spawning. Returns `null` if none exists. */
  getSession(sessionKey: string): ManagedSession | null {
    return this.sessions.get(sessionKey) ?? null;
  }

  /** Close a single PTY session and dispose its terminal. */
  async closeSession(sessionKey: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) return;

    this.sessions.delete(sessionKey);
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
  }

  // ── Internal helpers ───────────────────────────────────────────

  /** Append bytes to the circular output buffer for later replay. */
  private appendToBuffer(session: ManagedSession, bytes: Uint8Array): void {
    const buf = session.outputBuffer;
    const cap = buf.length;

    for (let i = 0; i < bytes.length; i++) {
      buf[session.outputBufferPos] = bytes[i];
      session.outputBufferPos = (session.outputBufferPos + 1) % cap;
    }
    session.outputBufferTotal += bytes.length;
  }

  /** Get all active session keys. */
  getSessionKeys(): string[] {
    return [...this.sessions.keys()];
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

// ── Singleton ──────────────────────────────────────────────────

export const sessionManager = new SessionManager();

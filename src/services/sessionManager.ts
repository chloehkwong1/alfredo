import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { AgentState } from "../types";
import { spawnPty, closePty, createPtyChannel } from "../api";
import { useWorkspaceStore } from "../stores/workspaceStore";

// ── Types ──────────────────────────────────────────────────────

/** Maximum bytes retained in the circular output buffer for replay on re-attach. */
const OUTPUT_BUFFER_CAPACITY = 50_000;

export interface ManagedSession {
  sessionId: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  agentState: AgentState;
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
   * Return an existing session for the worktree, or spawn a new one.
   * The channel callback is wired up immediately so agent-state events
   * flow to the workspace store even when no terminal UI is mounted.
   */
  async getOrSpawn(
    worktreeId: string,
    worktreePath: string,
  ): Promise<ManagedSession> {
    const existing = this.sessions.get(worktreeId);
    if (existing) return existing;

    // Create xterm instance (headless — not attached to DOM yet)
    const terminal = new Terminal({
      allowProposedApi: true,
      scrollback: 10_000,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    const session: ManagedSession = {
      sessionId: "", // filled after spawn
      terminal,
      fitAddon,
      agentState: "busy",
      outputBuffer: new Uint8Array(OUTPUT_BUFFER_CAPACITY),
      outputBufferPos: 0,
      outputBufferTotal: 0,
    };

    // Wire up the Tauri channel — this keeps pumping events regardless of UI.
    // State events arrive both from the Rust agent detector AND from the
    // HTTP state server (hook callbacks). Both use the same channel.
    const channel = createPtyChannel((event) => {
      switch (event.event) {
        case "output": {
          const bytes = new Uint8Array(event.data);

          // Write to xterm (handles parsing / rendering when attached)
          terminal.write(bytes);

          // Append to circular replay buffer
          this.appendToBuffer(session, bytes);
          break;
        }
        case "agentState": {
          session.agentState = event.data;
          useWorkspaceStore
            .getState()
            .updateWorktree(worktreeId, { agentStatus: event.data });
          break;
        }
      }
    });

    // Spawn the PTY process on the Rust side.
    // The Rust command now accepts worktreeId so it can register the channel
    // with the state server and set env vars for hook callbacks.
    const sessionId = await spawnPty(
      worktreeId,
      worktreePath,
      "claude",
      [],
      channel,
      "claudeCode",
    );
    session.sessionId = sessionId;

    this.sessions.set(worktreeId, session);

    // Push initial state to the workspace store immediately so kanban cards
    // reflect the correct status without waiting for a Rust state-change event.
    useWorkspaceStore
      .getState()
      .updateWorktree(worktreeId, { agentStatus: session.agentState });

    return session;
  }

  /** Retrieve a managed session without spawning. Returns `null` if none exists. */
  getSession(worktreeId: string): ManagedSession | null {
    return this.sessions.get(worktreeId) ?? null;
  }

  /** Close a single PTY session and dispose its terminal. */
  async closeSession(worktreeId: string): Promise<void> {
    const session = this.sessions.get(worktreeId);
    if (!session) return;

    this.sessions.delete(worktreeId);
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

  /**
   * Read the circular buffer contents in chronological order.
   * Useful for replaying output when a terminal UI re-attaches.
   */
  getBufferedOutput(worktreeId: string): Uint8Array {
    const session = this.sessions.get(worktreeId);
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

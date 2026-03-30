import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { AgentState } from "../types";
import { spawnPty, closePty, createPtyChannel, resizePty, writePty } from "../api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useRemoteControlStore } from "../stores/remoteControlStore";
import { loadTerminalPreferences } from "./terminalPreferences";
import type { TerminalPreferences } from "./terminalPreferences";

// ── Types ──────────────────────────────────────────────────────

/** Maximum bytes retained in the circular output buffer for replay on re-attach. */
const OUTPUT_BUFFER_CAPACITY = 50_000;

export interface ManagedSession {
  sessionId: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  /** True once the WebGL renderer has been loaded (or failed). */
  webglLoaded: boolean;
  agentState: AgentState;
  /** True once at least one hook event has been received. When true,
   *  ALL detector-sourced state updates are ignored — hooks are the
   *  sole source of truth for agent state. */
  hooksActive: boolean;
  /** Circular buffer of recent output bytes for replay when re-attaching a UI. */
  outputBuffer: Uint8Array;
  /** Current write position in the circular buffer. */
  outputBufferPos: number;
  /** Total bytes written (used to determine if buffer has wrapped). */
  outputBufferTotal: number;
  /** Timestamp of the last heartbeat received from the PTY channel. */
  lastHeartbeat: number;
  /** Timestamp of the last PTY output received. Used to detect stale busy state. */
  lastOutputAt: number;
  /** Pending output chunks awaiting the next animation frame flush. */
  pendingOutput: Uint8Array[];
  /** Whether a requestAnimationFrame flush is already scheduled. */
  writeScheduled: boolean;
}

/**
 * Create a Terminal instance with:
 * - Kitty keyboard protocol support (Shift+Enter for newline in Claude Code)
 * - Clickable links via WebLinksAddon (Cmd+Click to open URLs and file paths)
 *
 * Kitty protocol: xterm.js doesn't natively support the kitty keyboard
 * protocol. Claude Code queries for support via `CSI ? u` — we intercept
 * this in the parser and respond affirmatively so Claude Code enables the
 * protocol. Then our custom key handler sends `CSI 13;2 u` for Shift+Enter,
 * which Claude Code interprets as "insert newline".
 */
function createTerminal(): { terminal: Terminal; searchAddon: SearchAddon } {
  const prefs = loadTerminalPreferences();
  const terminal = new Terminal({
    allowProposedApi: true,
    scrollback: 10_000,
    fontFamily: `"${prefs.fontFamily}", monospace`,
    fontSize: prefs.fontSize,
    lineHeight: prefs.lineHeight,
    letterSpacing: prefs.letterSpacing,
    cursorStyle: prefs.cursorStyle,
    cursorBlink: prefs.cursorBlink,
  });

  // Suppress terminal bell sound (BEL character from agent output)
  terminal.onBell(() => { /* noop — suppress system notification */ });

  const unicodeAddon = new Unicode11Addon();
  terminal.loadAddon(unicodeAddon);
  terminal.unicode.activeVersion = "11";

  // ── Clickable links ────────────────────────────────────────────
  const webLinksAddon = new WebLinksAddon((_event, uri) => {
    openUrl(uri).catch(console.error);
  });
  terminal.loadAddon(webLinksAddon);

  // ── Search ─────────────────────────────────────────────────────
  const searchAddon = new SearchAddon();
  terminal.loadAddon(searchAddon);

  // ── Shift+Enter → newline ──────────────────────────────────────
  // Block ALL event types (keydown, keypress, keyup) for Shift+Enter.
  // Only send the kitty sequence on keydown to avoid duplicates.
  terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
    // Shift+Enter → send kitty protocol sequence for newline
    if (event.key === "Enter" && event.shiftKey) {
      if (event.type === "keydown") {
        terminal.input("\x1b[13;2u", false);
      }
      return false;
    }
    // Let all Cmd+ shortcuts bubble to app-level handlers
    if (event.metaKey) {
      return false;
    }
    return true;
  });

  return { terminal, searchAddon };
}

/**
 * Register kitty keyboard protocol handlers on the terminal parser.
 * Must be called after the PTY session is spawned so we have a session ID
 * to send responses back to the PTY.
 *
 * Claude Code sends `CSI ? u` to query keyboard protocol support.
 * We respond with `CSI ? 1 u` (flags=1: disambiguate escape codes).
 * Claude Code then sends `CSI > flags u` to enable — we swallow that.
 */
function registerKittyProtocol(terminal: Terminal, sessionId: string): void {
  // Query: CSI ? u → respond with current flags
  terminal.parser.registerCsiHandler({ prefix: "?", final: "u" }, () => {
    const response = "\x1b[?1u";
    const bytes = Array.from(new TextEncoder().encode(response));
    writePty(sessionId, bytes).catch(console.error);
    return true;
  });

  // Push (enable): CSI > flags u → swallow (we handle keys in attachCustomKeyEventHandler)
  terminal.parser.registerCsiHandler({ prefix: ">", final: "u" }, () => true);

  // Pop (disable): CSI < flags u → swallow
  terminal.parser.registerCsiHandler({ prefix: "<", final: "u" }, () => true);
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
    if (existing) {
      // Scrollback-only session (no PTY yet) — spawn a PTY for it
      if (!existing.sessionId && existing.lastHeartbeat === 0) {
        return this.spawnForExisting(sessionKey, worktreeId, worktreePath, mode, args);
      }
      // Zombie detection: session exists but PTY never spawned or died
      const isZombie = !existing.sessionId && existing.lastHeartbeat > 0 &&
        Date.now() - existing.lastHeartbeat > 10_000;
      if (!isZombie) return existing;
      // Clean up the zombie so we can spawn fresh — reset agent status so the
      // new session's notRunning → idle doesn't trigger a false notification.
      useWorkspaceStore
        .getState()
        .updateWorktree(worktreeId, { agentStatus: "notRunning" });
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
      agentState: mode === "shell" ? "notRunning" : "idle",
      hooksActive: false,
      outputBuffer: new Uint8Array(OUTPUT_BUFFER_CAPACITY),
      outputBufferPos: 0,
      outputBufferTotal: 0,
      lastHeartbeat: Date.now(),
      lastOutputAt: Date.now(),
      pendingOutput: [],
      writeScheduled: false,
    };

    // Wire up the Tauri channel — this keeps pumping events regardless of UI.
    const channel = createPtyChannel((event) => {
      switch (event.event) {
        case "output": {
          const bytes = new Uint8Array(event.data);
          session.lastOutputAt = Date.now();
          this.scheduleWrite(session, bytes);
          this.appendToBuffer(session, bytes);
          break;
        }
        case "heartbeat": {
          session.lastHeartbeat = Date.now();
          break;
        }
        case "hookAgentState": {
          session.agentState = event.data;
          session.hooksActive = true;
          useWorkspaceStore
            .getState()
            .updateWorktree(worktreeId, { agentStatus: event.data });
          break;
        }
        case "agentState": {
          if (session.hooksActive) {
            // Hooks are authoritative for busy state, but they can miss
            // downward transitions (e.g. Ctrl+C killing hook commands,
            // or permission_prompt/elicitation_dialog matchers not firing
            // for all prompt types). Allow detector idle, notRunning, and
            // waitingForInput signals through as a safety net — the
            // detector's prompt/idle matching is highly reliable and
            // prevents stuck "busy" states.
            if (
              event.data === "idle" ||
              event.data === "notRunning" ||
              event.data === "waitingForInput"
            ) {
              session.agentState = event.data;
              useWorkspaceStore
                .getState()
                .updateWorktree(worktreeId, { agentStatus: event.data });
            }
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

    this.sessions.set(sessionKey, session);

    let sessionId: string;
    try {
      sessionId = await spawnPty(
        worktreeId,
        worktreePath,
        command,
        args ?? [],
        channel,
        agentType,
      );
    } catch (err) {
      // Spawn failed — remove session from map to prevent zombie
      session.terminal.dispose();
      this.sessions.delete(sessionKey);
      throw err;
    }
    session.sessionId = sessionId;
    registerKittyProtocol(terminal, sessionId);

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

    const { terminal, searchAddon } = createTerminal();
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
      searchAddon,
      webglLoaded: false,
      agentState: "notRunning",
      hooksActive: false,
      outputBuffer: new Uint8Array(OUTPUT_BUFFER_CAPACITY),
      outputBufferPos: 0,
      outputBufferTotal: 0,
      lastHeartbeat: 0,
      lastOutputAt: 0,
      pendingOutput: [],
      writeScheduled: false,
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
          session.lastOutputAt = Date.now();
          this.scheduleWrite(session, bytes);
          this.appendToBuffer(session, bytes);
          break;
        }
        case "heartbeat": {
          session.lastHeartbeat = Date.now();
          break;
        }
        case "hookAgentState": {
          session.agentState = event.data;
          session.hooksActive = true;
          useWorkspaceStore
            .getState()
            .updateWorktree(worktreeId, { agentStatus: event.data });
          break;
        }
        case "agentState": {
          if (session.hooksActive) {
            // Hooks are authoritative for busy state, but they can miss
            // downward transitions (e.g. Ctrl+C killing hook commands,
            // or permission_prompt/elicitation_dialog matchers not firing
            // for all prompt types). Allow detector idle, notRunning, and
            // waitingForInput signals through as a safety net — the
            // detector's prompt/idle matching is highly reliable and
            // prevents stuck "busy" states.
            if (
              event.data === "idle" ||
              event.data === "notRunning" ||
              event.data === "waitingForInput"
            ) {
              session.agentState = event.data;
              useWorkspaceStore
                .getState()
                .updateWorktree(worktreeId, { agentStatus: event.data });
            }
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
    session.lastHeartbeat = Date.now();
    session.lastOutputAt = Date.now();
    registerKittyProtocol(session.terminal, sessionId);

    // Resize PTY immediately to match the terminal's current dimensions.
    // The PTY starts at 80×24 but the terminal was already fitted to the
    // container during the disconnected/scrollback phase.
    const { rows, cols } = session.terminal;
    if (rows > 0 && cols > 0) {
      resizePty(sessionId, rows, cols).catch(e => console.warn(`[sessionManager] Failed to resize PTY for ${sessionId}:`, e));
    }

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
  }

  /** Close a single PTY session and dispose its terminal. */
  async closeSession(sessionKey: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) return;

    // Clean up remote-control state for this worktree
    const worktreeId = sessionKey.split(":")[0];
    useRemoteControlStore.getState().disable(worktreeId);

    // Reset agent status so that the subsequent session spawn
    // (notRunning → idle) doesn't trigger a false "finished" notification.
    useWorkspaceStore
      .getState()
      .updateWorktree(worktreeId, { agentStatus: "notRunning" });

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

  /**
   * Batch terminal writes via requestAnimationFrame so the browser's event
   * loop can process click/input events between frames. Without this, rapid
   * PTY output (hundreds of IPC events/sec) can starve the main thread.
   */
  private scheduleWrite(session: ManagedSession, bytes: Uint8Array): void {
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

// Live-update all terminals when preferences change in settings
window.addEventListener("terminal-preferences-changed", ((e: CustomEvent<TerminalPreferences>) => {
  sessionManager.applyPreferences(e.detail);
}) as EventListener);

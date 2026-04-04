import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { AgentState, AgentType } from "../types";
import { spawnPty, closePty, createPtyChannel, resizePty, writePty } from "../api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useRemoteControlStore } from "../stores/remoteControlStore";
import { loadTerminalPreferences } from "./terminalPreferences";
import type { TerminalPreferences } from "./terminalPreferences";

// ── Constants ────────────────────────────────────────────────

/** Maps frontend tab mode names to Rust AgentType enum variants. */
const AGENT_TYPE_MAP: Record<string, string> = {
  claude: "claudeCode",
  codex: "codex",
  gemini: "geminiCli",
};

// ── Helpers ───────────────────────────────────────────────────

/**
 * Strip ESC[3J (clear scrollback buffer) sequences from PTY output.
 * Claude Code sends these during TUI re-renders, which wipes xterm's
 * scrollback and makes it impossible to scroll up to earlier output.
 * ESC[2J (clear visible screen) is left intact — the TUI needs it.
 */
function stripClearScrollback(bytes: Uint8Array): Uint8Array {
  // ESC[3J = 0x1b 0x5b 0x33 0x4a
  const indices: number[] = [];
  for (let i = 0; i <= bytes.length - 4; i++) {
    if (bytes[i] === 0x1b && bytes[i + 1] === 0x5b && bytes[i + 2] === 0x33 && bytes[i + 3] === 0x4a) {
      indices.push(i);
    }
  }
  if (indices.length === 0) return bytes;

  const result = new Uint8Array(bytes.length - indices.length * 4);
  let src = 0;
  let dst = 0;
  for (const idx of indices) {
    const chunk = bytes.subarray(src, idx);
    result.set(chunk, dst);
    dst += chunk.length;
    src = idx + 4;
  }
  if (src < bytes.length) {
    result.set(bytes.subarray(src), dst);
  }
  return result;
}

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
  /** Whether this session was restored from saved scrollback (for auto-resume). */
  restoredFromScrollback: boolean;
  /** Sticky flag: true while agent is waiting for user input. Prevents late
   *  "busy" hook events (e.g. a delayed PreToolUse) from overriding
   *  waitingForInput. Cleared when user provides input (writePty). */
  waitingForInput: boolean;
  /** True once a startup command has been written to this session's PTY.
   *  Prevents StrictMode double-fire from executing the command twice. */
  startupCommandSent: boolean;
  /** Optional callback fired once when the first output byte arrives. */
  onFirstOutput?: () => void;
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
    linkHandler: {
      activate(_event: MouseEvent, uri: string) {
        // Only open http(s) links to prevent javascript: or other dangerous URIs
        if (/^https?:\/\//i.test(uri)) {
          openUrl(uri).catch(console.error);
        }
      },
    },
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

export function shouldAcceptDetectorState(
  hooksActive: boolean,
  _detectorState: AgentState,
): boolean {
  // Once hooks have fired, they are the sole source of truth.
  // Every state the detector could provide is already covered:
  //   idle            → Stop hook, Notification(idle_prompt)
  //   busy            → PreToolUse, PostToolUse, UserPromptSubmit, etc.
  //   waitingForInput → Notification(permission_prompt, elicitation_dialog),
  //                     PermissionRequest, PostToolUseFailure(interrupt)
  //   notRunning      → PTY reader thread sends NotRunning on EOF/exit
  //
  // Accepting ANY detector event when hooks are active creates a class of
  // false-positive bugs — terminal redraws, cursor chars, partial ANSI
  // sequences all produce spurious state flips. The detector exists solely
  // as a fallback for agents that lack hook support (Codex, Aider, etc.).
  return !hooksActive;
}

/**
 * Create a Tauri channel wired to pump PTY events into a ManagedSession
 * and the workspace store. Shared by getOrSpawn and spawnForExisting
 * so the callback logic lives in exactly one place.
 */
function createSessionChannel(
  sessionManager: SessionManager,
  session: ManagedSession,
  worktreeId: string,
): ReturnType<typeof createPtyChannel> {
  return createPtyChannel((event) => {
    switch (event.event) {
      case "output": {
        const bytes = stripClearScrollback(new Uint8Array(event.data));
        const wasFirst = session.lastOutputAt === 0;
        session.lastOutputAt = Date.now();
        if (wasFirst && session.onFirstOutput) {
          session.onFirstOutput();
          session.onFirstOutput = undefined;
        }
        sessionManager.scheduleWrite(session, bytes);
        sessionManager.appendToBuffer(session, bytes);
        break;
      }
      case "heartbeat": {
        session.lastHeartbeat = Date.now();
        break;
      }
      case "hookAgentState": {
        session.hooksActive = true;
        // Don't let a late "busy" hook (e.g. delayed PreToolUse) override
        // waitingForInput. The flag is cleared when the user provides input.
        if (event.data === "busy" && session.waitingForInput) {
          console.debug(`[status:${worktreeId}] hook "busy" BLOCKED (waitingForInput sticky flag)`);
          break;
        }
        console.debug(`[status:${worktreeId}] hook → ${event.data}${event.data === "waitingForInput" ? " (flag SET)" : session.waitingForInput ? " (flag CLEARED)" : ""}`);
        session.waitingForInput = event.data === "waitingForInput";
        session.agentState = event.data;
        useWorkspaceStore
          .getState()
          .updateWorktree(worktreeId, { agentStatus: event.data });
        break;
      }
      case "agentState": {
        if (!shouldAcceptDetectorState(session.hooksActive, event.data)) {
          console.debug(`[status:${worktreeId}] detector "${event.data}" REJECTED (hooks active)`);
          break;
        }
        if (event.data === "waitingForInput") {
          session.waitingForInput = true;
        } else if (event.data !== "busy") {
          session.waitingForInput = false;
        }
        console.debug(`[status:${worktreeId}] detector → ${event.data}${event.data === "waitingForInput" ? " (flag SET)" : ""}`);
        session.agentState = event.data;
        useWorkspaceStore
          .getState()
          .updateWorktree(worktreeId, { agentStatus: event.data });
        break;
      }
    }
  });
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
    mode: "claude" | "codex" | "gemini" | "shell" = "claude",
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
      agentState: mode === "shell" ? "notRunning" : "busy",
      hooksActive: false,
      outputBuffer: new Uint8Array(OUTPUT_BUFFER_CAPACITY),
      outputBufferPos: 0,
      outputBufferTotal: 0,
      lastHeartbeat: Date.now(),
      lastOutputAt: Date.now(),
      pendingOutput: [],
      writeScheduled: false,
      restoredFromScrollback: false,
      waitingForInput: false,
      startupCommandSent: false,
    };

    // Wire up the Tauri channel — this keeps pumping events regardless of UI.
    const channel = createSessionChannel(this, session, worktreeId);

    const agentType = AGENT_TYPE_MAP[mode] as AgentType | undefined;

    this.sessions.set(sessionKey, session);

    let sessionId: string;
    try {
      sessionId = await spawnPty(
        worktreeId,
        worktreePath,
        mode,
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

    // Push initial state for Claude sessions. The "busy" status clears
    // seenWorktrees in the store, so re-mark as seen to prevent the
    // upcoming busy→idle transition from triggering a false "finished"
    // notification — this is a boot, not task completion.
    if (mode === "claude") {
      useWorkspaceStore
        .getState()
        .updateWorktree(worktreeId, { agentStatus: session.agentState });
      useWorkspaceStore.getState().markWorktreeSeen(worktreeId);
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
      restoredFromScrollback: true,
      waitingForInput: false,
      startupCommandSent: false,
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
    mode: "claude" | "codex" | "gemini" | "shell" = "claude",
    args?: string[],
  ): Promise<ManagedSession> {
    const session = this.sessions.get(sessionKey);
    if (!session) throw new Error(`No session found for key: ${sessionKey}`);
    if (session.sessionId) return session; // Already spawned

    // Clear stale scrollback before spawning a fresh PTY so old session
    // content doesn't persist above the new prompt.
    session.terminal.clear();

    const channel = createSessionChannel(this, session, worktreeId);

    const agentType = AGENT_TYPE_MAP[mode] as AgentType | undefined;

    let sessionId: string;
    try {
      sessionId = await spawnPty(
        worktreeId,
        worktreePath,
        mode,
        args ?? [],
        channel,
        agentType,
      );
    } catch (e) {
      // Spawn failed — remove session so it doesn't get stuck as scrollback-only
      session.terminal.dispose();
      this.sessions.delete(sessionKey);
      throw e;
    }
    session.sessionId = sessionId;
    session.agentState = mode === "shell" ? "notRunning" : "busy";
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
    if (mode === "claude") {
      useWorkspaceStore
        .getState()
        .updateWorktree(worktreeId, { agentStatus: session.agentState });
      useWorkspaceStore.getState().markWorktreeSeen(worktreeId);
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

    // Reset session state so a subsequent spawnForExisting starts clean.
    // Without this, stale hooksActive=true would permanently reject detector
    // events, and a stuck waitingForInput flag would block busy hooks.
    session.hooksActive = false;
    session.waitingForInput = false;
    session.agentState = "notRunning";

    // Mirror closeSession's store update so the sidebar reflects "Not running"
    // and the notification hook's notRunning→busy filter suppresses the next spawn.
    useWorkspaceStore
      .getState()
      .updateWorktree(worktreeId, { agentStatus: "notRunning" });
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

if (import.meta.hot) {
  import.meta.hot.accept();
}

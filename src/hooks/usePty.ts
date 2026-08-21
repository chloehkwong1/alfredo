import { useEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import type { SearchAddon } from "@xterm/addon-search";
import type { AgentState, SessionType } from "../types";
import { writePty, resizePty, getWorktreeDiffStats, getPrFiles } from "../api";
import { sessionManager } from "../services/sessionManager";
import { registerSelectToCopy, ACTIVE_SCROLLBACK, BACKGROUND_SCROLLBACK } from "../services/terminalFactory";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { isTerminalPr } from "../lib/prStatus";
import type { ManagedSession } from "../services/sessionManager";

export const STALE_BUSY_MS = 60_000;

export function computeStaleBusy(
  agentStatus: AgentState,
  channelAlive: boolean,
  lastOutputAt: number,
  now: number,
): boolean {
  return channelAlive
    && agentStatus === "busy"
    && lastOutputAt > 0
    && now - lastOutputAt > STALE_BUSY_MS;
}

interface UsePtyOptions {
  /** Unique key for the session (typically a tab ID). */
  sessionKey: string;
  /** The worktree this session belongs to. */
  worktreeId: string;
  worktreePath: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** "claude" spawns Claude Code; "shell" spawns user's default shell. */
  mode?: "claude" | "codex" | "gemini" | "shell";
  /** CLI args to pass to the spawned process. Null means settings are still loading — defer spawn. */
  args?: string[] | null;
  /** Increment to force the hook to re-run and re-wire the session. */
  reconnectKey?: number;
  /** Session type hint passed to the Rust backend. */
  sessionType?: SessionType;
}

interface UsePtyReturn {
  terminal: Terminal | null;
  searchAddon: SearchAddon | null;
  agentState: AgentState;
  isConnected: boolean;
  channelAlive: boolean;
  /** True once the PTY session has produced at least one byte of output. */
  hasOutput: boolean;
  /**
   * Keystrokes typed before the agent produced its first output, echoed so
   * users aren't typing into a void while SessionStart hooks block the TUI.
   * Empty once `hasOutput` flips true.
   */
  pendingInput: string;
}

const PENDING_INPUT_MAX = 400;

/**
 * Thin attach/detach hook. The SessionManager owns the PTY session and xterm
 * Terminal instance — this hook just mounts/unmounts the terminal DOM element
 * into the provided container. Switching views no longer kills the PTY.
 */
export function usePty({
  sessionKey,
  worktreeId,
  worktreePath,
  containerRef,
  mode = "claude",
  args,
  reconnectKey,
  sessionType,
}: UsePtyOptions): UsePtyReturn {
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [searchAddon, setSearchAddon] = useState<SearchAddon | null>(null);
  const [agentState, setAgentState] = useState<AgentState>("notRunning");
  const [isConnected, setIsConnected] = useState(false);
  const [channelAlive, setChannelAlive] = useState(true);
  const [hasOutput, setHasOutput] = useState(false);
  const [pendingInput, setPendingInput] = useState("");
  const sessionRef = useRef<ManagedSession | null>(null);
  const hasOutputRef = useRef(false);
  hasOutputRef.current = hasOutput;

  // Use a ref for args so it doesn't trigger re-attach cycles.
  // Track whether args have resolved (null → array) so the effect re-fires.
  const argsResolved = args !== null;
  const argsRef = useRef(args);
  argsRef.current = args;

  useEffect(() => {
    // Wait for settings to resolve before spawning (args === null means still loading)
    if (args === null) return;
    if (!sessionKey || !worktreeId || !worktreePath || !containerRef.current) return;

    const container = containerRef.current;
    let disposed = false;
    let onDataDisposable: { dispose(): void } | null = null;
    let onResizeDisposable: { dispose(): void } | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

    // Reset state immediately so UI updates while we spin up the new session.
    setChannelAlive(true);
    setHasOutput(false);
    setPendingInput("");
    if (mode === "claude") {
      useWorkspaceStore.getState().updateWorktree(worktreeId, { channelAlive: true });
    }

    async function attach() {
      const session = await sessionManager.getOrSpawn(
        sessionKey, worktreeId, worktreePath, mode, undefined, argsRef.current ?? undefined, sessionType,
      );
      if (disposed) return;

      sessionRef.current = session;
      const { terminal: term, fitAddon } = session;

      // Attached terminals get deep scrollback; detach (cleanup below) trims
      // back to the background cap so tens of hidden tabs can't each hold a
      // saturated 10k-line buffer (~30 MB apiece) for days.
      term.options.scrollback = ACTIVE_SCROLLBACK;

      if (term.element) {
        container.appendChild(term.element);
        // Force a full redraw — canvas/WebGL content may be stale after DOM detach
        term.refresh(0, term.rows - 1);
      } else {
        term.open(container);
        registerSelectToCopy(term);
      }

      // Load WebGL renderer (needs terminal in DOM).
      // webglLoaded is reset on context loss (e.g. DOM detach) so we reload here.
      if (!session.webglLoaded) {
        session.webglLoaded = true;
        try {
          const webgl = new WebglAddon();
          webgl.onContextLoss(() => {
            const wasAtBottom = term.buffer.active.viewportY >= term.buffer.active.baseY;
            webgl.dispose();
            session.webglLoaded = false; // reload on next attach
            session.webglAddon = null;
            // Restore scroll position after fallback to canvas renderer —
            // without this the viewport can jump to earlier scrollback content.
            if (wasAtBottom) {
              term.scrollToBottom();
            } else {
              term.refresh(0, term.rows - 1);
            }
          });
          term.loadAddon(webgl);
          session.webglAddon = webgl;
        } catch {
          // WebGL unavailable — canvas renderer is fine
        }
      }

      // Wire up input/resize forwarding BEFORE fit() so the initial resize
      // event propagates to the backend PTY (which starts at 80×24).
      if (session.sessionId) {
        // Track the current input line to detect slash commands like /clear.
        let inputBuffer = "";

        onDataDisposable = term.onData((data: string) => {
          const bytes = Array.from(new TextEncoder().encode(data));
          writePty(session.sessionId, bytes).catch(console.error);

          // Enter submits / bare Esc cancels a parked AskUserQuestion — the only
          // ways to resolve it, and signals an auto-injected turn cannot fake.
          // Local-keystroke clear is the user-side self-heal for a lost
          // questionEnd hook; see applyAwaitingAnswer in sessionChannel.ts.
          // (Arrow keys arrive as multi-byte ESC sequences, not a bare \x1b.)
          if (session.awaitingAnswer && (data === "\r" || data === "\x1b")) {
            session.awaitingAnswer = false;
          }

          // Mirror typed keys into a preview buffer while the agent's TUI
          // hasn't initialized yet (e.g. SessionStart hooks are blocking).
          // The bytes are already in the kernel stdin buffer; this just makes
          // the typing visible so users don't think the app is frozen.
          if (!hasOutputRef.current) {
            if (data === "\r" || data === "\n") {
              setPendingInput((p) => (p + "\n").slice(-PENDING_INPUT_MAX));
            } else if (data === "\x7f") {
              setPendingInput((p) => p.slice(0, -1));
            } else if (data === "\x03" || data === "\x15") {
              setPendingInput("");
            } else if (data.length === 1 && data.charCodeAt(0) >= 0x20 && data.charCodeAt(0) <= 0x7e) {
              setPendingInput((p) => (p + data).slice(-PENDING_INPUT_MAX));
            }
          }

          // Buffer input to detect /clear command. Reset on Enter or Ctrl+C.
          // Only accumulate printable ASCII (0x20–0x7e) to avoid arrow keys,
          // function keys, and other escape sequences corrupting the buffer.
          if (data === "\r" || data === "\n") {
            if (inputBuffer === "/clear") {
              // Allow the next ESC[3J from the PTY through so xterm clears its
              // own scrollback natively (normally stripped to preserve history).
              session.allowNextClearScrollback = true;
              // Safety valve: reset flag if the PTY doesn't echo ESC[3J within
              // 5 s (e.g. /clear rejected because agent is busy).
              setTimeout(() => { session.allowNextClearScrollback = false; }, 5_000);
            }
            inputBuffer = "";
          } else if (data === "\x03" || data === "\x15") {
            // Ctrl+C or Ctrl+U resets the line
            inputBuffer = "";
          } else if (data === "\x7f") {
            // Backspace
            inputBuffer = inputBuffer.slice(0, -1);
          } else if (data.length === 1 && data.charCodeAt(0) >= 0x20 && data.charCodeAt(0) <= 0x7e) {
            // Printable ASCII only — ignore escape sequences (arrow keys, etc.)
            inputBuffer += data;
          }
        });

        onResizeDisposable = term.onResize(
          ({ rows, cols }: { rows: number; cols: number }) => {
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
              resizePty(session.sessionId, rows, cols).catch(console.error);
            }, 100);
          },
        );
      }

      try {
        fitAddon.fit();
      } catch {
        // Container might not be visible yet
      }

      resizeObserver = new ResizeObserver(() => {
        try {
          fitAddon.fit();
        } catch {
          // ignore
        }
      });
      resizeObserver.observe(container);

      // If the session already has output (re-attach), mark immediately.
      // Otherwise register a callback to fire on first output byte.
      if (session.lastOutputAt > 0) {
        setHasOutput(true);
        setPendingInput("");
      } else {
        session.onFirstOutput = () => {
          if (disposed) return;
          setHasOutput(true);
          setPendingInput("");
        };
      }

      setTerminal(term);
      setSearchAddon(session.searchAddon);
      setAgentState(session.agentState);
      setIsConnected(true);

      // Don't steal focus from any input the user is currently typing in —
      // including other xterm instances, whose input lives in a hidden textarea.
      const active = document.activeElement as HTMLElement | null;
      const typing = !!active && (
        active.tagName === "INPUT"
        || active.tagName === "TEXTAREA"
        || active.isContentEditable
      );
      if (!typing) {
        term.focus();
      }
    }

    attach().catch((err) => {
      console.error("[usePty] attach failed:", err);
      // Session failed to spawn — mark channel as dead so the user sees
      // the disconnect banner and can retry.
      if (!disposed) {
        setChannelAlive(false);
        if (mode === "claude") {
          useWorkspaceStore.getState().updateWorktree(worktreeId, { channelAlive: false });
        }
      }
    });

    // Poll agent state so the UI stays current while attached.
    // Only claude tabs should update the worktree's channelAlive and agentStatus —
    // shell/server tabs are independent processes that shouldn't affect agent state.

    let prevAgentState: AgentState | null = null;
    const stateInterval = setInterval(() => {
      const session = sessionRef.current;
      if (session) {
        const currentState = session.agentState;
        const now = Date.now();

        setAgentState(currentState);
        const alive = !session.sessionId || now - session.lastHeartbeat < 6000;
        setChannelAlive(alive);

        if (mode === "claude") {
          useWorkspaceStore.getState().updateWorktree(worktreeId, {
            channelAlive: alive,
          });

          // Refresh diff stats when agent finishes work (busy/waitingForInput → idle)
          if (currentState === "idle" && prevAgentState && prevAgentState !== "idle" && prevAgentState !== "notRunning") {
            const wt = useWorkspaceStore.getState().worktrees.find((w) => w.id === worktreeId);
            // A terminal PR's file stats can never change again — refreshing
            // would swap the badge to the LOCAL diff, which is ~+0/−0 once the
            // merge landed on main, zeroing a badge that honestly showed the
            // PR's size (and the headSha dedupe in useGithubSync would never
            // restore it). Keep whatever the badge already shows.
            if (wt?.prStatus && isTerminalPr(wt.prStatus)) {
              // no-op: stats frozen at the PR's final numbers
            } else if (wt?.prStatus?.number) {
              getPrFiles(wt.repoPath, wt.prStatus.number)
                .then((files) => {
                  const additions = files.reduce((sum, f) => sum + f.additions, 0);
                  const deletions = files.reduce((sum, f) => sum + f.deletions, 0);
                  useWorkspaceStore.getState().updateWorktree(worktreeId, { additions, deletions });
                })
                .catch((e) => console.warn('[pty] Failed to fetch PR diff stats:', e));
            } else {
              getWorktreeDiffStats(worktreePath, wt?.stackParent)
                .then(([additions, deletions]) => {
                  useWorkspaceStore.getState().updateWorktree(worktreeId, { additions, deletions });
                })
                .catch((e) => console.warn('[pty] Failed to fetch worktree diff stats:', e));
            }
          }
        }
        prevAgentState = currentState;
      }
    }, 500);

    return () => {
      disposed = true;
      clearInterval(stateInterval);
      onDataDisposable?.dispose();
      onResizeDisposable?.dispose();
      resizeObserver?.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);

      // Detach the terminal DOM element — do NOT close the PTY session.
      // Move the terminal element out of the container so xterm keeps its state.
      const session = sessionRef.current;
      if (session) session.onFirstOutput = undefined;
      if (session?.terminal.element && container.contains(session.terminal.element)) {
        container.removeChild(session.terminal.element);
      }
      // Trim scrollback to the background cap now that the terminal is
      // detached. Guarded: restart flows dispose the session before this
      // cleanup runs, and xterm throws on a disposed terminal.
      if (session && !session.disposed) {
        session.terminal.options.scrollback = BACKGROUND_SCROLLBACK;
      }

      sessionRef.current = null;
      setTerminal(null);
      setSearchAddon(null);
      setIsConnected(false);
    };
  }, [sessionKey, worktreeId, worktreePath, mode, containerRef, reconnectKey, argsResolved]);

  return { terminal, searchAddon, agentState, isConnected, channelAlive, hasOutput, pendingInput };
}

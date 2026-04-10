import { useEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import type { SearchAddon } from "@xterm/addon-search";
import type { AgentState } from "../types";
import { writePty, resizePty, getWorktreeDiffStats, getPrFiles } from "../api";
import { sessionManager } from "../services/sessionManager";
import { useWorkspaceStore } from "../stores/workspaceStore";
import type { ManagedSession } from "../services/sessionManager";

export const STALE_BUSY_MS = 120_000;

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
  /** Command to write to stdin after the shell spawns (used by server tabs). */
  startupCommand?: string;
}

interface UsePtyReturn {
  terminal: Terminal | null;
  searchAddon: SearchAddon | null;
  agentState: AgentState;
  isConnected: boolean;
  channelAlive: boolean;
  /** True once the PTY session has produced at least one byte of output. */
  hasOutput: boolean;
}

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
  startupCommand,
}: UsePtyOptions): UsePtyReturn {
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [searchAddon, setSearchAddon] = useState<SearchAddon | null>(null);
  const [agentState, setAgentState] = useState<AgentState>("notRunning");
  const [isConnected, setIsConnected] = useState(false);
  const [channelAlive, setChannelAlive] = useState(true);
  const [hasOutput, setHasOutput] = useState(false);
  const sessionRef = useRef<ManagedSession | null>(null);

  // Use refs for args and startupCommand so they don't trigger re-attach cycles.
  // Track whether args have resolved (null → array) so the effect re-fires.
  const argsResolved = args !== null;
  const argsRef = useRef(args);
  argsRef.current = args;
  const startupCommandRef = useRef(startupCommand);
  startupCommandRef.current = startupCommand;

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
    if (mode === "claude") {
      useWorkspaceStore.getState().updateWorktree(worktreeId, { channelAlive: true });
    }

    async function attach() {
      const session = await sessionManager.getOrSpawn(
        sessionKey, worktreeId, worktreePath, mode, undefined, argsRef.current ?? undefined,
      );
      if (disposed) return;

      sessionRef.current = session;
      const { terminal: term, fitAddon } = session;

      if (term.element) {
        container.appendChild(term.element);
        // Force a full redraw — canvas/WebGL content may be stale after DOM detach
        term.refresh(0, term.rows - 1);
      } else {
        term.open(container);
      }

      // Load WebGL renderer (needs terminal in DOM).
      // webglLoaded is reset on context loss (e.g. DOM detach) so we reload here.
      if (!session.webglLoaded) {
        session.webglLoaded = true;
        try {
          const webgl = new WebglAddon();
          webgl.onContextLoss(() => {
            webgl.dispose();
            session.webglLoaded = false; // reload on next attach
          });
          term.loadAddon(webgl);
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
      } else {
        session.onFirstOutput = () => { if (!disposed) setHasOutput(true); };
      }

      setTerminal(term);
      setSearchAddon(session.searchAddon);
      setAgentState(session.agentState);
      setIsConnected(true);

      // Write startup command after shell produces its first output (prompt ready).
      // Guard with startupCommandSent to prevent StrictMode double-fire.
      if (startupCommandRef.current && session.sessionId && !session.startupCommandSent) {
        session.startupCommandSent = true;
        let startupAttempts = 0;
        const waitForReady = setInterval(() => {
          startupAttempts++;
          const s = sessionRef.current;
          if (s && s.lastOutputAt > 0) {
            clearInterval(waitForReady);
            const cmd = startupCommandRef.current + "\n";
            const bytes = Array.from(new TextEncoder().encode(cmd));
            writePty(s.sessionId, bytes).catch(console.error);
          } else if (startupAttempts >= 50) {
            clearInterval(waitForReady);
            console.warn("[usePty] shell never produced output, skipping startup command");
          }
        }, 100);
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
        setAgentState(currentState);
        const alive = !session.sessionId || Date.now() - session.lastHeartbeat < 6000;
        setChannelAlive(alive);

        // Detect stale busy: process alive but no output for STALE_BUSY_MS
        const staleBusy = computeStaleBusy(currentState, alive, session.lastOutputAt, Date.now());

        if (mode === "claude") {
          // Self-heal: if the store is stuck at "notRunning" but the session
          // reports a live state, push the session's state to the store.
          // This recovers from stale channel callbacks (e.g. after Vite HMR).
          // Only reconcile notRunning → live to avoid clearing seenWorktrees
          // or triggering false notifications on normal transitions.
          const storeStatus = useWorkspaceStore.getState().worktrees.find((w) => w.id === worktreeId)?.agentStatus;
          if (storeStatus === "notRunning" && currentState !== "notRunning") {
            useWorkspaceStore.getState().updateWorktree(worktreeId, { agentStatus: currentState });
          }
          useWorkspaceStore.getState().updateWorktree(worktreeId, {
            channelAlive: alive,
            staleBusy,
          });

          // Refresh diff stats when agent finishes work (busy/waitingForInput → idle)
          if (currentState === "idle" && prevAgentState && prevAgentState !== "idle" && prevAgentState !== "notRunning") {
            const wt = useWorkspaceStore.getState().worktrees.find((w) => w.id === worktreeId);
            if (wt?.prStatus?.number) {
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

      // Clear staleBusy when the interval stops. Without this, a staleBusy=true
      // value set during a thinking phase freezes in the store after tab switch,
      // causing the sidebar to show "Unresponsive" even when output has resumed.
      // The value is recomputed correctly within 500ms when this tab is re-opened.
      if (mode === "claude") {
        useWorkspaceStore.getState().updateWorktree(worktreeId, { staleBusy: false });
      }

      // Detach the terminal DOM element — do NOT close the PTY session.
      // Move the terminal element out of the container so xterm keeps its state.
      const session = sessionRef.current;
      if (session) session.onFirstOutput = undefined;
      if (session?.terminal.element && container.contains(session.terminal.element)) {
        container.removeChild(session.terminal.element);
      }

      sessionRef.current = null;
      setTerminal(null);
      setSearchAddon(null);
      setIsConnected(false);
    };
  }, [sessionKey, worktreeId, worktreePath, mode, containerRef, reconnectKey, argsResolved]);

  return { terminal, searchAddon, agentState, isConnected, channelAlive, hasOutput };
}

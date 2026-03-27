import { useEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import type { SearchAddon } from "@xterm/addon-search";
import type { AgentState } from "../types";
import { writePty, resizePty } from "../api";
import { sessionManager } from "../services/sessionManager";
import { useWorkspaceStore } from "../stores/workspaceStore";
import type { ManagedSession } from "../services/sessionManager";

interface UsePtyOptions {
  /** Unique key for the session (typically a tab ID). */
  sessionKey: string;
  /** The worktree this session belongs to. */
  worktreeId: string;
  worktreePath: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** "claude" spawns Claude Code; "shell" spawns user's default shell. */
  mode?: "claude" | "shell";
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

    // Reset channelAlive immediately so the disconnect banner disappears
    // while we spin up the new session. Only claude tabs should update the
    // worktree's channelAlive — shell/server tabs are independent processes.
    setChannelAlive(true);
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
      } else {
        term.open(container);
      }

      // Load WebGL renderer once (needs terminal in DOM)
      if (!session.webglLoaded) {
        session.webglLoaded = true;
        try {
          const webgl = new WebglAddon();
          webgl.onContextLoss(() => webgl.dispose());
          term.loadAddon(webgl);
        } catch {
          // WebGL unavailable — canvas renderer is fine
        }
      }

      // Wire up input/resize forwarding BEFORE fit() so the initial resize
      // event propagates to the backend PTY (which starts at 80×24).
      if (session.sessionId) {
        onDataDisposable = term.onData((data: string) => {
          const bytes = Array.from(new TextEncoder().encode(data));
          writePty(session.sessionId, bytes).catch(console.error);
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

      setTerminal(term);
      setSearchAddon(session.searchAddon);
      setAgentState(session.agentState);
      setIsConnected(true);

      // Write startup command to stdin after a brief delay for shell init
      if (startupCommandRef.current && session.sessionId) {
        setTimeout(() => {
          const cmd = startupCommandRef.current + "\n";
          const bytes = Array.from(new TextEncoder().encode(cmd));
          writePty(session.sessionId, bytes).catch(console.error);
        }, 500);
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
    // If busy with no output for this long, mark as stale/unresponsive.
    const STALE_BUSY_MS = 30_000;

    const stateInterval = setInterval(() => {
      const session = sessionRef.current;
      if (session) {
        setAgentState(session.agentState);
        const alive = !session.sessionId || Date.now() - session.lastHeartbeat < 6000;
        setChannelAlive(alive);

        // Detect stale busy: process alive but no output for STALE_BUSY_MS
        const staleBusy = alive && session.agentState === "busy"
          && session.lastOutputAt > 0
          && Date.now() - session.lastOutputAt > STALE_BUSY_MS;

        if (mode === "claude") {
          useWorkspaceStore.getState().updateWorktree(worktreeId, {
            channelAlive: alive,
            staleBusy,
          });
        }
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
      if (session?.terminal.element && container.contains(session.terminal.element)) {
        container.removeChild(session.terminal.element);
      }

      sessionRef.current = null;
      setTerminal(null);
      setSearchAddon(null);
      setIsConnected(false);
    };
  }, [sessionKey, worktreeId, worktreePath, mode, containerRef, reconnectKey, argsResolved]);

  return { terminal, searchAddon, agentState, isConnected, channelAlive };
}

import { useEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import type { AgentState } from "../types";
import { writePty, resizePty } from "../api";
import { sessionManager } from "../services/sessionManager";
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
  /** Base64-encoded saved terminal output to replay before spawning the PTY. */
  initialScrollback?: string;
  /** CLI args to pass to the spawned process. */
  args?: string[];
  /** If true, load scrollback but don't spawn a PTY process. */
  disconnected?: boolean;
  /** Increment to force the hook to re-run and re-wire the session. */
  reconnectKey?: number;
}

interface UsePtyReturn {
  terminal: Terminal | null;
  agentState: AgentState;
  isConnected: boolean;
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
  initialScrollback,
  args,
  disconnected = false,
  reconnectKey,
}: UsePtyOptions): UsePtyReturn {
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [agentState, setAgentState] = useState<AgentState>("notRunning");
  const [isConnected, setIsConnected] = useState(false);
  const sessionRef = useRef<ManagedSession | null>(null);

  // Use refs for values that should NOT trigger re-attach cycles.
  // Scrollback and args are only used when spawning a new session;
  // getOrSpawn returns existing sessions without re-reading these.
  const scrollbackRef = useRef(initialScrollback);
  scrollbackRef.current = initialScrollback;
  const argsRef = useRef(args);
  argsRef.current = args;

  useEffect(() => {
    if (!sessionKey || !worktreeId || !worktreePath || !containerRef.current) return;

    const container = containerRef.current;
    let disposed = false;
    let onDataDisposable: { dispose(): void } | null = null;
    let onResizeDisposable: { dispose(): void } | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

    async function attach() {
      let session: ManagedSession;

      if (disconnected) {
        // Load scrollback without spawning — user will choose resume/fresh
        session = sessionManager.loadScrollbackOnly(sessionKey, scrollbackRef.current);
      } else {
        session = await sessionManager.getOrSpawn(
          sessionKey, worktreeId, worktreePath, mode, scrollbackRef.current, argsRef.current,
        );
      }
      if (disposed) return;

      sessionRef.current = session;
      const { terminal: term, fitAddon } = session;

      if (term.element) {
        container.appendChild(term.element);
      } else {
        term.open(container);
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
      setAgentState(session.agentState);
      setIsConnected(!disconnected);
    }

    attach().catch(console.error);

    // Poll agent state so the UI stays current while attached
    const stateInterval = setInterval(() => {
      const session = sessionRef.current;
      if (session) {
        setAgentState(session.agentState);
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
      setIsConnected(false);
    };
  }, [sessionKey, worktreeId, worktreePath, mode, containerRef, disconnected, reconnectKey]);

  return { terminal, agentState, isConnected };
}

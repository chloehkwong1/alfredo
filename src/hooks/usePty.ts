import { useEffect, useRef, useCallback } from "react";
import type { Terminal } from "@xterm/xterm";
import type { AgentState, PtyEvent } from "../types";
import { createPtyChannel, spawnPty, writePty, resizePty, closePty } from "../api";

interface UsePtyOptions {
  worktreePath: string;
  terminal: Terminal | null;
  onAgentStateChange?: (state: AgentState) => void;
}

interface UsePtyReturn {
  isConnected: boolean;
  disconnect: () => void;
}

export function usePty({
  worktreePath,
  terminal,
  onAgentStateChange,
}: UsePtyOptions): UsePtyReturn {
  const sessionIdRef = useRef<string | null>(null);
  const isConnectedRef = useRef(false);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disconnect = useCallback(() => {
    if (sessionIdRef.current) {
      closePty(sessionIdRef.current).catch(console.error);
      sessionIdRef.current = null;
      isConnectedRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!terminal || !worktreePath) return;

    let disposed = false;

    const channel = createPtyChannel((event: PtyEvent) => {
      if (disposed) return;
      if (event.event === "output") {
        terminal.write(new Uint8Array(event.data));
      } else if (event.event === "agentState") {
        onAgentStateChange?.(event.data);
      }
    });

    spawnPty(worktreePath, "/bin/zsh", [], channel)
      .then((id) => {
        if (disposed) {
          closePty(id).catch(console.error);
          return;
        }
        sessionIdRef.current = id;
        isConnectedRef.current = true;
      })
      .catch(console.error);

    // Forward user input to PTY
    const onDataDisposable = terminal.onData((data: string) => {
      if (!sessionIdRef.current) return;
      const bytes = Array.from(new TextEncoder().encode(data));
      writePty(sessionIdRef.current, bytes).catch(console.error);
    });

    // Debounced resize
    const onResizeDisposable = terminal.onResize(
      ({ rows, cols }: { rows: number; cols: number }) => {
        if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = setTimeout(() => {
          if (!sessionIdRef.current) return;
          resizePty(sessionIdRef.current, rows, cols).catch(console.error);
        }, 100);
      },
    );

    return () => {
      disposed = true;
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      if (sessionIdRef.current) {
        closePty(sessionIdRef.current).catch(console.error);
        sessionIdRef.current = null;
        isConnectedRef.current = false;
      }
    };
  }, [terminal, worktreePath, onAgentStateChange]);

  return {
    isConnected: isConnectedRef.current,
    disconnect,
  };
}

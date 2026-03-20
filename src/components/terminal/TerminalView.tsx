import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

import { TerminalHeader } from "./TerminalHeader";
import { usePty } from "../../hooks/usePty";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { AgentState } from "../../types";

// Terminal theme matching the warm dark palette from theme.css
const TERMINAL_THEME = {
  background: "#1a1918",
  foreground: "#f5f2ef",
  cursor: "#f5f2ef",
  cursorAccent: "#1a1918",
  selectionBackground: "#3d3a3780",
  selectionForeground: "#f5f2ef",
  black: "#1a1918",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#fbbf24",
  blue: "#60a5fa",
  magenta: "#9333ea",
  cyan: "#22d3ee",
  white: "#f5f2ef",
  brightBlack: "#78716c",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde047",
  brightBlue: "#93c5fd",
  brightMagenta: "#a855f7",
  brightCyan: "#67e8f9",
  brightWhite: "#ffffff",
};

function TerminalView() {
  const activeWorktreeId = useWorkspaceStore((s) => s.activeWorktreeId);
  const worktree = useWorkspaceStore((s) =>
    s.worktrees.find((wt) => wt.id === activeWorktreeId),
  );
  const setView = useWorkspaceStore((s) => s.setView);
  const setActiveWorktree = useWorkspaceStore((s) => s.setActiveWorktree);
  const updateWorktree = useWorkspaceStore((s) => s.updateWorktree);

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [agentState, setAgentState] = useState<AgentState>(
    worktree?.agentStatus ?? "notRunning",
  );

  const handleAgentStateChange = useCallback((state: AgentState) => {
    setAgentState(state);
    // Also update the workspace store so kanban cards reflect live state
    if (activeWorktreeId) {
      updateWorktree(activeWorktreeId, { agentStatus: state });
    }
  }, [activeWorktreeId, updateWorktree]);

  usePty({
    worktreePath: worktree?.path ?? "",
    terminal,
    onAgentStateChange: handleAgentStateChange,
  });

  // Initialize xterm.js
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: TERMINAL_THEME,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: "bar",
      allowTransparency: false,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(containerRef.current);

    // Try loading WebGL addon, fall back gracefully
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      term.loadAddon(webglAddon);
    } catch {
      // WebGL not available — software renderer is fine
    }

    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;
    setTerminal(term);

    // Resize on window resize
    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      setTerminal(null);
    };
  }, []);

  function handleBack() {
    setActiveWorktree(null);
    setView("board");
  }

  if (!worktree) return null;

  return (
    <div className="flex flex-col h-screen bg-bg-primary">
      <TerminalHeader
        branch={worktree.branch}
        agentState={agentState}
        onBack={handleBack}
      />
      <div ref={containerRef} className="flex-1 min-h-0 p-1" />
    </div>
  );
}

export { TerminalView };

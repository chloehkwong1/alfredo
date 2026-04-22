import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, MessageSquare, Send, Trash2 } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "@xterm/xterm/css/xterm.css";

import { usePty } from "../../hooks/usePty";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useTabStore } from "../../stores/tabStore";
import { sessionManager } from "../../services/sessionManager";
import { setResumeSessionId } from "../../services/resumeLabel";
import { writePty, getConfig, getAppConfig, findClaudeSession } from "../../api";
import { formatAnnotationsMessage } from "../../services/formatAnnotationsMessage";
import { useAppConfig } from "../../hooks/useAppConfig";
import { Button } from "../ui/Button";
import { CatLogo } from "../ui/CatLogo";
import { SettingsStatusBar } from "./SettingsStatusBar";
import { TerminalSearchBar } from "./TerminalSearchBar";
import { TerminalLoadingScreen } from "./TerminalLoadingScreen";
import {
  resolveSettings,
  buildClaudeArgs,
} from "../../services/claudeSettingsResolver";
import { getAgentSessionInfo } from "../../services/agentMessenger";
import type { Annotation, SessionType, TabType } from "../../types";

function tabTypeToPtyMode(tabType: TabType): { mode: "claude" | "codex" | "gemini" | "shell"; sessionType: SessionType } {
  switch (tabType) {
    case "claude": return { mode: "claude", sessionType: "agent" };
    case "codex": return { mode: "codex", sessionType: "agent" };
    case "gemini": return { mode: "gemini", sessionType: "agent" };
    case "server": return { mode: "shell", sessionType: "server" };
    case "shell":
    default: return { mode: "shell", sessionType: "shell" };
  }
}

interface TerminalViewProps {
  /** The tab ID, used as the session key. */
  tabId?: string;
  /** The tab type — determines whether to spawn Claude or a shell. */
  tabType?: TabType;
}

function TerminalView({ tabId, tabType = "claude" }: TerminalViewProps) {
  const activeWorktreeId = useWorkspaceStore((s) => s.activeWorktreeId);
  const worktree = useWorkspaceStore((s) =>
    s.worktrees.find((wt) => wt.id === activeWorktreeId),
  );
  const markWorktreeSeen = useWorkspaceStore((s) => s.markWorktreeSeen);
  const isSeen = useWorkspaceStore((s) =>
    activeWorktreeId ? s.seenWorktrees.has(activeWorktreeId) : false,
  );
  const annotations: Annotation[] =
    useWorkspaceStore((s) =>
      activeWorktreeId ? s.annotations[activeWorktreeId] : undefined,
    ) ?? [];
  const clearAnnotations = useWorkspaceStore((s) => s.clearAnnotations);

  const containerRef = useRef<HTMLDivElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const sessionKey = tabId ?? activeWorktreeId ?? "";
  const { mode, sessionType } = tabTypeToPtyMode(tabType ?? "claude");
  const [isDragOver, setIsDragOver] = useState(false);

  // Read the tab's command field (used by server tabs to auto-execute a command)
  const tabCommand = useTabStore((s) => {
    if (!activeWorktreeId || !tabId) return undefined;
    const tabs = s.tabs[activeWorktreeId] ?? [];
    return tabs.find((t) => t.id === tabId)?.command;
  });

  const { activeRepo: repoPath, repos, selectedRepos } = useAppConfig();
  const effectiveSelected = selectedRepos.length > 0 ? selectedRepos : (repoPath ? [repoPath] : []);
  const hasWorktreeRepos = repos.some((r) => effectiveSelected.includes(r.path) && r.mode === "worktree");

  const [reconnectKey, setReconnectKey] = useState(0);

  // Track whether the initial spawn has happened — restarts should NOT auto-resume
  const hasSpawnedRef = useRef(false);

  // Read resumeSessionId from the tab — only set on tabs restored from a saved
  // session, so new tabs created via Cmd+T won't auto-resume.
  const claudeSessionId = useTabStore((s) => {
    if (!activeWorktreeId || !tabId) return undefined;
    const tabs = s.tabs[activeWorktreeId] ?? [];
    return tabs.find((t) => t.id === tabId)?.resumeSessionId;
  });

  const [resolvedArgs, setResolvedArgs] = useState<string[] | null>(null);

  // Resolve settings when component mounts — must complete before PTY spawns.
  // Uses an aborted flag so stale .then() callbacks from superseded effect
  // runs can't set hasSpawnedRef before the current run sees claudeSessionId.
  useEffect(() => {
    if (mode !== "claude") {
      setResolvedArgs([]);
      return;
    }
    if (!repoPath) return;
    let aborted = false;
    Promise.all([getAppConfig(), getConfig(repoPath)]).then(([appCfg, config]) => {
      if (aborted) return;
      const branch = worktree?.branch ?? "";
      const resolved = resolveSettings(
        appCfg,
        config.claudeDefaults,
        config.worktreeOverrides?.[branch],
      );
      const args = buildClaudeArgs(resolved);
      // Append --resume for the initial spawn if we have a saved session ID
      if (!hasSpawnedRef.current && claudeSessionId) {
        args.push("--resume", claudeSessionId);
      }
      hasSpawnedRef.current = true;
      setResolvedArgs(args);
    }).catch(() => {
      if (aborted) return;
      hasSpawnedRef.current = true;
      setResolvedArgs([]);
    });
    return () => { aborted = true; };
  }, [repoPath, worktree?.branch, mode, claudeSessionId]);

  const [showSearch, setShowSearch] = useState(false);

  const isAgentTab = mode !== "shell";

  const { terminal: ptyTerminal, channelAlive, isConnected, searchAddon, hasOutput, pendingInput } = usePty({
    sessionKey,
    worktreeId: activeWorktreeId ?? "",
    worktreePath: worktree?.path ?? "",
    containerRef,
    mode,
    args: resolvedArgs,
    reconnectKey,
    startupCommand: tabCommand,
    sessionType,
  });

  // Discover and keep the Claude session ID in sync with the filesystem.
  // Runs once on first output, then periodically to catch mid-session changes
  // (e.g. /clear creating a new session). Updates resumeSessionId so the
  // correct session is persisted and resumed on the next app restart.
  const hasDiscoveredSession = useRef(false);
  useEffect(() => {
    if (!hasOutput || !isAgentTab) return;
    if (!activeWorktreeId || !worktree?.path) return;

    const discover = () => {
      findClaudeSession(worktree.path).then((fsSessionId) => {
        if (!fsSessionId || !activeWorktreeId || !tabId) return;

        const tabs = useTabStore.getState().tabs[activeWorktreeId] ?? [];
        const ourCurrent = tabs.find((t) => t.id === tabId)?.resumeSessionId;

        // Same-session poll: re-fetch summary in case Claude hadn't
        // written last-prompt yet on a prior poll. The helper skips the
        // write when it would clobber an existing summary with a null.
        if (fsSessionId === ourCurrent) {
          setResumeSessionId(activeWorktreeId, tabId, fsSessionId, worktree.path);
          return;
        }

        // Different UUID from ours. `findClaudeSession` returns the single
        // most-recent JSONL in the project dir, which in multi-tab worktrees
        // is whichever sibling tab was touched last — not this tab's session.
        // Skip adoption when a sibling tab already owns the discovered UUID.
        const ownedBySibling = tabs.some(
          (t) => t.id !== tabId && t.resumeSessionId === fsSessionId,
        );
        if (ownedBySibling) return;

        setResumeSessionId(activeWorktreeId, tabId, fsSessionId, worktree.path);
      }).catch((e) => {
        console.warn(`[TerminalView] Failed to discover Claude session for ${worktree.path}:`, e);
      });
    };

    // Initial discovery on first output
    if (!hasDiscoveredSession.current) {
      hasDiscoveredSession.current = true;
      discover();
    }

    // Re-discover every 5s to catch session changes (e.g. /clear creating a
    // new session UUID) and to retry the summary fetch if Claude hadn't
    // written a last-prompt by the previous poll.
    const interval = setInterval(discover, 5_000);
    return () => clearInterval(interval);
  }, [hasOutput, isAgentTab, activeWorktreeId, worktree?.path, tabId]);

  const handleSendFeedback = useCallback(async () => {
    if (!activeWorktreeId || annotations.length === 0) return;

    const { sessionKey: targetKey } = getAgentSessionInfo(activeWorktreeId);
    const session = sessionManager.getSession(targetKey);
    if (!session) return;

    const message = formatAnnotationsMessage(annotations);
    const bytes = Array.from(new TextEncoder().encode(message));
    await writePty(session.sessionId, bytes);
    clearAnnotations(activeWorktreeId);
  }, [activeWorktreeId, annotations, clearAnnotations]);

  const handleClearAnnotations = useCallback(() => {
    if (activeWorktreeId) {
      clearAnnotations(activeWorktreeId);
    }
  }, [activeWorktreeId, clearAnnotations]);

  const handleRestartSession = useCallback(async () => {
    if (!tabId || !activeWorktreeId || !worktree || !repoPath) return;

    // Resolve new args BEFORE closing the old session so a config error
    // doesn't leave the session dead with no reconnect trigger.
    try {
      const [appCfg, config] = await Promise.all([getAppConfig(), getConfig(repoPath)]);
      const branch = worktree.branch ?? "";
      const resolved = resolveSettings(
        appCfg,
        config.claudeDefaults,
        config.worktreeOverrides?.[branch],
      );
      setResolvedArgs(buildClaudeArgs(resolved));
    } catch {
      // Config fetch failed — keep current args and still restart.
    }

    // Clear the stale resumeSessionId so the discovery effect can find the
    // new session that the fresh Claude instance will create.
    hasDiscoveredSession.current = false;
    if (worktree?.path) {
      setResumeSessionId(activeWorktreeId, tabId, undefined, worktree.path);
    } else {
      useTabStore.getState().updateTab(activeWorktreeId, tabId, { resumeSessionId: undefined });
    }

    await sessionManager.closeSession(sessionKey);
    setReconnectKey((k) => k + 1);
  }, [tabId, activeWorktreeId, worktree, sessionKey, repoPath]);

  // Focus terminal when programmatically switched to (e.g. "Fix with agent")
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.tabId === tabId && ptyTerminal) {
        ptyTerminal.focus();
      }
    };
    window.addEventListener("focus-terminal", handler);
    return () => window.removeEventListener("focus-terminal", handler);
  }, [tabId, ptyTerminal]);

  // Cmd+F to toggle terminal search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        // Only handle if our terminal container has focus
        if (containerRef.current?.contains(document.activeElement) || showSearch) {
          e.preventDefault();
          setShowSearch((s) => !s);
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showSearch]);

  // Track whether the terminal is scrolled away from the bottom.
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  useEffect(() => {
    if (!ptyTerminal) return;
    const checkScroll = () => {
      const buf = ptyTerminal.buffer.active;
      setShowScrollToBottom(buf.viewportY < buf.baseY);
    };
    const onScroll = ptyTerminal.onScroll(checkScroll);
    const onWriteParsed = ptyTerminal.onWriteParsed(checkScroll);
    return () => { onScroll.dispose(); onWriteParsed.dispose(); };
  }, [ptyTerminal]);

  const handleScrollToBottom = useCallback(() => {
    ptyTerminal?.scrollToBottom();
    setShowScrollToBottom(false);
  }, [ptyTerminal]);

  // Track window focus so we only mark worktrees as "seen" when the user is
  // actually looking at Alfredo — not when the app is behind another window.
  const [windowFocused, setWindowFocused] = useState(true);
  useEffect(() => {
    getCurrentWindow().isFocused().then(setWindowFocused);
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      setWindowFocused(focused);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Mark as seen when user is viewing a terminal that's idle or waiting.
  // Uses worktree.agentStatus from the store (not usePty's polled agentState)
  // so it updates atomically with seenWorktrees — avoiding a race where the
  // stale polled state re-marks the worktree as seen immediately after clearing.
  const storeAgentStatus = worktree?.agentStatus;
  useEffect(() => {
    if (
      activeWorktreeId &&
      !isSeen &&
      windowFocused &&
      (storeAgentStatus === "idle" || storeAgentStatus === "waitingForInput")
    ) {
      markWorktreeSeen(activeWorktreeId);
    }
  }, [activeWorktreeId, storeAgentStatus, isSeen, windowFocused, markWorktreeSeen]);

  // File drag-and-drop: listen for Tauri's webview drag-drop events and write
  // shell-escaped file paths to the PTY when files are dropped on the terminal.
  useEffect(() => {
    const unlisten = getCurrentWebviewWindow().onDragDropEvent((event) => {
      const dropZone = dropZoneRef.current;
      if (!dropZone) return;

      const rect = dropZone.getBoundingClientRect();
      const { type } = event.payload;

      if (type === "over") {
        const pos = event.payload.position;
        const inside =
          pos.x >= rect.left && pos.x <= rect.right &&
          pos.y >= rect.top && pos.y <= rect.bottom;
        setIsDragOver(inside);
      } else if (type === "leave") {
        setIsDragOver(false);
      } else if (type === "drop") {
        setIsDragOver(false);
        const pos = event.payload.position;
        const inside =
          pos.x >= rect.left && pos.x <= rect.right &&
          pos.y >= rect.top && pos.y <= rect.bottom;
        if (!inside) return;

        const paths = event.payload.paths;
        if (paths.length === 0) return;

        // Shell-escape each path (always single-quote to handle all metacharacters)
        const escaped = paths
          .map((p: string) => `'${p.replace(/'/g, "'\\''")}'`)
          .join(" ");

        const session = sessionManager.getSession(sessionKey);
        if (session?.sessionId) {
          const bytes = Array.from(new TextEncoder().encode(escaped));
          writePty(session.sessionId, bytes).catch(console.error);
        }
      }
    });

    return () => { unlisten.then((fn) => fn()); };
  }, [sessionKey]);

  if (!activeWorktreeId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-tertiary gap-3">
        <CatLogo aria-hidden className="w-16 h-16 opacity-[0.15] select-none pointer-events-none text-white" />
        <span className="text-sm">
          {hasWorktreeRepos === false
            ? "Select a repo to get started"
            : "Select a worktree to get started"}
        </span>
      </div>
    );
  }

  if (!worktree) {
    return (
      <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
        Starting session...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-bg-primary overflow-hidden">
      {annotations.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-1.5 bg-accent-primary/8 border-b border-accent-primary/20 flex-shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-accent-primary font-medium">
            <MessageSquare size={14} />
            <span>
              {annotations.length}{" "}
              {annotations.length === 1 ? "annotation" : "annotations"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <Button
              size="sm"
              variant="primary"
              onClick={handleSendFeedback}
            >
              <Send size={12} />
              Send as feedback
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleClearAnnotations}
            >
              <Trash2 size={12} />
              Clear
            </Button>
          </div>
        </div>
      )}
      <div ref={dropZoneRef} className="relative flex-1 min-h-0">
        {!channelAlive && (
          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-3 py-2 bg-bg-secondary/90 border-b border-border-default">
            <span className="text-xs text-text-secondary">
              {isConnected ? "Terminal disconnected" : "Failed to start session"}
            </span>
            <Button size="sm" variant="secondary" onClick={handleRestartSession}>
              {isConnected ? "Restart session" : "Retry"}
            </Button>
          </div>
        )}
        {showSearch && searchAddon && (
          <TerminalSearchBar
            searchAddon={searchAddon}
            onClose={() => setShowSearch(false)}
          />
        )}
        {isAgentTab && (
          <TerminalLoadingScreen
            tabType={tabType}
            visible={!hasOutput}
            typedPreview={pendingInput}
          />
        )}
        <div
          ref={containerRef}
          data-tour-id="agent-terminal"
          className="h-full pl-1 pr-0.5"
          onClick={() => ptyTerminal?.focus()}
        />
        {showScrollToBottom && (
          <button
            onClick={handleScrollToBottom}
            className="absolute bottom-4 right-5 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-bg-elevated border border-border-default rounded-full shadow-md hover:border-border-hover hover:bg-bg-hover transition-all duration-[var(--transition-fast)] cursor-pointer"
          >
            <ChevronDown size={14} className="text-text-secondary" />
            <span className="text-xs font-medium text-text-secondary">Scroll to bottom</span>
          </button>
        )}
        {isDragOver && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-accent-primary/10 border-2 border-dashed border-accent-primary/40 rounded pointer-events-none">
            <span className="text-sm text-accent-primary font-medium px-3 py-1.5 bg-bg-primary/80 rounded">
              Drop to paste file path
            </span>
          </div>
        )}
      </div>
      {worktree && (
        <SettingsStatusBar
          branch={worktree.branch ?? ""}
          worktreePath={worktree.path ?? ""}
          worktreeId={activeWorktreeId ?? ""}
          sessionKey={sessionKey}
          onRestartSession={handleRestartSession}
          showClaudeSettings={mode === "claude"}
          assignedPort={worktree.assignedPort}
        />
      )}
    </div>
  );
}

export { TerminalView };

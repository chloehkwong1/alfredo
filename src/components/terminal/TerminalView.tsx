import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, MessageSquare, Send, Trash2 } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { SerializeAddon } from "@xterm/addon-serialize";
import "@xterm/xterm/css/xterm.css";

import { usePty } from "../../hooks/usePty";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useTabStore } from "../../stores/tabStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { sessionManager } from "../../services/sessionManager";
import { writePty, getConfig, getAppConfig, findClaudeSession, listClaudeSessions, recordResumeSessionId, debugLog, dumpPtyBuffer } from "../../api";
import { formatAnnotationsMessage } from "../../services/formatAnnotationsMessage";
import { useAppConfig } from "../../hooks/useAppConfig";
import { useToastStore } from "../../stores/toastStore";
import { Button } from "../ui/Button";
import { CatLogo } from "../ui/CatLogo";
import { TerminalSearchBar } from "./TerminalSearchBar";
import { TerminalLoadingScreen } from "./TerminalLoadingScreen";
import {
  resolveSettings,
  buildClaudeArgs,
  withResumeSession,
} from "../../services/claudeSettingsResolver";
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

const SETTINGS_LOAD_ERROR_MSG = "Couldn't load Claude settings — launching with defaults.";

/**
 * Load both configs via allSettled, log + toast on any rejection (deduped),
 * then resolve and build Claude launch args from whatever succeeded.
 * Never throws — on total failure returns args built from all-null config.
 */
async function resolveLaunchArgs(repoPath: string): Promise<string[]> {
  const [appRes, cfgRes] = await Promise.allSettled([getAppConfig(), getConfig(repoPath)]);
  if (appRes.status === "rejected" || cfgRes.status === "rejected") {
    console.error(
      `[TerminalView] settings resolution failed for ${repoPath}:`,
      [appRes, cfgRes].filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason),
    );
    const { toasts, show } = useToastStore.getState();
    if (!toasts.some((t) => t.message === SETTINGS_LOAD_ERROR_MSG)) {
      show({ message: SETTINGS_LOAD_ERROR_MSG });
    }
  }
  const appCfg = appRes.status === "fulfilled" ? appRes.value : null;
  const config = cfgRes.status === "fulfilled" ? cfgRes.value : null;
  const resolved = resolveSettings(appCfg, config?.claudeDefaults);
  return buildClaudeArgs(resolved);
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

  // This terminal is "active" when it's the active tab of the active pane in
  // the active worktree — the one the user is actually looking at. Only the
  // active terminal should grab keyboard focus on a worktree switch or window
  // refocus (see the focus effect below).
  const isActiveTerminal = useLayoutStore((s) => {
    if (!activeWorktreeId || !tabId) return false;
    const paneId = s.activePaneId[activeWorktreeId];
    if (!paneId) return false;
    return s.getPane(activeWorktreeId, paneId)?.activeTabId === tabId;
  });

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
      // Server tabs carry a run command — spawn it directly as the shell's
      // argument (`$SHELL -i -c <cmd>`) so it runs with the user's interactive
      // rc environment (PATH/nvm/etc.) without typing into the PTY, which raced
      // the shell's startup and dropped the leading character. A command-less
      // server tab is a reattached/reconciled one whose PTY survived on the Rust
      // side: resolve to [] so usePty's getOrSpawn reuses the existing session
      // and mounts it. Leaving args null here would strand the reattached server
      // invisible — no terminal, no disconnect banner. Plain shell tabs spawn a
      // bare interactive shell.
      if (tabType === "server") {
        setResolvedArgs(tabCommand ? ["-i", "-c", tabCommand] : []);
        return;
      }
      setResolvedArgs([]);
      return;
    }
    if (!repoPath) return;
    let aborted = false;
    resolveLaunchArgs(repoPath).then((args) => {
      if (aborted) return;
      // On a RESTORED tab (first spawn only): strip any --resume/--resume=<id>/
      // --continue from extra flags so the tab's own session deterministically
      // wins, then inject --resume <claudeSessionId>.
      let finalArgs = args;
      if (!hasSpawnedRef.current && claudeSessionId) {
        finalArgs = withResumeSession(args, claudeSessionId);
      }
      hasSpawnedRef.current = true;
      setResolvedArgs(finalArgs);
    });
    return () => { aborted = true; };
  }, [repoPath, worktree?.branch, mode, claudeSessionId, tabType, tabCommand]);

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
    sessionType,
  });

  // Snapshot the sessions that already exist in this worktree's cwd-keyed
  // project dir BEFORE our Claude writes its own. Claude keys logs only by cwd,
  // so that dir is shared by sibling tabs, the user's other terminals at the
  // same path, and the historical pile a worktree accumulates (/code-review,
  // /open-pr, restarts, /clear forks). The discovery loop below excludes this
  // baseline so it only ever adopts the session THIS tab spawned — never a
  // foreign one. Captured on mount / restart so it lands before the PTY (which
  // spawns only after async settings resolution) creates its file.
  const spawnBaselineRef = useRef<string[] | null>(null);
  useEffect(() => {
    if (!isAgentTab || !worktree?.path) return;
    let cancelled = false;
    // Drop any prior baseline synchronously so a restart (reconnectKey change)
    // can't leave the discovery loop excluding the *old* snapshot and re-adopting
    // the session we just abandoned. discover() skips while this is null.
    spawnBaselineRef.current = null;
    listClaudeSessions(worktree.path)
      .then((ids) => { if (!cancelled) spawnBaselineRef.current = ids; })
      .catch((e) => {
        // Fall back to an empty baseline (old global-newest behaviour) rather
        // than blocking discovery entirely.
        if (cancelled) return;
        if (spawnBaselineRef.current === null) spawnBaselineRef.current = [];
        console.warn(`[TerminalView] Failed to snapshot Claude sessions for ${worktree.path}:`, e);
      });
    return () => { cancelled = true; };
  }, [isAgentTab, worktree?.path, reconnectKey]);

  // Discover and keep the Claude session ID in sync with the filesystem.
  // Runs once on first output, then periodically to catch mid-session changes
  // (e.g. /clear creating a new session). Updates resumeSessionId so the
  // correct session is persisted and resumed on the next app restart.
  const hasDiscoveredSession = useRef(false);
  useEffect(() => {
    if (!hasOutput || !isAgentTab) return;
    if (!activeWorktreeId || !worktree?.path) return;

    const discover = () => {
      // Prefer a baseline captured at spawn time by a background pre-spawner
      // (ensureAgentSession stores it on the session). For a background-opened
      // worktree our terminal mounts AFTER our own session file exists, so the
      // mount-time snapshot below would wrongly include (and exclude) it.
      // Foreground/restore spawns leave spawnBaseline undefined and fall back to
      // the mount snapshot, which for those paths is captured before the PTY.
      const baseline = sessionManager.getSession(sessionKey)?.spawnBaseline ?? spawnBaselineRef.current;
      // Wait until a baseline is available. Discovering against an empty exclude
      // set would reintroduce the global-newest bug the baseline exists to
      // prevent (a fast first tick beating the async snapshot). `null` means
      // "still loading"; `[]` means "loaded (or failed) — safe to proceed".
      if (baseline === null) return;
      // Exclude the baseline so we adopt only a session born from this tab's own
      // run, not a foreign session that merely shares the cwd.
      findClaudeSession(worktree.path, baseline).then((fsSessionId) => {
        if (!fsSessionId || !activeWorktreeId || !tabId) return;

        const tabs = useTabStore.getState().tabs[activeWorktreeId] ?? [];
        const ourCurrent = tabs.find((t) => t.id === tabId)?.resumeSessionId;
        if (fsSessionId === ourCurrent) return;

        // findClaudeSession returns the most-recently-modified JSONL in the
        // project dir, which in multi-tab worktrees is whichever sibling tab
        // was typed in last — not necessarily this tab's session. Skip
        // adoption when a sibling tab in the same worktree already owns the
        // discovered UUID, otherwise both tabs collapse onto the same Claude
        // identity and a fresh spawn (e.g. post-restart scrollback-only tab)
        // ends up `--resume`ing into the sibling's conversation.
        const ownedBySibling = tabs.some(
          (t) => t.id !== tabId && t.resumeSessionId === fsSessionId,
        );
        if (ownedBySibling) return;

        useTabStore.getState().updateTab(activeWorktreeId, tabId, { resumeSessionId: fsSessionId });
        // Write-through: persist the freshly-adopted id immediately via the
        // Rust sidecar, so a Force Quit / crash (uncatchable SIGKILL — the
        // onCloseRequested save never fires) before the next 30s blob autosave
        // can't strand it. Scoped to this tab: no debounce, no all-repos snapshot.
        if (worktree?.repoPath) {
          recordResumeSessionId(worktree.repoPath, activeWorktreeId, tabId, fsSessionId).catch((e) =>
            console.warn(`[TerminalView] Failed to persist resume session id for ${worktree.path}:`, e),
          );
        }
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
    // new session UUID). 30s left a window where /clear followed by an app
    // restart would --resume the pre-/clear session.
    const interval = setInterval(discover, 5_000);
    return () => clearInterval(interval);
  }, [hasOutput, isAgentTab, activeWorktreeId, worktree?.path, tabId]);

  const handleSendFeedback = useCallback(async () => {
    if (!activeWorktreeId || annotations.length === 0) return;

    // Send to THIS tab's session — the button lives inside a specific
    // TerminalView, so "Send as feedback" should target that tab, not
    // whatever getAgentSessionInfo re-resolves (which can point at the
    // last tab-bar click, not the tab currently on-screen).
    const session = sessionManager.getSession(sessionKey);
    if (!session) return;

    const message = formatAnnotationsMessage(annotations);
    const bytes = Array.from(new TextEncoder().encode(message));
    await writePty(session.sessionId, bytes);
    clearAnnotations(activeWorktreeId);
  }, [activeWorktreeId, annotations, clearAnnotations, sessionKey]);

  const handleClearAnnotations = useCallback(() => {
    if (activeWorktreeId) {
      clearAnnotations(activeWorktreeId);
    }
  }, [activeWorktreeId, clearAnnotations]);

  const handleRestartSession = useCallback(async () => {
    if (!tabId || !activeWorktreeId || !worktree || !repoPath) return;

    // Resolve new args BEFORE closing the old session so a config error
    // doesn't leave the session dead with no reconnect trigger.
    if (tabType === "server") {
      // Re-run the server's command (`$SHELL -i -c <cmd>`). A reattached server
      // tab has no stored command — fall back to a bare shell rather than the
      // Claude args, which the shell would mis-parse into a broken process.
      setResolvedArgs(tabCommand ? ["-i", "-c", tabCommand] : []);
    } else {
      setResolvedArgs(await resolveLaunchArgs(repoPath));

      // Clear the stale resumeSessionId so the discovery effect can find the
      // new session that the fresh Claude instance will create.
      hasDiscoveredSession.current = false;
      useTabStore.getState().updateTab(activeWorktreeId, tabId, { resumeSessionId: undefined });
    }

    await sessionManager.closeSession(sessionKey);
    setReconnectKey((k) => k + 1);
  }, [tabId, activeWorktreeId, worktree, sessionKey, repoPath, tabType, tabCommand]);

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

  // Cmd+F to toggle terminal search — gated by activePaneId so it only fires
  // for the currently active pane (split layouts) and works regardless of
  // where focus actually sits in the DOM.
  useEffect(() => {
    if (!activeWorktreeId || !tabId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && e.key === "f")) return;
      const layout = useLayoutStore.getState();
      const activePaneId = layout.activePaneId[activeWorktreeId];
      const myPaneId = layout.findPaneForTab(activeWorktreeId, tabId);
      if (!myPaneId || activePaneId !== myPaneId) return;
      e.preventDefault();
      e.stopPropagation();
      setShowSearch((s) => !s);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeWorktreeId, tabId]);

  // One-shot diagnostic capture of THIS pane for xterm-corruption analysis:
  // a screenshot (the on-screen garble), the raw replay-buffer bytes, and
  // xterm's serialized view — all written as siblings under one timestamp to
  // ~/Library/Logs/Alfredo/. The screenshot is the only half that records
  // GPU-composited corruption; comparing the byte/serialized halves tells us
  // whether garble is deterministic from the stream (parser) or diverged in
  // the live xterm (renderer). Fire-and-scroll: capture, then scroll away.
  const showToast = useToastStore((s) => s.show);
  const capturePane = useCallback(async () => {
    const session = sessionManager.getSession(sessionKey);
    const sessionId = session?.sessionId || sessionKey;
    const bytes = sessionManager.getBufferedOutput(sessionKey);
    let serialized: string | null = null;
    if (ptyTerminal) {
      const addon = new SerializeAddon();
      try {
        ptyTerminal.loadAddon(addon);
        serialized = addon.serialize();
      } catch (err) {
        console.warn(`[pty-dump] serialize failed:`, err);
      } finally {
        addon.dispose();
      }
    }
    try {
      const paths = await dumpPtyBuffer(sessionId, bytes, serialized, true);
      console.log(
        `[pty-dump] saved ${bytes.length}B raw → ${paths.raw}` +
          (paths.serialized ? `\n[pty-dump] saved serialized → ${paths.serialized}` : "") +
          (paths.screenshot ? `\n[pty-dump] saved screenshot → ${paths.screenshot}` : ""),
      );
      const revealTarget = paths.screenshot ?? paths.raw;
      showToast({
        message: paths.screenshot
          ? "Captured pane — screenshot + buffer saved. Scroll away to clear the garble."
          : "Buffer saved. Screenshot needs Screen Recording permission (System Settings → Privacy).",
        action: { label: "Show in Finder", onClick: () => void revealItemInDir(revealTarget) },
      });
    } catch (err) {
      console.error(`[pty-dump] failed:`, err);
      showToast({ message: "Pane capture failed — see console." });
    }
  }, [sessionKey, ptyTerminal, showToast]);

  // Cmd+Shift+D fires the capture for the active pane (gated like Cmd+F).
  useEffect(() => {
    if (!activeWorktreeId || !tabId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "d")) return;
      const layout = useLayoutStore.getState();
      const activePaneId = layout.activePaneId[activeWorktreeId];
      const myPaneId = layout.findPaneForTab(activeWorktreeId, tabId);
      if (!myPaneId || activePaneId !== myPaneId) return;
      e.preventDefault();
      e.stopPropagation();
      void capturePane();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeWorktreeId, tabId, capturePane]);

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

  // Keep the caret in the active terminal so the user can type immediately after
  // switching worktrees (the target worktree's terminal mounts fresh) or after
  // returning to Alfredo from another app (window regains focus). usePty focuses
  // on attach, but its typing-guard can skip that on a worktree switch, and
  // nothing re-focuses on app refocus — this covers both deterministically.
  // Deps limit it to the three transitions that matter (become-active / mount /
  // refocus). Only pull focus in when it isn't already on some control the user
  // put it on — a sidebar/toolbar button, a dialog, the changes-panel search.
  // The legit cases (fresh mount after a worktree switch, app refocus) leave
  // focus on <body> or already inside this terminal; anything else we leave be.
  useEffect(() => {
    if (!isActiveTerminal || !ptyTerminal || !windowFocused) return;
    const active = document.activeElement as HTMLElement | null;
    const focusElsewhere =
      !!active && active !== document.body && !ptyTerminal.element?.contains(active);
    if (focusElsewhere) return;
    ptyTerminal.focus();
  }, [isActiveTerminal, ptyTerminal, windowFocused]);

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
    if (activeWorktreeId) {
      const allIds = useWorkspaceStore.getState().worktrees.map((w) => w.id);
      debugLog(
        `[pin-diag] TerminalView !worktree active=${activeWorktreeId} ids=${JSON.stringify(allIds)}`,
      ).catch(() => {});
    }
    return (
      <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
        Starting session...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-bg-primary overflow-hidden">
      {isAgentTab && annotations.length > 0 && (
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
            visible={!hasOutput && channelAlive}
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
    </div>
  );
}

export { TerminalView };

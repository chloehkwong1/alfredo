import { useState, useRef, useEffect, useCallback } from "react";
import { MessageSquare, Send, Trash2 } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

import { usePty } from "../../hooks/usePty";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { sessionManager } from "../../services/sessionManager";
import { writePty, getConfig } from "../../api";
import { useAppConfig } from "../../hooks/useAppConfig";
import { loadSession } from "../../services/SessionPersistence";
import { Button } from "../ui/Button";
import { SessionResumeOverlay } from "./SessionResumeOverlay";
import { AgentSettingsPopover } from "./AgentSettingsPopover";
import {
  resolveSettings,
  buildClaudeArgs,
  settingsSnapshot,
  diffSettings,
} from "../../services/claudeSettingsResolver";
import type { Annotation, TabType } from "../../types";

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
  const sessionKey = tabId ?? activeWorktreeId ?? "";
  const mode = tabType === "shell" ? "shell" : "claude";

  const { activeRepo: repoPath } = useAppConfig();
  const [savedScrollback, setSavedScrollback] = useState<string | undefined>();

  // Only load persisted scrollback for disconnected tabs (app restart).
  // Active sessions already have their output in the SessionManager buffer.
  const isDisconnectedForScrollback = useWorkspaceStore((s) =>
    tabId ? s.disconnectedTabs.has(tabId) : false,
  );
  useEffect(() => {
    if (!repoPath || !activeWorktreeId || !tabId || !isDisconnectedForScrollback) return;
    loadSession(repoPath, activeWorktreeId).then((session) => {
      const scrollback = session?.terminals[tabId]?.scrollback;
      if (scrollback) setSavedScrollback(scrollback);
    }).catch(() => {});
  }, [repoPath, activeWorktreeId, tabId, isDisconnectedForScrollback]);

  const [reconnectKey, setReconnectKey] = useState(0);
  const [overlayDismissed, setOverlayDismissed] = useState(false);

  const isDisconnected = useWorkspaceStore((s) =>
    tabId ? s.disconnectedTabs.has(tabId) : false,
  );
  const removeDisconnectedTab = useWorkspaceStore((s) => s.removeDisconnectedTab);

  // Reset dismissed state whenever the tab becomes disconnected again
  useEffect(() => {
    if (isDisconnected) setOverlayDismissed(false);
  }, [isDisconnected]);

  // Get the current tab's saved settings for change detection
  const currentTab = useWorkspaceStore((s) => {
    if (!activeWorktreeId || !tabId) return undefined;
    return s.tabs[activeWorktreeId]?.find((t) => t.id === tabId);
  });

  const [resolvedArgs, setResolvedArgs] = useState<string[]>([]);
  const [currentSnapshot, setCurrentSnapshot] = useState<{
    model?: string; effort?: string; permissionMode?: string; outputStyle?: string;
  }>({});

  // Resolve settings when component mounts
  useEffect(() => {
    if (mode !== "claude" || !repoPath) return;
    getConfig(repoPath).then((config) => {
      const branch = worktree?.branch ?? "";
      const resolved = resolveSettings(
        config.claudeDefaults,
        config.worktreeOverrides?.[branch],
      );
      setResolvedArgs(buildClaudeArgs(resolved));
      setCurrentSnapshot(settingsSnapshot(resolved));
    }).catch(() => {});
  }, [repoPath, worktree?.branch, mode]);

  const settingsChangedText = diffSettings(currentTab?.claudeSettings, currentSnapshot);

  const { agentState } = usePty({
    sessionKey,
    worktreeId: activeWorktreeId ?? "",
    worktreePath: worktree?.path ?? "",
    containerRef,
    mode,
    initialScrollback: savedScrollback,
    args: resolvedArgs,
    disconnected: isDisconnected,
    reconnectKey,
  });

  const handleSendFeedback = useCallback(async () => {
    if (!activeWorktreeId || annotations.length === 0) return;

    // Find the first Claude session for this worktree to send feedback to
    const tabs = useWorkspaceStore.getState().tabs[activeWorktreeId] ?? [];
    const claudeTab = tabs.find((t) => t.type === "claude");
    const targetKey = claudeTab?.id ?? activeWorktreeId;

    const session = sessionManager.getSession(targetKey);
    if (!session) return;

    const lines = annotations.map(
      (a) => `Feedback on ${a.filePath}:${a.lineNumber} — ${a.text}`,
    );
    const message = "\n" + lines.join("\n") + "\n";
    const bytes = Array.from(new TextEncoder().encode(message));
    await writePty(session.sessionId, bytes);
    clearAnnotations(activeWorktreeId);
  }, [activeWorktreeId, annotations, clearAnnotations]);

  const handleClearAnnotations = useCallback(() => {
    if (activeWorktreeId) {
      clearAnnotations(activeWorktreeId);
    }
  }, [activeWorktreeId, clearAnnotations]);

  const handleResume = useCallback(async () => {
    if (!tabId || !activeWorktreeId || !worktree) return;

    const resumeArgs = ["--continue", ...resolvedArgs];
    await sessionManager.spawnForExisting(
      sessionKey,
      activeWorktreeId,
      worktree.path,
      "claude",
      resumeArgs,
    );

    removeDisconnectedTab(tabId);
    setReconnectKey((k) => k + 1);

    if (activeWorktreeId && tabId) {
      useWorkspaceStore.getState().updateTab(activeWorktreeId, tabId, {
        command: "claude",
        args: resumeArgs,
        claudeSettings: currentSnapshot,
      });
    }
  }, [tabId, activeWorktreeId, worktree, sessionKey, resolvedArgs, removeDisconnectedTab, currentSnapshot]);

  const handleStartFresh = useCallback(async () => {
    if (!tabId || !activeWorktreeId || !worktree) return;

    await sessionManager.closeSession(sessionKey);
    removeDisconnectedTab(tabId);
    setSavedScrollback(undefined);
    setReconnectKey((k) => k + 1);

    if (activeWorktreeId && tabId) {
      useWorkspaceStore.getState().updateTab(activeWorktreeId, tabId, {
        command: "claude",
        args: resolvedArgs,
        claudeSettings: currentSnapshot,
      });
    }
  }, [tabId, activeWorktreeId, worktree, sessionKey, resolvedArgs, removeDisconnectedTab, currentSnapshot]);

  const handleRestartSession = useCallback(async () => {
    if (!tabId || !activeWorktreeId || !worktree || !repoPath) return;

    await sessionManager.closeSession(sessionKey);

    const config = await getConfig(repoPath);
    const branch = worktree.branch ?? "";
    const resolved = resolveSettings(
      config.claudeDefaults,
      config.worktreeOverrides?.[branch],
    );
    const newArgs = buildClaudeArgs(resolved);
    setResolvedArgs(newArgs);
    setCurrentSnapshot(settingsSnapshot(resolved));
    setSavedScrollback(undefined);
    setReconnectKey((k) => k + 1);

    if (activeWorktreeId && tabId) {
      useWorkspaceStore.getState().updateTab(activeWorktreeId, tabId, {
        command: "claude",
        args: newArgs,
        claudeSettings: settingsSnapshot(resolved),
      });
    }
  }, [tabId, activeWorktreeId, worktree, sessionKey, repoPath]);

  // Mark as seen when user is viewing a terminal that's idle or waiting
  useEffect(() => {
    if (
      activeWorktreeId &&
      !isSeen &&
      (agentState === "idle" || agentState === "waitingForInput")
    ) {
      markWorktreeSeen(activeWorktreeId);
    }
  }, [activeWorktreeId, agentState, isSeen, markWorktreeSeen]);

  if (!activeWorktreeId) {
    return (
      <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
        Select a worktree to get started
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
    <div className="flex flex-col h-full bg-bg-primary">
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
      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="h-full p-1" />
        {isDisconnected && !overlayDismissed && (
          <SessionResumeOverlay
            settingsChangedText={settingsChangedText}
            onResume={handleResume}
            onStartFresh={handleStartFresh}
            onDismiss={() => setOverlayDismissed(true)}
          />
        )}
      </div>
      {/* Status bar */}
      {mode === "claude" && worktree && (
        <div className="relative flex items-center justify-end px-2 py-1 border-t border-border-default flex-shrink-0">
          <AgentSettingsPopover
            branch={worktree.branch ?? ""}
            onRestartSession={handleRestartSession}
          />
        </div>
      )}
    </div>
  );
}

export { TerminalView };

import { useState, useRef, useEffect, useCallback } from "react";
import { MessageSquare, Send, Trash2 } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

import { usePty } from "../../hooks/usePty";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { sessionManager } from "../../services/sessionManager";
import { writePty, getConfig } from "../../api";
import { useAppConfig } from "../../hooks/useAppConfig";
import { Button } from "../ui/Button";
import { AgentSettingsPopover } from "./AgentSettingsPopover";
import {
  resolveSettings,
  buildClaudeArgs,
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

  const [reconnectKey, setReconnectKey] = useState(0);

  const [resolvedArgs, setResolvedArgs] = useState<string[]>([]);

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
    }).catch(() => {});
  }, [repoPath, worktree?.branch, mode]);

  const { agentState, channelAlive } = usePty({
    sessionKey,
    worktreeId: activeWorktreeId ?? "",
    worktreePath: worktree?.path ?? "",
    containerRef,
    mode,
    args: resolvedArgs,
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
    setReconnectKey((k) => k + 1);
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
        {!channelAlive && (
          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-3 py-2 bg-bg-secondary/90 border-b border-border-default">
            <span className="text-xs text-text-secondary">Terminal disconnected</span>
            <Button size="sm" variant="secondary" onClick={handleRestartSession}>Restart session</Button>
          </div>
        )}
        <div ref={containerRef} className="h-full p-1" />
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

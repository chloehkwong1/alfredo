import { useCallback, useRef } from "react";
import { writePty, getConfig } from "../api";
import { resolveSettings, buildClaudeArgs } from "../services/claudeSettingsResolver";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { useLayoutStore } from "../stores/layoutStore";
import { sessionManager } from "../services/sessionManager";

export function useSendToClaude(
  worktreeId: string,
  repoPath: string,
  branch: string | undefined,
) {
  const annotations = useWorkspaceStore((s) => s.annotations[worktreeId]) ?? [];
  const clearAnnotations = useWorkspaceStore((s) => s.clearAnnotations);
  const sendingRef = useRef(false);

  const handleSendToClaude = useCallback(async () => {
    if (annotations.length === 0) return;
    if (sendingRef.current) return;
    sendingRef.current = true;

    try {
      const tabs = useTabStore.getState().tabs[worktreeId] ?? [];
      const claudeTab = tabs.find((t) => t.type === "claude");
      const targetKey = claudeTab?.id ?? worktreeId;

      // Auto-spawn session if it doesn't exist yet
      let session = sessionManager.getSession(targetKey);
      if (!session) {
        try {
          const config = await getConfig(repoPath);
          const resolved = resolveSettings(
            config.claudeDefaults,
            config.worktreeOverrides?.[branch ?? ""],
          );
          const args = buildClaudeArgs(resolved);
          session = await sessionManager.getOrSpawn(
            targetKey, worktreeId, repoPath, "claude", undefined, args,
          );
        } catch {
          return;
        }
      }

      // Group annotations by file
      const byFile = new Map<string, typeof annotations>();
      for (const a of annotations) {
        const list = byFile.get(a.filePath) ?? [];
        list.push(a);
        byFile.set(a.filePath, list);
      }

      // Format as markdown grouped by file
      let message = "\nCode review comments:\n";
      for (const [filePath, fileAnnotations] of byFile) {
        message += `\n## ${filePath}\n\n`;
        const sorted = [...fileAnnotations].sort((a, b) => a.lineNumber - b.lineNumber);
        for (const a of sorted) {
          message += `Line ${a.lineNumber}: ${a.text}\n\n`;
        }
      }

      session.waitingForInput = false;
      const bytes = Array.from(new TextEncoder().encode(message));
      await writePty(session.sessionId, bytes);
      clearAnnotations(worktreeId);

      // Switch to the Claude terminal tab so the user sees the message arrive
      if (claudeTab) {
        const layout = useLayoutStore.getState();
        const paneId = layout.findPaneForTab(worktreeId, claudeTab.id);
        if (paneId) {
          layout.setPaneActiveTab(worktreeId, paneId, claudeTab.id);
        }
      }
    } finally {
      sendingRef.current = false;
    }
  }, [worktreeId, repoPath, branch, annotations, clearAnnotations]);

  return { handleSendToClaude };
}

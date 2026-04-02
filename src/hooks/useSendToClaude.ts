import { useCallback, useRef } from "react";
import { ensureAgentSession, writeToSession, focusClaudeTab } from "../services/agentMessenger";
import { useWorkspaceStore } from "../stores/workspaceStore";

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
      let session;
      try {
        session = await ensureAgentSession(worktreeId, repoPath, branch);
      } catch {
        return;
      }
      if (!session) return;

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
      await writeToSession(session.sessionId, message);
      clearAnnotations(worktreeId);
      focusClaudeTab(worktreeId);
    } finally {
      sendingRef.current = false;
    }
  }, [worktreeId, repoPath, branch, annotations, clearAnnotations]);

  return { handleSendToClaude };
}

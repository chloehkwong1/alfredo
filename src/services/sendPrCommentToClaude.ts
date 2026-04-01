import { writePty, getConfig } from "../api";
import { resolveSettings, buildClaudeArgs } from "../services/claudeSettingsResolver";
import { useTabStore } from "../stores/tabStore";
import { useLayoutStore } from "../stores/layoutStore";
import { sessionManager } from "../services/sessionManager";
import { stripCommentNoise } from "../components/shared/MarkdownBody";
import type { PrComment } from "../types";

export async function sendPrCommentToClaude(
  worktreeId: string,
  repoPath: string,
  branch: string | undefined,
  comment: PrComment,
): Promise<void> {
  const tabs = useTabStore.getState().tabs[worktreeId] ?? [];
  const claudeTab = tabs.find((t) => t.type === "claude");
  const targetKey = claudeTab?.id ?? worktreeId;

  // Auto-spawn session if needed
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

  // Format as quote block with attribution
  const cleanedBody = stripCommentNoise(comment.body);
  const fileRef = comment.path
    ? `${comment.path}${comment.line != null ? `:${comment.line}` : ""}`
    : "general";
  const header = `[PR comment from @${comment.author} on ${fileRef}]`;
  const quotedBody = cleanedBody
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const message = `\n> ${header}\n${quotedBody}\n\n`;

  session.waitingForInput = false;
  const bytes = Array.from(new TextEncoder().encode(message));
  await writePty(session.sessionId, bytes);

  // Switch to Claude tab
  if (claudeTab) {
    const layout = useLayoutStore.getState();
    const paneId = layout.findPaneForTab(worktreeId, claudeTab.id);
    if (paneId) {
      layout.setPaneActiveTab(worktreeId, paneId, claudeTab.id);
    }
  }
}

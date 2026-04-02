import { ensureAgentSession, writeToSession, focusClaudeTab } from "./agentMessenger";
import { stripToPlainText } from "../components/shared/MarkdownBody";
import type { PrComment } from "../types";

/** Guard against double-sends from rapid clicks */
let sending = false;

export async function sendPrCommentToClaude(
  worktreeId: string,
  repoPath: string,
  branch: string | undefined,
  comment: PrComment,
): Promise<void> {
  if (sending) return;
  sending = true;
  try {
    await _sendPrCommentToClaude(worktreeId, repoPath, branch, comment);
  } finally {
    sending = false;
  }
}

async function _sendPrCommentToClaude(
  worktreeId: string,
  repoPath: string,
  branch: string | undefined,
  comment: PrComment,
): Promise<void> {
  let session;
  try {
    session = await ensureAgentSession(worktreeId, repoPath, branch);
  } catch {
    return;
  }
  if (!session) return;

  // Format as quote block with attribution
  const cleanedBody = stripToPlainText(comment.body);
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
  await writeToSession(session.sessionId, message);
  focusClaudeTab(worktreeId);
}

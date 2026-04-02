import { writePty, getConfig, getAppConfig } from "../api";
import { resolveSettings, buildClaudeArgs } from "./claudeSettingsResolver";
import { useTabStore } from "../stores/tabStore";
import { useLayoutStore } from "../stores/layoutStore";
import { sessionManager } from "./sessionManager";

/**
 * Find the Claude tab and its session key for a given worktree.
 */
export function getClaudeSessionInfo(worktreeId: string) {
  const tabs = useTabStore.getState().tabs[worktreeId] ?? [];
  const claudeTab = tabs.find((t) => t.type === "claude");
  const sessionKey = claudeTab?.id ?? worktreeId;
  return { claudeTab, sessionKey };
}

/**
 * Get an existing agent session, or spawn one with correctly resolved settings
 * (global app defaults → repo defaults → branch overrides).
 */
export async function ensureAgentSession(
  worktreeId: string,
  repoPath: string,
  branch: string | undefined,
) {
  const { sessionKey } = getClaudeSessionInfo(worktreeId);

  const existing = sessionManager.getSession(sessionKey);
  if (existing) return existing;

  const [appCfg, config] = await Promise.all([getAppConfig(), getConfig(repoPath)]);
  const resolved = resolveSettings(
    appCfg,
    config.claudeDefaults,
    config.worktreeOverrides?.[branch ?? ""],
  );
  const args = buildClaudeArgs(resolved);
  return sessionManager.getOrSpawn(
    sessionKey, worktreeId, repoPath, "claude", undefined, args,
  );
}

/**
 * Encode a text message and write it to a PTY session.
 */
export async function writeToSession(sessionId: string, message: string): Promise<void> {
  const bytes = Array.from(new TextEncoder().encode(message));
  await writePty(sessionId, bytes);
}

/**
 * Focus the Claude tab in the layout for a given worktree.
 */
export function focusClaudeTab(worktreeId: string): void {
  const { claudeTab } = getClaudeSessionInfo(worktreeId);
  if (!claudeTab) return;
  const layout = useLayoutStore.getState();
  const paneId = layout.findPaneForTab(worktreeId, claudeTab.id);
  if (paneId) {
    layout.setPaneActiveTab(worktreeId, paneId, claudeTab.id);
  }
}

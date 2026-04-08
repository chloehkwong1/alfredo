import { writePty, getConfig, getAppConfig } from "../api";
import { resolveSettings, buildClaudeArgs } from "./claudeSettingsResolver";
import { useTabStore } from "../stores/tabStore";
import { useLayoutStore } from "../stores/layoutStore";
import { sessionManager } from "./sessionManager";
import { findAgentTab, isAgentTab } from "../types";

/**
 * Find the most recently focused agent tab for a worktree.
 * Checks the active pane first, then other panes, then falls back to
 * the first agent tab in tab-list order.
 */
export function getAgentSessionInfo(worktreeId: string) {
  const tabs = useTabStore.getState().tabs[worktreeId] ?? [];
  const layoutState = useLayoutStore.getState();
  const worktreePanes = layoutState.panes[worktreeId];
  const activePaneId = layoutState.activePaneId[worktreeId];

  if (worktreePanes) {
    const tabById = new Map(tabs.map((t) => [t.id, t]));

    // Check active pane first
    if (activePaneId) {
      const pane = worktreePanes[activePaneId];
      if (pane) {
        const activeTab = tabById.get(pane.activeTabId);
        if (activeTab && isAgentTab(activeTab)) {
          return { agentTab: activeTab, sessionKey: activeTab.id };
        }
      }
    }

    // Check other panes' active tabs
    for (const [paneId, pane] of Object.entries(worktreePanes)) {
      if (paneId === activePaneId) continue;
      const activeTab = tabById.get(pane.activeTabId);
      if (activeTab && isAgentTab(activeTab)) {
        return { agentTab: activeTab, sessionKey: activeTab.id };
      }
    }
  }

  // Fall back to first agent tab in list
  const agentTab = findAgentTab(tabs);
  const sessionKey = agentTab?.id ?? worktreeId;
  return { agentTab, sessionKey };
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
  const { sessionKey } = getAgentSessionInfo(worktreeId);

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
 * Focus the most recently focused agent tab in the layout for a given worktree.
 */
export function focusAgentTab(worktreeId: string): void {
  const { agentTab } = getAgentSessionInfo(worktreeId);
  if (!agentTab) return;
  const layout = useLayoutStore.getState();
  const paneId = layout.findPaneForTab(worktreeId, agentTab.id);
  if (paneId) {
    layout.setPaneActiveTab(worktreeId, paneId, agentTab.id);
  }
}

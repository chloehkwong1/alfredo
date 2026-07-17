import { writePty, getConfig, getAppConfig, listClaudeSessions } from "../api";
import { resolveSettings, buildClaudeArgs } from "./claudeSettingsResolver";
import { useTabStore } from "../stores/tabStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
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
  const lastFocusedAgentTabId = layoutState.lastFocusedAgentTabId[worktreeId];

  if (worktreePanes) {
    const tabById = new Map(tabs.map((t) => [t.id, t]));

    // Prefer the most recently clicked agent tab, if it still exists
    if (lastFocusedAgentTabId) {
      const lastTab = tabById.get(lastFocusedAgentTabId);
      if (lastTab && isAgentTab(lastTab)) {
        return { agentTab: lastTab, sessionKey: lastTab.id };
      }
    }

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

  // Spawn in the worktree's own checkout, not repoPath. repoPath is the repo
  // root (the default-branch checkout), so using it as the cwd launches the
  // agent on `main` even though the sidebar shows the new worktree. The store
  // is the source of truth for the path (a branch-mode worktree's path already
  // equals repoPath, so this is a no-op there). getConfig still reads from
  // repoPath — config lives at the repo root, not per-worktree.
  const worktreePath =
    useWorkspaceStore.getState().worktrees.find((w) => w.id === worktreeId)?.path || repoPath;

  // Load configs resiliently: a transient getConfig/getAppConfig rejection must
  // not throw here, or the caller silently drops the whole action — e.g. the
  // background open-issue path creates the worktree but never launches Claude,
  // and send-to-Claude/PR-comment paths abort mid-flight. Mirror
  // TerminalView.resolveLaunchArgs: degrade to defaults built from whatever
  // resolved rather than failing.
  //
  // We also snapshot the worktree's existing Claude sessions here — a PRE-SPAWN
  // baseline. Because we (a background spawner) start the PTY before the terminal
  // ever mounts, TerminalView's own mount-time snapshot would run too late and
  // already contain this tab's freshly-written session, permanently excluding it
  // from discovery. Capturing it now (before getOrSpawn spawns) lets discovery
  // adopt this tab's own session and persist its resumeSessionId.
  const [appRes, cfgRes, baseRes] = await Promise.allSettled([
    getAppConfig(),
    getConfig(repoPath),
    listClaudeSessions(worktreePath),
  ]);
  if (appRes.status === "rejected" || cfgRes.status === "rejected") {
    console.error(
      `[agentMessenger] settings resolution failed for ${repoPath}; launching with defaults:`,
      [appRes, cfgRes]
        .filter((r) => r.status === "rejected")
        .map((r) => (r as PromiseRejectedResult).reason),
    );
  }
  const appCfg = appRes.status === "fulfilled" ? appRes.value : null;
  const config = cfgRes.status === "fulfilled" ? cfgRes.value : null;
  const spawnBaseline = baseRes.status === "fulfilled" ? baseRes.value : [];
  const resolved = resolveSettings(
    appCfg,
    config?.claudeDefaults,
    config?.worktreeOverrides?.[branch ?? ""],
  );
  const args = buildClaudeArgs(resolved);
  // "agent" sessionType (not the backend's "shell" default): the orphan
  // sweep and close() grace both branch on it, and background-opened claude
  // sessions are exactly the kind that must get the busy-gate.
  return sessionManager.getOrSpawn(
    sessionKey, worktreeId, worktreePath, "claude", undefined, args, "agent", spawnBaseline,
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
 * Fire the DOM focus-terminal event for a tab after the layout state renders.
 * The matching TerminalView listener calls xterm.focus() so the caret lands in
 * the tab's input. rAF lets the newly-mounted TerminalView register first.
 */
export function focusTerminalTab(tabId: string): void {
  requestAnimationFrame(() => {
    window.dispatchEvent(new CustomEvent("focus-terminal", { detail: { tabId } }));
  });
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
  focusTerminalTab(agentTab.id);
}

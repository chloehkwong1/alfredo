import { saveSessionFile, loadSessionFile, deleteSessionFile } from "../api";
import type { WorkspaceTab } from "../types";

export interface SessionData {
  tabs: WorkspaceTab[];
  activeTabId: string;
  terminals: Record<string, { scrollback: string }>;
  savedAt: string;
}

export async function saveSession(
  repoPath: string,
  worktreeId: string,
  data: SessionData,
): Promise<void> {
  await saveSessionFile(repoPath, worktreeId, JSON.stringify(data, null, 2));
}

export async function loadSession(
  repoPath: string,
  worktreeId: string,
): Promise<SessionData | null> {
  const content = await loadSessionFile(repoPath, worktreeId);
  if (!content) return null;
  try {
    return JSON.parse(content) as SessionData;
  } catch {
    return null;
  }
}

export async function deleteSession(
  repoPath: string,
  worktreeId: string,
): Promise<void> {
  await deleteSessionFile(repoPath, worktreeId);
}

export async function saveAllSessions(
  repoPath: string,
  worktreeIds: string[],
  getTabs: (worktreeId: string) => WorkspaceTab[],
  getActiveTabId: (worktreeId: string) => string,
  getScrollback: (tabId: string) => string,
): Promise<void> {
  const saves = worktreeIds.map((wtId) => {
    const tabs = getTabs(wtId);
    const terminals: Record<string, { scrollback: string }> = {};
    for (const tab of tabs) {
      if (tab.type === "claude" || tab.type === "shell") {
        const scrollback = getScrollback(tab.id);
        if (scrollback) {
          terminals[tab.id] = { scrollback };
        }
      }
    }
    const data: SessionData = {
      tabs,
      activeTabId: getActiveTabId(wtId),
      terminals,
      savedAt: new Date().toISOString(),
    };
    return saveSession(repoPath, wtId, data);
  });
  await Promise.allSettled(saves);
}

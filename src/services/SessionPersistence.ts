import { saveSessionFile, loadSessionFile, deleteSessionFile } from "../api";
import type { WorkspaceTab, LayoutNode, Pane, KanbanColumn, DiffViewMode, PrPanelState } from "../types";

export interface SessionData {
  tabs: WorkspaceTab[];
  activeTabId: string;
  terminals: Record<string, { scrollback: string }>;
  savedAt: string;
  /** Layout tree (added in split-view feature). */
  layout?: LayoutNode;
  /** Pane state (added in split-view feature). */
  panes?: Record<string, Pane>;
  /** Active pane ID (added in split-view feature). */
  activePaneId?: string;
  /** Last-known kanban column so worktrees render in the correct group on restore. */
  column?: KanbanColumn;
  /** Diff view mode (split or unified) for this worktree. */
  diffViewMode?: DiffViewMode;
  /** Manual column override with the GitHub state it was set against. */
  columnOverride?: { column: KanbanColumn; githubStateWhenSet: string } | null;
  /** PR panel expanded or collapsed. */
  prPanelState?: PrPanelState;
  /** Changes tab view mode (changes or commits). */
  changesViewMode?: "changes" | "commits";
  /** Whether the changes panel is minimized. */
  changesPanelCollapsed?: boolean;
  /** Whether the user has dismissed the idle indicator for this worktree. */
  seenWorktree?: boolean;
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
  getLayout?: (worktreeId: string) => LayoutNode | undefined,
  getPanes?: (worktreeId: string) => Record<string, Pane> | undefined,
  getActivePaneId?: (worktreeId: string) => string | undefined,
  getColumn?: (worktreeId: string) => KanbanColumn | undefined,
  getDiffViewMode?: (worktreeId: string) => DiffViewMode | undefined,
  getColumnOverride?: (worktreeId: string) => { column: KanbanColumn; githubStateWhenSet: string } | null | undefined,
  getPrPanelState?: (worktreeId: string) => PrPanelState | undefined,
  getChangesViewMode?: (worktreeId: string) => "changes" | "commits" | undefined,
  getChangesPanelCollapsed?: (worktreeId: string) => boolean | undefined,
  getSeenWorktree?: (worktreeId: string) => boolean | undefined,
): Promise<void> {
  const saves = worktreeIds.map((wtId) => {
    const tabs = getTabs(wtId).filter((t) => t.type !== "server");
    const terminals: Record<string, { scrollback: string }> = {};
    for (const tab of tabs) {
      if (tab.type === "claude" || tab.type === "shell") {
        const scrollback = getScrollback(tab.id);
        if (scrollback) {
          terminals[tab.id] = { scrollback };
        }
      }
    }

    // Filter server tabs from pane state too
    const rawPanes = getPanes?.(wtId);
    const panes = rawPanes
      ? Object.fromEntries(
          Object.entries(rawPanes).map(([paneId, pane]) => [
            paneId,
            {
              ...pane,
              tabIds: pane.tabIds.filter((id) => tabs.some((t) => t.id === id)),
            },
          ]),
        )
      : undefined;

    const data: SessionData = {
      tabs,
      activeTabId: getActiveTabId(wtId),
      terminals,
      savedAt: new Date().toISOString(),
      layout: getLayout?.(wtId),
      panes,
      activePaneId: getActivePaneId?.(wtId),
      column: getColumn?.(wtId),
      diffViewMode: getDiffViewMode?.(wtId),
      columnOverride: getColumnOverride?.(wtId),
      prPanelState: getPrPanelState?.(wtId),
      changesViewMode: getChangesViewMode?.(wtId),
      changesPanelCollapsed: getChangesPanelCollapsed?.(wtId),
      seenWorktree: getSeenWorktree?.(wtId),
    };
    return saveSession(repoPath, wtId, data);
  });
  await Promise.allSettled(saves);
}

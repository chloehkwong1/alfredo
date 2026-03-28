import { useEffect, useRef } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useLayoutStore } from "../stores/layoutStore";
import { listWorktrees, ensureAlfredoGitignore, getWorktreeDiffStats, setSyncRepoPaths } from "../api";
import { loadSession } from "../services/SessionPersistence";
import { sessionManager } from "../services/sessionManager";

/**
 * Loads worktrees for all selected repos, restores persisted sessions
 * (once per app lifecycle), and fetches diff stats in the background.
 */
export function useSessionRestore(repoPath: string | null, selectedRepos: string[]) {
  const setWorktreesForRepo = useWorkspaceStore((s) => s.setWorktreesForRepo);
  const clearWorktreesForRepo = useWorkspaceStore((s) => s.clearWorktreesForRepo);
  const updateWorktree = useWorkspaceStore((s) => s.updateWorktree);
  const restoreTabs = useWorkspaceStore((s) => s.restoreTabs);
  const ensureDefaultTabs = useWorkspaceStore((s) => s.ensureDefaultTabs);
  const hasRestoredSessions = useRef(false);

  const selectedReposKey = selectedRepos.join(",");
  useEffect(() => {
    if (!repoPath) return;
    const reposToSync = selectedRepos.length > 0 ? selectedRepos : [repoPath];
    setSyncRepoPaths(reposToSync).catch(e => console.warn('[AppShell] Failed to sync repo paths:', e));

    const reposToLoad = selectedRepos.length > 0 ? selectedRepos : [repoPath];

    // Clean up worktrees for repos that were deselected
    const currentWorktrees = useWorkspaceStore.getState().worktrees;
    const loadedRepoPaths = new Set(currentWorktrees.map((wt) => wt.repoPath));
    const reposToLoadSet = new Set(reposToLoad);
    for (const loadedRepo of loadedRepoPaths) {
      if (!reposToLoadSet.has(loadedRepo)) {
        clearWorktreesForRepo(loadedRepo);
      }
    }

    for (const repo of reposToLoad) {
      listWorktrees(repo).then(async (wts) => {
        if (wts.length > 0) {
          setWorktreesForRepo(repo, wts);
          ensureAlfredoGitignore(repo).catch(e => console.warn('[AppShell] Failed to ensure .alfredo gitignore:', e));

          if (!hasRestoredSessions.current) {
            hasRestoredSessions.current = true;
            for (const wt of wts) {
              const session = await loadSession(repo, wt.id);
              if (session) {
                restoreTabs(wt.id, session.tabs, session.activeTabId);

                const sessionLayout = session.layout;
                const sessionPanes = session.panes;
                const sessionActivePaneId = session.activePaneId;
                if (sessionLayout && sessionPanes) {
                  useLayoutStore.getState().restoreLayout(
                    wt.id, sessionLayout, sessionPanes, sessionActivePaneId ?? Object.keys(sessionPanes)[0],
                  );
                } else {
                  const tabIds = session.tabs.map((t) => t.id);
                  useLayoutStore.getState().initLayout(wt.id, tabIds, session.activeTabId);
                }

                for (const tab of session.tabs) {
                  if (tab.type === "claude" && !sessionManager.getSession(tab.id)) {
                    try {
                      await sessionManager.getOrSpawn(
                        tab.id, wt.id, wt.path, "claude", undefined, ["--continue"],
                      );
                    } catch (err) {
                      console.warn(`[session-restore] Failed to resume session ${tab.id}:`, err);
                    }
                  }
                }
              }
            }

            for (const wt of wts) {
              ensureDefaultTabs(wt.id);
            }

            for (const wt of wts) {
              if (!useLayoutStore.getState().layout[wt.id]) {
                const wtTabs = useWorkspaceStore.getState().tabs[wt.id] ?? [];
                const wtActiveTabId = useWorkspaceStore.getState().activeTabId[wt.id] ?? "";
                useLayoutStore.getState().initLayout(wt.id, wtTabs.map((t) => t.id), wtActiveTabId);
              }
            }
          }

          for (const wt of wts) {
            if (wt.column === "done") continue;
            getWorktreeDiffStats(wt.path)
              .then(([additions, deletions]) => {
                updateWorktree(wt.id, { additions, deletions });
              })
              .catch(e => console.warn(`[AppShell] Failed to load diff stats for ${wt.path}:`, e));
          }
        }
      }).catch(e => {
        console.warn(`[AppShell] Failed to list worktrees for ${repo}:`, e);
      });
    }
  }, [repoPath, selectedReposKey, setWorktreesForRepo, clearWorktreesForRepo, updateWorktree, restoreTabs, ensureDefaultTabs]);
}

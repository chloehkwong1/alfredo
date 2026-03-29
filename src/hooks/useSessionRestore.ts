import { useEffect, useRef } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { useLayoutStore } from "../stores/layoutStore";
import { listWorktrees, ensureAlfredoGitignore, getWorktreeDiffStats, setSyncRepoPaths } from "../api";
import { loadSession } from "../services/SessionPersistence";

/**
 * Loads worktrees for all selected repos, restores persisted sessions
 * (once per app lifecycle), and fetches diff stats in the background.
 */
export function useSessionRestore(repoPath: string | null, selectedRepos: string[]) {
  const setWorktreesForRepo = useWorkspaceStore((s) => s.setWorktreesForRepo);
  const clearWorktreesForRepo = useWorkspaceStore((s) => s.clearWorktreesForRepo);
  const updateWorktree = useWorkspaceStore((s) => s.updateWorktree);
  const restoreTabs = useTabStore((s) => s.restoreTabs);
  const ensureDefaultTabs = useTabStore((s) => s.ensureDefaultTabs);
  const markWorktreeSeen = useWorkspaceStore((s) => s.markWorktreeSeen);
  const restoredRepos = useRef(new Set<string>());

  const selectedReposKey = selectedRepos.join(",");
  useEffect(() => {
    if (!repoPath) return;
    const reposToSync = selectedRepos.length > 0 ? selectedRepos : [repoPath];
    const worktreeBranches = useWorkspaceStore.getState().worktrees
      .filter((wt) => !wt.archived)
      .map((wt) => wt.branch);
    setSyncRepoPaths(reposToSync, worktreeBranches).catch(e => console.warn('[AppShell] Failed to sync repo paths:', e));

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

          // Update active branches now that worktrees are loaded
          const allWorktrees = useWorkspaceStore.getState().worktrees;
          const branches = allWorktrees.filter((wt) => !wt.archived).map((wt) => wt.branch);
          const repos = selectedRepos.length > 0 ? selectedRepos : [repoPath];
          setSyncRepoPaths(repos, branches).catch(() => {});

          if (!restoredRepos.current.has(repo)) {
            restoredRepos.current.add(repo);
            for (const wt of wts) {
              const session = await loadSession(repo, wt.id);
              if (session) {
                // Restore saved column before any rendering so worktrees
                // appear in the correct kanban group immediately.
                if (session.column) {
                  updateWorktree(wt.id, { column: session.column });
                }

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

                // Don't eagerly spawn sessions — they'll start lazily when
                // the user clicks the Claude tab via usePty → getOrSpawn.
                // Eager spawning on restore causes multiple concurrent PTY
                // processes that can freeze the app.
                for (const tab of session.tabs) {
                  if (tab.type === "claude") {
                    markWorktreeSeen(wt.id);
                  }
                }
              }
            }

            for (const wt of wts) {
              ensureDefaultTabs(wt.id);
            }

            for (const wt of wts) {
              if (!useLayoutStore.getState().layout[wt.id]) {
                const wtTabs = useTabStore.getState().tabs[wt.id] ?? [];
                const wtActiveTabId = useTabStore.getState().activeTabId[wt.id] ?? "";
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

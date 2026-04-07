import { useEffect, useRef } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { useLayoutStore } from "../stores/layoutStore";
import { listWorktrees, ensureAlfredoGitignore, getWorktreeDiffStats, setSyncRepoPaths, findClaudeSession, getConfig, getActiveBranch } from "../api";
import { loadSession } from "../services/SessionPersistence";
import { sessionManager } from "../services/sessionManager";
import { usePrStore } from "../stores/prStore";
import { findAgentTab, isAgentTab } from "../types";
import type { RepoEntry, Worktree } from "../types";

/**
 * Loads worktrees for all selected repos, restores persisted sessions
 * (once per app lifecycle), and fetches diff stats in the background.
 */
export function useSessionRestore(repoPath: string | null, selectedRepos: string[], repos: RepoEntry[]) {
  const setWorktreesForRepo = useWorkspaceStore((s) => s.setWorktreesForRepo);
  const clearWorktreesForRepo = useWorkspaceStore((s) => s.clearWorktreesForRepo);
  const updateWorktree = useWorkspaceStore((s) => s.updateWorktree);
  const restoreTabs = useTabStore((s) => s.restoreTabs);
  const updateTab = useTabStore((s) => s.updateTab);
  const ensureDefaultTabs = useTabStore((s) => s.ensureDefaultTabs);
  const markWorktreeSeen = useWorkspaceStore((s) => s.markWorktreeSeen);
  const restoredRepos = useRef(new Set<string>());

  const selectedReposKey = selectedRepos.join(",");
  const repoModeKey = repos.map((r) => `${r.path}:${r.mode}`).join(",");
  useEffect(() => {
    if (!repoPath) return;
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

    const repoModeMap = new Map(repos.map((r) => [r.path, r.mode]));

    for (const repo of reposToLoad) {
      const isBranchMode = repoModeMap.get(repo) === "branch";

      // For branch-mode repos, create a synthetic worktree entry so the rest
      // of the app (TerminalView, ChangesPanel) can find it in the store.
      if (isBranchMode) {
        getActiveBranch(repo).then((branch) => {
          const id = `branch::${repo}`;
          const name = repo.split("/").pop() ?? repo;
          const synthetic: Worktree = {
            id,
            name,
            path: repo,
            branch: branch ?? "main",
            prStatus: null,
            agentStatus: "notRunning",
            column: "inProgress",
            isBranchMode: true,
            additions: null,
            deletions: null,
            repoPath: repo,
          };
          setWorktreesForRepo(repo, [synthetic]);
        }).catch((e) => console.warn(`[session-restore] Failed to get active branch for ${repo}:`, e));
        continue;
      }

      listWorktrees(repo).then(async (wts) => {
        if (wts.length > 0) {
          setWorktreesForRepo(repo, wts);
          ensureAlfredoGitignore(repo).catch(e => console.warn('[AppShell] Failed to ensure .alfredo gitignore:', e));

          if (!restoredRepos.current.has(repo)) {
            restoredRepos.current.add(repo);

            // Sync archive/delete settings from per-repo config to workspace store
            getConfig(repo).then((cfg) => {
              if (cfg.archiveAfterDays != null) {
                useWorkspaceStore.setState({ archiveAfterDays: cfg.archiveAfterDays });
              }
              if (cfg.deleteAfterDays != null) {
                useWorkspaceStore.setState({ deleteAfterDays: cfg.deleteAfterDays });
              }
            }).catch((e) => console.warn('[session-restore] Failed to load repo config:', e));
            for (const wt of wts) {
              const session = await loadSession(repo, wt.id);
              if (session) {
                // Restore saved column before any rendering so worktrees
                // appear in the correct kanban group immediately.
                if (session.column) {
                  updateWorktree(wt.id, { column: session.column });
                }
                if (session.archived) {
                  updateWorktree(wt.id, { archived: true, archivedAt: session.archivedAt });
                }

                restoreTabs(wt.id, session.tabs, session.activeTabId);

                // Pre-load terminal scrollback so it's visible before PTY spawns
                if (session.terminals) {
                  for (const [tabId, termData] of Object.entries(session.terminals)) {
                    if (termData.scrollback) {
                      sessionManager.loadScrollbackOnly(tabId, termData.scrollback);
                    }
                  }
                }

                // Restore per-worktree UI state
                if (session.diffViewMode) {
                  useWorkspaceStore.getState().setDiffViewMode(wt.id, session.diffViewMode);
                }
                if (session.changesViewMode) {
                  useWorkspaceStore.getState().setChangesViewMode(wt.id, session.changesViewMode);
                }
                if (session.changesPanelCollapsed != null) {
                  useWorkspaceStore.getState().setChangesPanelCollapsed(wt.id, session.changesPanelCollapsed);
                }
                if (session.seenWorktree) {
                  markWorktreeSeen(wt.id);
                }
                if (session.unreadWorktree) {
                  useWorkspaceStore.getState().markWorktreeUnread(wt.id);
                }

                // Restore inline annotations
                if (session.annotations?.length) {
                  const store = useWorkspaceStore.getState();
                  for (const annotation of session.annotations) {
                    store.addAnnotation(annotation);
                  }
                }

                // Restore column override
                if (session.columnOverride) {
                  usePrStore.getState().setManualColumn(
                    wt.id,
                    session.columnOverride.column,
                    session.columnOverride.githubStateWhenSet,
                  );
                }

                // Restore PR panel state
                if (session.prPanelState) {
                  usePrStore.getState().setPrPanelState(wt.id, session.prPanelState);
                }

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

                // Restore persisted Claude session ID immediately
                if (session.claudeSessionId) {
                  updateWorktree(wt.id, { claudeSessionId: session.claudeSessionId });
                  // Stamp resumeSessionId on the first agent tab so only
                  // restored tabs auto-resume (new tabs via Cmd+T won't have it)
                  const firstAgentTab = findAgentTab(session.tabs);
                  if (firstAgentTab) {
                    updateTab(wt.id, firstAgentTab.id, { resumeSessionId: session.claudeSessionId });
                  }
                }

                // Also scan filesystem for a newer session ID (fire and forget)
                findClaudeSession(wt.path)
                  .then((claudeSessionId) => {
                    if (claudeSessionId) {
                      updateWorktree(wt.id, { claudeSessionId });
                      // Update the first agent tab with the latest session ID
                      const tabs = useTabStore.getState().tabs[wt.id] ?? [];
                      const firstAgentTab = findAgentTab(tabs);
                      if (firstAgentTab) {
                        updateTab(wt.id, firstAgentTab.id, { resumeSessionId: claudeSessionId });
                      }
                    }
                  })
                  .catch((e) => console.warn(`[useSessionRestore] Failed to find Claude session for ${wt.path}:`, e));

                // Don't eagerly spawn sessions — they'll start lazily when
                // the user clicks the Claude tab via usePty → getOrSpawn.
                // Eager spawning on restore causes multiple concurrent PTY
                // processes that can freeze the app.
                for (const tab of session.tabs) {
                  if (isAgentTab(tab)) {
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

          // Start GitHub PR sync AFTER session restore so that columnOverrides
          // are loaded into prStore before the first poll — otherwise the poll
          // overwrites manual column overrides with autoColumn.
          const allWorktrees = useWorkspaceStore.getState().worktrees;
          const branches = allWorktrees.filter((wt) => !wt.archived).map((wt) => wt.branch);
          const syncRepos = selectedRepos.length > 0 ? selectedRepos : [repoPath];
          setSyncRepoPaths(syncRepos, branches).catch((e) => console.warn('[session-restore] Failed to set sync repo paths:', e));

          for (const wt of wts) {
            if (wt.column === "done") continue;
            getWorktreeDiffStats(wt.path, wt.stackParent)
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
  }, [repoPath, selectedReposKey, repoModeKey, setWorktreesForRepo, clearWorktreesForRepo, updateWorktree, restoreTabs, ensureDefaultTabs]);
}

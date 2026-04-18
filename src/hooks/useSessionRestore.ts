import { useEffect, useRef } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { useLayoutStore } from "../stores/layoutStore";
import { listWorktrees, getWorktreeDiffStats, setSyncRepoPaths, findClaudeSession, getActiveBranch } from "../api";
import { loadSession } from "../services/SessionPersistence";
import { sessionManager } from "../services/sessionManager";
import { usePrStore } from "../stores/prStore";
import { isAgentTab } from "../types";
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
          if (!restoredRepos.current.has(repo)) {
            restoredRepos.current.add(repo);

            // ── Phase 1: Restore all session state BEFORE making worktrees
            // visible in the store. This is critical: setWorktreesForRepo
            // triggers useStatePersistence → setActiveWorktree → AppShell's
            // ensureDefaultTabs effect. If tabs aren't already in place,
            // ensureDefaultTabs creates fresh tabs without resumeSessionId,
            // TerminalView mounts, and Claude spawns without --resume.
            // Loading sessions first eliminates this race entirely.
            for (const wt of wts) {
              const session = await loadSession(repo, wt.id);
              if (!session) continue;

              // Apply persisted worktree state directly to the object so
              // it's set atomically when setWorktreesForRepo stores them.
              if (session.column) {
                wt.column = session.column;
              }
              if (session.archived) {
                wt.archived = true;
                wt.archivedAt = session.archivedAt;
              }
              if (session.unarchivedAt) {
                wt.unarchivedAt = session.unarchivedAt;
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
              if (session.pinnedWorktree) {
                useWorkspaceStore.getState().togglePinWorktree(wt.id);
              }

              // Restore inline annotations
              if (session.annotations?.length) {
                const store = useWorkspaceStore.getState();
                for (const annotation of session.annotations) {
                  store.addAnnotation(annotation);
                }
              }

              // Restore column override — persists until autoColumn changes
              if (session.columnOverride) {
                const override = session.columnOverride;
                if (typeof override === "object" && "autoColumnWhenSet" in override) {
                  usePrStore.setState((s) => ({
                    columnOverrides: {
                      ...s.columnOverrides,
                      [wt.id]: { column: override.column, autoColumnWhenSet: override.autoColumnWhenSet },
                    },
                    lastAutoColumn: { ...s.lastAutoColumn, [wt.id]: override.autoColumnWhenSet },
                  }));
                } else {
                  const col = typeof override === "string" ? override : override.column;
                  usePrStore.setState((s) => ({
                    columnOverrides: {
                      ...s.columnOverrides,
                      [wt.id]: { column: col, autoColumnWhenSet: col, needsMigration: true },
                    },
                  }));
                }
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

              // Restore per-tab Claude session IDs.
              // Always check the filesystem for the most recent session so we
              // don't resume a stale conversation when the user's real session
              // changed mid-use (e.g. /clear created a new session).
              const agentTabs = session.tabs.filter(isAgentTab);
              const tabsWithSession = agentTabs.filter((t) => t.resumeSessionId);
              const tabsWithoutSession = agentTabs.filter((t) => !t.resumeSessionId);

              let latestSessionId: string | null = null;
              try {
                latestSessionId = await findClaudeSession(wt.path) ?? null;
              } catch (e) {
                console.warn(`[useSessionRestore] Failed to find Claude session for ${wt.path}:`, e);
              }

              if (agentTabs.length === 1) {
                // Single agent tab: always use the most recent session from
                // the filesystem — the saved resumeSessionId may be stale.
                const sessionId = latestSessionId ?? tabsWithSession[0]?.resumeSessionId ?? session.claudeSessionId ?? null;
                if (sessionId) {
                  wt.claudeSessionId = sessionId;
                  updateTab(wt.id, agentTabs[0].id, { resumeSessionId: sessionId });
                }
              } else {
                // Multiple agent tabs: preserve per-tab sessions (each tab
                // resumes its own conversation). Only discover for tabs
                // that don't have a saved session ID.
                if (tabsWithoutSession.length > 0) {
                  const fallbackSessionId = latestSessionId ?? session.claudeSessionId ?? null;
                  if (fallbackSessionId) {
                    for (const tab of tabsWithoutSession) {
                      updateTab(wt.id, tab.id, { resumeSessionId: fallbackSessionId });
                    }
                  }
                }
                if (tabsWithSession.length > 0) {
                  wt.claudeSessionId = tabsWithSession[0].resumeSessionId;
                } else if (latestSessionId) {
                  wt.claudeSessionId = latestSessionId;
                }
              }

              for (const tab of session.tabs) {
                if (isAgentTab(tab)) {
                  markWorktreeSeen(wt.id);
                }
              }
            }
          }

          // ── Phase 2: Make worktrees visible with all state pre-applied.
          // Tabs, layouts, and session IDs are already in their stores, so
          // ensureDefaultTabs will be a no-op and TerminalView will mount
          // with resumeSessionId available from the first render.
          setWorktreesForRepo(repo, wts);

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

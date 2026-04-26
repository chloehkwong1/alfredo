import { useEffect, useRef } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { useLayoutStore } from "../stores/layoutStore";
import { listWorktrees, getWorktreeDiffStats, setSyncRepoPaths, findClaudeSession, getActiveBranch } from "../api";
import { loadSession } from "../services/SessionPersistence";
import { sessionManager } from "../services/sessionManager";
import { usePrStore } from "../stores/prStore";
import { repoId } from "./useBranchRepos";
import { isAgentTab } from "../types";
import type { RepoEntry, Worktree } from "../types";

/**
 * Loads worktrees for all selected repos, restores persisted sessions
 * (once per app lifecycle), and fetches diff stats in the background.
 */
function buildSyntheticBranchWorktree(
  repoPath: string,
  branch: string | null,
  isPinnedMainCard: boolean = false,
): Worktree {
  return {
    id: repoId(repoPath),
    name: repoPath.split("/").pop() ?? repoPath,
    path: repoPath,
    branch: branch ?? "main",
    prStatus: null,
    agentStatus: "notRunning",
    column: "inProgress",
    isBranchMode: true,
    additions: null,
    deletions: null,
    repoPath,
    ...(isPinnedMainCard ? { isPinnedMainCard: true } : {}),
  };
}

export function useSessionRestore(
  repoPath: string | null,
  selectedRepos: string[],
  repos: RepoEntry[],
  showMainCardRepos: string[] = [],
) {
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
  const showMainCardReposKey = [...showMainCardRepos].sort().join(",");

  // Own the synthetic "main card" entries for worktree-mode repos that opted
  // in via showMainCardRepos. Decoupled from listWorktrees so the entry is
  // present as soon as the config says it should be — the main effect below
  // may take seconds (listWorktrees + session restore), and the user can
  // click the card in that window. buildSyntheticBranchWorktree uses "main"
  // as a fallback; useBranchRepos polls getActiveBranch and syncs the real
  // branch name back via updateWorktree.
  // Declared BEFORE the listWorktrees effect so it runs first on mount and
  // the synthetic is in place before any later writes.
  useEffect(() => {
    const repoModeMap = new Map(repos.map((r) => [r.path, r.mode]));
    const expectedIds = new Set<string>();
    const toAdd: string[] = [];
    for (const repo of showMainCardRepos) {
      if (!selectedRepos.includes(repo)) continue;
      if (repoModeMap.get(repo) !== "worktree") continue;
      const id = repoId(repo);
      expectedIds.add(id);
      const present = useWorkspaceStore.getState().worktrees.some((wt) => wt.id === id);
      if (!present) toAdd.push(repo);
    }

    // Remove synthetic entries that are no longer expected (unpinned or
    // repo deselected / mode switched).
    const currentWorktrees = useWorkspaceStore.getState().worktrees;
    const staleByRepo = new Map<string, Worktree[]>();
    for (const wt of currentWorktrees) {
      if (!wt.isBranchMode) continue;
      if (repoModeMap.get(wt.repoPath) !== "worktree") continue;
      if (expectedIds.has(wt.id)) continue;
      const list = staleByRepo.get(wt.repoPath) ?? [];
      list.push(wt);
      staleByRepo.set(wt.repoPath, list);
    }

    // Skip the writes when nothing is dirty. The effect re-fires on
    // `selectedReposKey` / `repoModeKey` changes (most config changes), so
    // bailing out here avoids forcing every `useWorkspaceStore` subscriber
    // to re-render when no synthetic add/remove is actually needed.
    if (staleByRepo.size === 0 && toAdd.length === 0) return;

    for (const [repo, stales] of staleByRepo) {
      const staleIds = new Set(stales.map((wt) => wt.id));
      const kept = currentWorktrees.filter(
        (wt) => wt.repoPath === repo && !staleIds.has(wt.id),
      );
      if (kept.length === 0) {
        clearWorktreesForRepo(repo);
      } else {
        setWorktreesForRepo(repo, kept);
      }
    }

    for (const repo of toAdd) {
      const latest = useWorkspaceStore.getState().worktrees.filter(
        (wt) => wt.repoPath === repo,
      );
      const existing = latest.find((wt) => wt.id === repoId(repo));
      if (existing && existing.isPinnedMainCard === true) continue;
      // Either no entry yet, or a non-pinned (branch-mode-created) entry needs upgrading.
      const withoutExisting = existing ? latest.filter((wt) => wt.id !== existing.id) : latest;
      setWorktreesForRepo(repo, [...withoutExisting, buildSyntheticBranchWorktree(repo, null, true)]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReposKey, repoModeKey, showMainCardReposKey, setWorktreesForRepo, clearWorktreesForRepo]);

  useEffect(() => {
    if (!repoPath) return;
    // Guards stale async closures from overwriting store state set by a newer
    // effect run (e.g. user pins a main card; previous run's listWorktrees
    // resolves late and wipes the synthetic).
    let cancelled = false;
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
          if (cancelled) return;
          setWorktreesForRepo(repo, [buildSyntheticBranchWorktree(repo, branch)]);
        }).catch((e) => console.warn(`[session-restore] Failed to get active branch for ${repo}:`, e));
        continue;
      }

      listWorktrees(repo).then(async (wts) => {
        if (cancelled) return;
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
                //
                // Assign the fallback UUID to *only* the first tab without a
                // saved session — assigning it to all of them would collapse
                // them onto the same Claude identity, the same shape as the
                // discover() contamination bug. Remaining tabs stay at
                // resumeSessionId=undefined and get adopted independently by
                // discover() once each owns its own JSONL on disk.
                if (tabsWithoutSession.length > 0) {
                  const fallbackSessionId = latestSessionId ?? session.claudeSessionId ?? null;
                  if (fallbackSessionId) {
                    updateTab(wt.id, tabsWithoutSession[0].id, { resumeSessionId: fallbackSessionId });
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
          // Preserve any synthetic main-card entries owned by the effect
          // above. Read synthetics inside the builder so the read is
          // atomic with the write — otherwise Effect 1 could insert a new
          // synthetic between our read and the store update, and we'd
          // clobber it.
          setWorktreesForRepo(repo, (existing) => {
            const existingSynthetics = existing.filter(
              (w) => w.isBranchMode && w.id === repoId(repo),
            );
            return [...wts, ...existingSynthetics];
          });

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

    return () => { cancelled = true; };
    // showMainCardReposKey intentionally excluded: Effect 2 owns synthetic
    // lifecycle; Effect 1 only manages real worktrees + branch-mode synthetics
    // and must not re-run on pin/unpin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, selectedReposKey, repoModeKey, setWorktreesForRepo, clearWorktreesForRepo, updateWorktree, restoreTabs, ensureDefaultTabs]);
}

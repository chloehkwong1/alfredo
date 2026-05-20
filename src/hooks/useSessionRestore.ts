import { useEffect, useRef } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { useLayoutStore } from "../stores/layoutStore";
import { listWorktrees, getWorktreeDiffStats, setSyncRepoPaths, findClaudeSession, getActiveBranch, debugLog, reconcileWorktreePorts } from "../api";
import { loadSession } from "../services/SessionPersistence";
import { sessionManager } from "../services/sessionManager";
import { usePrStore } from "../stores/prStore";
import { repoId } from "./useBranchRepos";
import { isAgentTab, normalizeDiffViewMode } from "../types";
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
  const removeWorktree = useWorkspaceStore((s) => s.removeWorktree);
  const updateWorktree = useWorkspaceStore((s) => s.updateWorktree);
  const restoreTabs = useTabStore((s) => s.restoreTabs);
  const updateTab = useTabStore((s) => s.updateTab);
  const ensureDefaultTabs = useTabStore((s) => s.ensureDefaultTabs);
  const markWorktreeSeen = useWorkspaceStore((s) => s.markWorktreeSeen);
  const restoredRepos = useRef(new Set<string>());
  // Tracks one-time restore for synthetic worktrees (branch-mode repos and
  // pinned main cards on worktree-mode repos). Keyed by synthetic worktree
  // id rather than repo path so a worktree-mode repo's pinned-main synthetic
  // is restored independently from its real worktrees.
  const restoredSyntheticIds = useRef(new Set<string>());

  const selectedReposKey = selectedRepos.join(",");
  const repoModeKey = repos.map((r) => `${r.path}:${r.mode}`).join(",");
  const showMainCardReposKey = [...showMainCardRepos].sort().join(",");

  // Restore persisted session state onto a synthetic worktree (main-branch
  // tab in branch-mode repos, or pinned main card on worktree-mode repos).
  // Must run BEFORE setWorktreesForRepo writes the synthetic into the store,
  // for the same reason as the real-worktree Phase 1 below: otherwise
  // AppShell's ensureDefaultTabs effect fires on activation and creates
  // fresh tabs without resumeSessionId, dropping the chat.
  const applySessionToSynthetic = async (repo: string, wt: Worktree) => {
    const session = await loadSession(repo, wt.id);
    if (!session) return;

    // Mutate the synthetic in place — the caller writes this same object into
    // the store via setWorktreesForRepo. buildSyntheticBranchWorktree hardcodes
    // column to "inProgress", so without this the user's manual column move
    // (Done / Review etc., via AgentItem.handleMoveToColumn) resets on reload.
    // Subsequent effect re-runs preserve column via mergeWorktreeState's
    // `column: old.column` carry-over, so applying once on first restore is enough.
    if (session.column) {
      wt.column = session.column;
    }

    restoreTabs(wt.id, session.tabs, session.activeTabId);

    if (session.terminals) {
      for (const [tabId, termData] of Object.entries(session.terminals)) {
        if (termData.scrollback) {
          sessionManager.loadScrollbackOnly(tabId, termData.scrollback, wt.path);
        }
      }
    }

    if (session.diffViewMode) {
      useWorkspaceStore.getState().setDiffViewMode(wt.id, normalizeDiffViewMode(session.diffViewMode));
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

    if (session.annotations?.length) {
      const store = useWorkspaceStore.getState();
      for (const annotation of session.annotations) {
        store.addAnnotation(annotation);
      }
    }

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
      const sessionId = latestSessionId ?? tabsWithSession[0]?.resumeSessionId ?? session.claudeSessionId ?? null;
      if (sessionId) {
        wt.claudeSessionId = sessionId;
        updateTab(wt.id, agentTabs[0].id, { resumeSessionId: sessionId });
      }
    } else if (agentTabs.length > 1) {
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
  };

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
    // Guards async session-restore writes from landing after a newer effect
    // run has changed the expected set of pinned-main synthetics.
    let cancelled = false;
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

    debugLog(
      `[pin-diag] effect2 showMain=${JSON.stringify(showMainCardRepos)} selected=${JSON.stringify(selectedRepos)} expectedIds=${JSON.stringify([...expectedIds])} toAdd=${JSON.stringify(toAdd)} stale=${JSON.stringify([...staleByRepo.keys()])} currentBranchModeIds=${JSON.stringify(currentWorktrees.filter((w) => w.isBranchMode).map((w) => w.id))}`,
    ).catch(() => {});

    // Skip the writes when nothing is dirty. The effect re-fires on
    // `selectedReposKey` / `repoModeKey` changes (most config changes), so
    // bailing out here avoids forcing every `useWorkspaceStore` subscriber
    // to re-render when no synthetic add/remove is actually needed.
    if (staleByRepo.size === 0 && toAdd.length === 0) return;

    // Remove stale synthetics by id. setWorktreesForRepo would no longer
    // drop them — the store now preserves isBranchMode entries through
    // refreshes, so deliberate removals must go through removeWorktree.
    for (const stales of staleByRepo.values()) {
      for (const wt of stales) {
        removeWorktree(wt.id);
      }
    }

    for (const repo of toAdd) {
      const synthetic = buildSyntheticBranchWorktree(repo, null, true);
      const isFirstRestore = !restoredSyntheticIds.current.has(synthetic.id);

      const writeSynthetic = () => {
        if (cancelled) return;
        const latest = useWorkspaceStore.getState().worktrees.filter(
          (wt) => wt.repoPath === repo,
        );
        const existing = latest.find((wt) => wt.id === repoId(repo));
        if (existing && existing.isPinnedMainCard === true) return;
        // Either no entry yet, or a non-pinned (branch-mode-created) entry needs upgrading.
        const withoutExisting = existing ? latest.filter((wt) => wt.id !== existing.id) : latest;
        setWorktreesForRepo(repo, [...withoutExisting, synthetic]);
      };

      if (isFirstRestore) {
        restoredSyntheticIds.current.add(synthetic.id);
        applySessionToSynthetic(repo, synthetic)
          .then(writeSynthetic)
          .catch((e) => {
            console.warn(`[session-restore] Failed to restore synthetic main card for ${repo}:`, e);
            writeSynthetic();
          });
      } else {
        writeSynthetic();
      }
    }

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReposKey, repoModeKey, showMainCardReposKey, setWorktreesForRepo, removeWorktree]);

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
    const wiped: string[] = [];
    for (const loadedRepo of loadedRepoPaths) {
      if (!reposToLoadSet.has(loadedRepo)) {
        clearWorktreesForRepo(loadedRepo);
        wiped.push(loadedRepo);
      }
    }
    debugLog(
      `[pin-diag] effect1-fire repoPath=${repoPath} reposToLoad=${JSON.stringify(reposToLoad)} loaded=${JSON.stringify([...loadedRepoPaths])} wiped=${JSON.stringify(wiped)}`,
    ).catch(() => {});

    const repoModeMap = new Map(repos.map((r) => [r.path, r.mode]));

    for (const repo of reposToLoad) {
      const isBranchMode = repoModeMap.get(repo) === "branch";

      // For branch-mode repos, create a synthetic worktree entry so the rest
      // of the app (TerminalView, ChangesPanel) can find it in the store.
      if (isBranchMode) {
        getActiveBranch(repo).then(async (branch) => {
          if (cancelled) return;
          const synthetic = buildSyntheticBranchWorktree(repo, branch);
          const isFirstRestore = !restoredSyntheticIds.current.has(synthetic.id);
          if (isFirstRestore) {
            restoredSyntheticIds.current.add(synthetic.id);
            try {
              await applySessionToSynthetic(repo, synthetic);
            } catch (e) {
              console.warn(`[session-restore] Failed to restore synthetic for ${repo}:`, e);
            }
            if (cancelled) return;
          }
          setWorktreesForRepo(repo, [synthetic]);
        }).catch((e) => console.warn(`[session-restore] Failed to get active branch for ${repo}:`, e));
        continue;
      }

      listWorktrees(repo).then(async (wts) => {
        if (cancelled) return;
        if (wts.length > 0) {
          // First-restore tracking: tabs, layouts, annotations, pins,
          // scrollback and prStore overrides live in independent stores
          // that survive mode-switches in memory — re-applying them would
          // clobber live state (pin toggles off, annotations duplicate,
          // user-changed layout reverts). They run once per app lifetime.
          //
          // wt-object state (column, archived, archivedAt, unarchivedAt)
          // lives on the Worktree objects themselves, which listWorktrees
          // returns fresh each call. Mode-switch to branch mode replaces
          // these objects with a synthetic, so on switch-back they come
          // back without the auto-archive flag or PR-auto-column. We
          // re-apply that state from disk on every load — that's why the
          // wt-object writes below sit *outside* the isFirstRestore guard.
          const isFirstRestore = !restoredRepos.current.has(repo);
          if (isFirstRestore) {
            restoredRepos.current.add(repo);
            // One-shot per launch: free ports whose worktree is gone. Clears
            // assignments orphaned before the release-key fix and any future
            // stragglers. Fire-and-forget — never blocks restore.
            reconcileWorktreePorts(repo)
              .then((pruned) => {
                if (pruned.length > 0) {
                  console.info(`[session-restore] reconciled ${pruned.length} orphan port(s) for ${repo}`);
                }
              })
              .catch((e) => console.warn(`[session-restore] port reconcile failed for ${repo}:`, e));
          }

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
            // Always-run (see comment above isFirstRestore).
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

            if (!isFirstRestore) continue;

            restoreTabs(wt.id, session.tabs, session.activeTabId);

            // Pre-load terminal scrollback so it's visible before PTY spawns
            if (session.terminals) {
              for (const [tabId, termData] of Object.entries(session.terminals)) {
                if (termData.scrollback) {
                  sessionManager.loadScrollbackOnly(tabId, termData.scrollback, wt.path);
                }
              }
            }

            // Restore per-worktree UI state
            if (session.diffViewMode) {
              useWorkspaceStore.getState().setDiffViewMode(wt.id, normalizeDiffViewMode(session.diffViewMode));
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
            debugLog(
              `[pin-diag] effect1 listWorktrees-resolved repo=${repo} realCount=${wts.length} preservedSynth=${existingSynthetics.length} preservedIds=${JSON.stringify(existingSynthetics.map((w) => w.id))}`,
            ).catch(() => {});
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

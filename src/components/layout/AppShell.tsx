import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sidebar } from "../sidebar/Sidebar";
import { StatusBar } from "./StatusBar";
import { LayoutRenderer } from "./LayoutRenderer";
import { RepoWelcomeScreen } from "../onboarding/RepoWelcomeScreen";
import { AddRepoModal } from "../onboarding/AddRepoModal";
import { RepoSetupDialog } from "../onboarding/RepoSetupDialog";
import { RemoveRepoDialog } from "../sidebar/RemoveRepoDialog";
import { CreateWorktreeDialog } from "../kanban/CreateWorktreeDialog";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { useAppConfig } from "../../hooks/useAppConfig";
import { useDensity } from "../../hooks/useDensity";
import { listWorktrees, ensureAlfredoGitignore, getWorktreeDiffStats, setSyncRepoPath, getConfig } from "../../api";
import { saveAllSessions, loadSession } from "../../services/SessionPersistence";
import { sessionManager } from "../../services/sessionManager";
import logoSvg from "../../assets/logo-cat.svg";
import type { WorkspaceTab, RunScript } from "../../types";

const EMPTY_TABS: WorkspaceTab[] = [];

function AppShell() {
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const activeWorktreeId = useWorkspaceStore((s) => s.activeWorktreeId);
  const worktree = useWorkspaceStore((s) =>
    s.worktrees.find((wt) => wt.id === activeWorktreeId),
  );
  const allTabs = useWorkspaceStore((s) => s.tabs);
  const allActiveTabIds = useWorkspaceStore((s) => s.activeTabId);
  const tabs = activeWorktreeId ? (allTabs[activeWorktreeId] ?? EMPTY_TABS) : EMPTY_TABS;
  const activeTabIdValue = activeWorktreeId ? allActiveTabIds[activeWorktreeId] : undefined;
  const addTab = useWorkspaceStore((s) => s.addTab);
  const annotations = useWorkspaceStore((s) => s.annotations);
  const clearStore = useWorkspaceStore((s) => s.clearStore);

  useDensity();

  const {
    config: _appConfig,
    loading,
    error,
    clearError,
    activeRepo: repoPath,
    repos,
    addRepo,
    removeRepo,
    switchRepo,
    updateRepoMode,
  } = useAppConfig();

  const setWorktrees = useWorkspaceStore((s) => s.setWorktrees);
  const updateWorktree = useWorkspaceStore((s) => s.updateWorktree);
  const restoreTabs = useWorkspaceStore((s) => s.restoreTabs);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const hasRestoredSessions = useRef(false);

  // Dialog state for multi-repo lifecycle
  const [addRepoModalOpen, setAddRepoModalOpen] = useState(false);
  const [setupDialogOpen, setSetupDialogOpen] = useState(false);
  const [setupRepoPath, setSetupRepoPath] = useState<string | null>(null);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [removeRepoPath, setRemoveRepoPath] = useState<string | null>(null);

  const hasWorktrees = worktrees.length > 0;

  // Repo switching handler — save sessions, clear store, switch
  const handleSwitchRepo = useCallback(async (path: string) => {
    setSwitching(true);
    try {
      if (repoPath && hasWorktrees) {
        const state = useWorkspaceStore.getState();
        await saveAllSessions(
          repoPath,
          state.worktrees.map((wt) => wt.id),
          (wtId) => state.tabs[wtId] ?? [],
          (wtId) => state.activeTabId[wtId] ?? "",
          (tabId) => sessionManager.getBufferedOutputBase64(tabId),
        );
      }
      clearStore();
      await switchRepo(path);
    } finally {
      setSwitching(false);
    }
  }, [repoPath, hasWorktrees, switchRepo, clearStore]);

  // When a new repo is selected (from welcome screen or add modal)
  const handleRepoSelected = useCallback(async (path: string) => {
    const result = await addRepo(path);
    if (result) {
      setAddRepoModalOpen(false);
      setSetupRepoPath(path);
      setSetupDialogOpen(true);
    }
  }, [addRepo]);

  // When repo setup is configured
  const handleRepoConfigured = useCallback(async (mode: "worktree" | "branch") => {
    if (!setupRepoPath) return;
    await updateRepoMode(setupRepoPath, mode);
    setSetupDialogOpen(false);
    if (mode === "worktree") {
      setCreateDialogOpen(true);
    }
    setSetupRepoPath(null);
  }, [setupRepoPath, updateRepoMode]);

  // When removing a repo
  const handleRemoveRepo = useCallback(async () => {
    if (!removeRepoPath) return;
    await removeRepo(removeRepoPath);
    setRemoveDialogOpen(false);
    setRemoveRepoPath(null);
  }, [removeRepoPath, removeRepo]);

  // Load worktrees from git when repo path is available
  useEffect(() => {
    if (!repoPath) return;
    setSyncRepoPath(repoPath).catch(() => {});
    listWorktrees(repoPath).then(async (wts) => {
      if (wts.length > 0) {
        // Show sidebar immediately (diff stats load in background)
        setWorktrees(wts);
        // Only set up .alfredo once worktrees exist (don't modify repo during onboarding)
        ensureAlfredoGitignore(repoPath).catch(() => {});

        // Restore saved sessions for each worktree (only once per app lifecycle).
        // The auto-save timer writes session files every 30s, so re-running
        // this would incorrectly mark active sessions as disconnected.
        if (!hasRestoredSessions.current) {
          hasRestoredSessions.current = true;
          for (const wt of wts) {
            const session = await loadSession(repoPath, wt.id);
            if (session) {
              restoreTabs(wt.id, session.tabs, session.activeTabId);

              // Restore layout state if persisted, otherwise init from tabs
              const sessionLayout = (session as any).layout;
              const sessionPanes = (session as any).panes;
              const sessionActivePaneId = (session as any).activePaneId;
              if (sessionLayout && sessionPanes) {
                useLayoutStore.getState().restoreLayout(
                  wt.id, sessionLayout, sessionPanes, sessionActivePaneId ?? Object.keys(sessionPanes)[0],
                );
              } else {
                const tabIds = session.tabs.map((t) => t.id);
                useLayoutStore.getState().initLayout(wt.id, tabIds, session.activeTabId);
              }

              // Auto-resume Claude sessions with --continue (no scrollback replay).
              // The session spawns headless now; TerminalView attaches the DOM later.
              for (const tab of session.tabs) {
                if (tab.type === "claude" && !sessionManager.getSession(tab.id)) {
                  sessionManager.getOrSpawn(
                    tab.id, wt.id, wt.path, "claude", undefined, ["--continue"],
                  ).catch(console.error);
                }
              }
            }
          }

          // Init layout for worktrees without persisted sessions
          for (const wt of wts) {
            if (!useLayoutStore.getState().layout[wt.id]) {
              const wtTabs = useWorkspaceStore.getState().tabs[wt.id] ?? [];
              const wtActiveTabId = useWorkspaceStore.getState().activeTabId[wt.id] ?? "";
              useLayoutStore.getState().initLayout(wt.id, wtTabs.map((t) => t.id), wtActiveTabId);
            }
          }
        }

        // Background: load diff stats per worktree (non-blocking), skip "done" worktrees
        for (const wt of wts) {
          if (wt.column === "done") continue;
          getWorktreeDiffStats(wt.path)
            .then(([additions, deletions]) => {
              updateWorktree(wt.id, { additions, deletions });
            })
            .catch(() => {}); // Worktree path may not exist
        }
      }
    }).catch(() => {
      // Silently ignore — user may not have worktrees yet
    });
  }, [repoPath, setWorktrees, updateWorktree, restoreTabs]);

  // Track whether we just transitioned from onboarding to animate sidebar
  const wasOnboarding = useRef(true);
  const shouldAnimateSidebar = useRef(false);

  // Resolve the active tab object
  const activeTab: WorkspaceTab | undefined = tabs.find((t) => t.id === activeTabIdValue);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (document.activeElement as HTMLElement)?.isContentEditable
      )
        return;

      // Cmd+N: open Create Worktree dialog
      if (event.metaKey && !event.shiftKey && event.key === "n") {
        event.preventDefault();
        setCreateDialogOpen(true);
        return;
      }

      // Cmd+T: new tab of same type as active pane's current tab
      if (event.metaKey && !event.shiftKey && event.key === "t") {
        event.preventDefault();
        if (activeWorktreeId) {
          const layoutState = useLayoutStore.getState();
          const activePaneId = layoutState.activePaneId[activeWorktreeId];
          const pane = activePaneId ? layoutState.panes[activeWorktreeId]?.[activePaneId] : null;
          const paneActiveTab = pane ? tabs.find((t) => t.id === pane.activeTabId) : activeTab;
          const type = (!paneActiveTab || paneActiveTab.type === "changes") ? "claude" : paneActiveTab.type;

          const prevTabs = useWorkspaceStore.getState().tabs[activeWorktreeId] ?? [];
          addTab(activeWorktreeId, type);
          const newTabs = useWorkspaceStore.getState().tabs[activeWorktreeId] ?? [];
          const newTab = newTabs.find((t) => !prevTabs.some((p) => p.id === t.id));
          if (newTab && activePaneId) {
            layoutState.addTabToPane(activeWorktreeId, activePaneId, newTab.id);
          }
        }
        return;
      }

      // Cmd+Shift+C: switch to Changes tab in active pane
      if (event.metaKey && event.shiftKey && event.key === "C") {
        event.preventDefault();
        if (activeWorktreeId) {
          const layoutState = useLayoutStore.getState();
          const activePaneId = layoutState.activePaneId[activeWorktreeId];
          if (activePaneId) {
            const pane = layoutState.panes[activeWorktreeId]?.[activePaneId];
            const changesTabId = pane?.tabIds.find((id) => tabs.find((t) => t.id === id && t.type === "changes"));
            if (changesTabId) {
              layoutState.setPaneActiveTab(activeWorktreeId, activePaneId, changesTabId);
            }
          }
        }
        return;
      }

      // Cmd+Shift+T: switch to first terminal/claude tab in active pane
      if (event.metaKey && event.shiftKey && event.key === "T") {
        event.preventDefault();
        if (activeWorktreeId) {
          const layoutState = useLayoutStore.getState();
          const activePaneId = layoutState.activePaneId[activeWorktreeId];
          if (activePaneId) {
            const pane = layoutState.panes[activeWorktreeId]?.[activePaneId];
            const termTabId = pane?.tabIds.find((id) => tabs.find((t) => t.id === id && t.type !== "changes"));
            if (termTabId) {
              layoutState.setPaneActiveTab(activeWorktreeId, activePaneId, termTabId);
            }
          }
        }
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeWorktreeId, activeTab, tabs, addTab]);

  const hasNoRepos = !loading && repos.length === 0;
  const activeRepoEntry = repos.find((r) => r.path === repoPath);

  // Track onboarding → normal transition for sidebar animation
  useEffect(() => {
    if (loading) return;
    if (worktrees.length === 0) {
      wasOnboarding.current = true;
    } else if (wasOnboarding.current) {
      shouldAnimateSidebar.current = true;
      wasOnboarding.current = false;
    }
  }, [loading, worktrees.length]);

  // Clear animation flag after it's been consumed
  useEffect(() => {
    if (shouldAnimateSidebar.current) {
      shouldAnimateSidebar.current = false;
    }
  });

  // Save sessions on app quit (only when worktrees exist — not during onboarding)
  useEffect(() => {
    if (!repoPath || !hasWorktrees) return;

    const currentWindow = getCurrentWindow();
    const unlisten = currentWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      const state = useWorkspaceStore.getState();
      const worktreeIds = state.worktrees.map((wt) => wt.id);

      await saveAllSessions(
        repoPath,
        worktreeIds,
        (wtId) => state.tabs[wtId] ?? [],
        (wtId) => state.activeTabId[wtId] ?? "",
        (tabId) => sessionManager.getBufferedOutputBase64(tabId),
      );

      await currentWindow.destroy();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [repoPath, hasWorktrees]);

  // Debounced auto-save every 30s (only when worktrees exist)
  useEffect(() => {
    if (!repoPath || !hasWorktrees) return;

    const interval = setInterval(() => {
      const state = useWorkspaceStore.getState();
      const worktreeIds = state.worktrees.map((wt) => wt.id);

      saveAllSessions(
        repoPath,
        worktreeIds,
        (wtId) => state.tabs[wtId] ?? [],
        (wtId) => state.activeTabId[wtId] ?? "",
        (tabId) => sessionManager.getBufferedOutputBase64(tabId),
      ).catch((err) => console.error("Auto-save failed:", err));
    }, 30_000);

    return () => clearInterval(interval);
  }, [repoPath, hasWorktrees]);

  // Server toggle logic (moved from deleted TabBar)
  const runningServer = useWorkspaceStore((s) => s.runningServer);
  const setRunningServer = useWorkspaceStore((s) => s.setRunningServer);
  const [runScript, setRunScript] = useState<RunScript | null>(null);

  // Load run script config (and refresh when settings are saved)
  const [configVersion, setConfigVersion] = useState(0);
  useEffect(() => {
    const handler = () => setConfigVersion((v) => v + 1);
    window.addEventListener("config-changed", handler);
    return () => window.removeEventListener("config-changed", handler);
  }, []);

  useEffect(() => {
    if (!repoPath) return;
    getConfig(repoPath).then((config) => {
      setRunScript(config.runScript ?? null);
    }).catch(() => {});
  }, [repoPath, configVersion]);

  const isServerRunningHere = runningServer?.worktreeId === activeWorktreeId;

  const handleToggleServer = useCallback(async () => {
    if (!activeWorktreeId || !runScript || !repoPath) return;

    const wt = useWorkspaceStore.getState().worktrees.find((w) => w.id === activeWorktreeId);
    if (!wt) return;

    try {
      if (isServerRunningHere) {
        await sessionManager.stopSession(runningServer!.tabId);
        useWorkspaceStore.getState().updateTab(
          runningServer!.worktreeId, runningServer!.tabId, { command: undefined },
        );
        setRunningServer(null);
        return;
      }

      // Stop existing server on another worktree if running (keep tab & logs)
      if (runningServer) {
        await sessionManager.stopSession(runningServer.tabId);
        useWorkspaceStore.getState().updateTab(
          runningServer.worktreeId, runningServer.tabId, { command: undefined },
        );
        setRunningServer(null);
      }

      // Clean up any existing server tab on this worktree so we get a clean mount
      const existingTabs = useWorkspaceStore.getState().tabs[activeWorktreeId] ?? [];
      const oldServerTab = existingTabs.find((t) => t.type === "server");
      if (oldServerTab) {
        await sessionManager.closeSession(oldServerTab.id);
        useWorkspaceStore.getState().removeTab(activeWorktreeId, oldServerTab.id);
      }

      // Create a fresh server tab with the run command stored on it
      const tabId = `${activeWorktreeId}:server:${crypto.randomUUID().slice(0, 8)}`;
      const newTab = {
        id: tabId,
        type: "server" as const,
        label: "Server",
        command: runScript.command,
      };
      const currentTabs = useWorkspaceStore.getState().tabs[activeWorktreeId] ?? [];
      const serverTabs = [...currentTabs];
      const changesIdx = serverTabs.findIndex((t) => t.type === "changes");
      if (changesIdx >= 0) {
        serverTabs.splice(changesIdx, 0, newTab);
      } else {
        serverTabs.push(newTab);
      }
      useWorkspaceStore.setState((state) => ({
        tabs: { ...state.tabs, [activeWorktreeId]: serverTabs },
      }));

      useWorkspaceStore.getState().setActiveTabId(activeWorktreeId, tabId);

      setRunningServer({
        worktreeId: activeWorktreeId,
        sessionId: "",
        tabId,
      });
    } catch (err) {
      console.error("[handleToggleServer] failed:", err);
    }
  }, [activeWorktreeId, runScript, repoPath, isServerRunningHere, runningServer, setRunningServer]);

  // Detect server process exit via heartbeat timeout
  useEffect(() => {
    if (!runningServer) return;

    // Grace period: don't check for the first 5s so TerminalView has time
    // to mount and spawn the PTY session.
    const startTime = Date.now();

    const interval = setInterval(() => {
      if (Date.now() - startTime < 5_000) return;

      const session = sessionManager.getSession(runningServer.tabId);
      if (!session || !session.sessionId) {
        // Session was closed externally
        setRunningServer(null);
        return;
      }
      // Check if heartbeat is stale (>10s without heartbeat = dead)
      if (session.lastHeartbeat > 0 && Date.now() - session.lastHeartbeat > 10_000) {
        setRunningServer(null);
      }
    }, 3_000);

    return () => clearInterval(interval);
  }, [runningServer, setRunningServer]);

  const annotationCount = activeWorktreeId
    ? (annotations[activeWorktreeId]?.length ?? 0)
    : 0;

  // Show cat logo while loading persisted repo path
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <img src={logoSvg} alt="Alfredo" width={72} height={72} className="opacity-70" />
      </div>
    );
  }

  // No repos — show welcome screen
  if (hasNoRepos) {
    return (
      <>
        <RepoWelcomeScreen
          onRepoSelected={handleRepoSelected}
          error={error}
          onClearError={clearError}
        />
        {setupRepoPath && (
          <RepoSetupDialog
            open={setupDialogOpen}
            onOpenChange={setSetupDialogOpen}
            repoPath={setupRepoPath}
            onConfigured={handleRepoConfigured}
          />
        )}
        <CreateWorktreeDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          repoPath={setupRepoPath ?? undefined}
        />
      </>
    );
  }

  // Normal state — worktrees exist, show sidebar
  return (
    <div className="flex h-screen">
      <motion.div
        className={["flex-shrink-0 h-full overflow-hidden", switching ? "opacity-50 pointer-events-none" : ""].join(" ")}
        initial={shouldAnimateSidebar.current ? { x: -260, opacity: 0 } : false}
        animate={{ x: 0, opacity: 1, width: 260 }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      >
        <Sidebar
          hasRepo={!!repoPath}
          repos={repos}
          activeRepo={repoPath}
          onSwitchRepo={handleSwitchRepo}
          onAddRepo={() => setAddRepoModalOpen(true)}
          onRemoveRepo={(path: string) => {
            setRemoveRepoPath(path);
            setRemoveDialogOpen(true);
          }}
          activeRepoMode={activeRepoEntry?.mode ?? "worktree"}
          onEnableWorktrees={() => {
            if (repoPath) {
              setSetupRepoPath(repoPath);
              setSetupDialogOpen(true);
            }
          }}
        />
      </motion.div>
      <div className="flex-1 flex flex-col min-w-0">
        <StatusBar worktree={worktree} annotationCount={annotationCount} />
        <main className="flex-1 min-h-0 relative">
          {activeWorktreeId ? (
            <LayoutRenderer
              worktreeId={activeWorktreeId}
              onToggleServer={handleToggleServer}
              isServerRunning={isServerRunningHere}
              runScriptName={runScript?.name}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-text-tertiary gap-2">
              <span className="text-sm">Select a worktree to get started</span>
              <span className="text-xs">Each worktree gets its own branch, terminal, and agent</span>
            </div>
          )}
        </main>
      </div>

      {/* Multi-repo dialogs */}
      <AddRepoModal
        open={addRepoModalOpen}
        onOpenChange={setAddRepoModalOpen}
        onRepoSelected={handleRepoSelected}
        error={error}
        onClearError={clearError}
      />
      {setupRepoPath && (
        <RepoSetupDialog
          open={setupDialogOpen}
          onOpenChange={setSetupDialogOpen}
          repoPath={setupRepoPath}
          existingGithubToken={null}
          existingLinearKey={null}
          onConfigured={handleRepoConfigured}
        />
      )}
      <RemoveRepoDialog
        open={removeDialogOpen}
        onOpenChange={setRemoveDialogOpen}
        repoName={removeRepoPath?.split("/").filter(Boolean).pop() ?? ""}
        onConfirm={handleRemoveRepo}
      />
      <CreateWorktreeDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        repoPath={repoPath ?? undefined}
      />
    </div>
  );
}

export { AppShell };

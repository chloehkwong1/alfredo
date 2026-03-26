import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { Plus, X, Terminal, Sparkles, GitCompareArrows, GitPullRequest, Play, Square } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../ui/DropdownMenu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sidebar } from "../sidebar/Sidebar";
import { StatusBar } from "./StatusBar";
import { TerminalView } from "../terminal";
import { ChangesView } from "../changes/ChangesView";
import { RepoWelcomeScreen } from "../onboarding/RepoWelcomeScreen";
import { AddRepoModal } from "../onboarding/AddRepoModal";
import { RepoSetupDialog } from "../onboarding/RepoSetupDialog";
import { RemoveRepoDialog } from "../sidebar/RemoveRepoDialog";
import { CreateWorktreeDialog } from "../kanban/CreateWorktreeDialog";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { PrDetailPanel } from "../pr/PrDetailPanel";
import { useAppConfig } from "../../hooks/useAppConfig";
import { useDensity } from "../../hooks/useDensity";
import { listWorktrees, ensureAlfredoGitignore, getWorktreeDiffStats, setSyncRepoPath, getConfig } from "../../api";
import { saveAllSessions, loadSession } from "../../services/SessionPersistence";
import { sessionManager } from "../../services/sessionManager";
import logoSvg from "../../assets/logo-cat.svg";
import type { TabType, WorkspaceTab, RunScript } from "../../types";

const TAB_ICONS: Record<TabType, typeof Terminal> = {
  claude: Sparkles,
  shell: Terminal,
  server: Play,
  changes: GitCompareArrows,
  pr: GitPullRequest,
};

const EMPTY_TABS: WorkspaceTab[] = [];

function TabBar() {
  const activeWorktreeId = useWorkspaceStore((s) => s.activeWorktreeId);
  const allTabs = useWorkspaceStore((s) => s.tabs);
  const allActiveTabIds = useWorkspaceStore((s) => s.activeTabId);
  const tabs = activeWorktreeId ? (allTabs[activeWorktreeId] ?? EMPTY_TABS) : EMPTY_TABS;
  const activeTabId = activeWorktreeId ? allActiveTabIds[activeWorktreeId] : undefined;
  const setActiveTabId = useWorkspaceStore((s) => s.setActiveTabId);
  const addTab = useWorkspaceStore((s) => s.addTab);
  const removeTab = useWorkspaceStore((s) => s.removeTab);
  const ensureDefaultTabs = useWorkspaceStore((s) => s.ensureDefaultTabs);
  // Ensure default tabs exist when worktree is selected
  useEffect(() => {
    if (activeWorktreeId) {
      ensureDefaultTabs(activeWorktreeId);
    }
  }, [activeWorktreeId, ensureDefaultTabs]);

  const runningServer = useWorkspaceStore((s) => s.runningServer);
  const setRunningServer = useWorkspaceStore((s) => s.setRunningServer);
  const { activeRepo: repoPath } = useAppConfig();
  const [runScript, setRunScript] = useState<RunScript | null>(null);

  // Load run script config
  useEffect(() => {
    if (!repoPath) return;
    getConfig(repoPath).then((config) => {
      setRunScript(config.runScript ?? null);
    }).catch(() => {});
  }, [repoPath]);

  const isServerRunningHere = runningServer?.worktreeId === activeWorktreeId;

  const handleToggleServer = useCallback(async () => {
    if (!activeWorktreeId || !runScript || !repoPath) return;

    const worktree = useWorkspaceStore.getState().worktrees.find((wt) => wt.id === activeWorktreeId);
    if (!worktree) return;

    if (isServerRunningHere) {
      // Stop server
      await sessionManager.closeSession(runningServer!.tabId);
      setRunningServer(null);
      return;
    }

    // Stop existing server on another worktree if running
    if (runningServer) {
      await sessionManager.closeSession(runningServer.tabId);
      // Remove the server tab from the old worktree
      const oldTabs = useWorkspaceStore.getState().tabs[runningServer.worktreeId] ?? [];
      const oldServerTab = oldTabs.find((t) => t.id === runningServer.tabId);
      if (oldServerTab) {
        useWorkspaceStore.getState().removeTab(runningServer.worktreeId, runningServer.tabId);
      }
      setRunningServer(null);
    }

    // Check if there's an existing server tab on this worktree we can reuse
    const existingTabs = useWorkspaceStore.getState().tabs[activeWorktreeId] ?? [];
    let serverTab = existingTabs.find((t) => t.type === "server");
    let tabId: string;

    if (serverTab) {
      tabId = serverTab.id;
    } else {
      // Create a new server tab — insert before Changes
      tabId = `${activeWorktreeId}:server:${crypto.randomUUID().slice(0, 8)}`;
      const newTab = { id: tabId, type: "server" as const, label: "Server" };
      const tabs = [...existingTabs];
      const changesIdx = tabs.findIndex((t) => t.type === "changes");
      if (changesIdx >= 0) {
        tabs.splice(changesIdx, 0, newTab);
      } else {
        tabs.push(newTab);
      }
      useWorkspaceStore.setState((state) => ({
        tabs: { ...state.tabs, [activeWorktreeId]: tabs },
      }));
    }

    // Switch to the server tab
    useWorkspaceStore.getState().setActiveTabId(activeWorktreeId, tabId);

    // Spawn PTY with the run script command
    const session = await sessionManager.getOrSpawn(
      tabId,
      activeWorktreeId,
      worktree.path,
      "shell",
      undefined,
      ["-c", runScript.command],
    );

    setRunningServer({
      worktreeId: activeWorktreeId,
      sessionId: session.sessionId,
      tabId,
    });
  }, [activeWorktreeId, runScript, repoPath, isServerRunningHere, runningServer, setRunningServer]);

  function handleAddTab(type: TabType) {
    if (activeWorktreeId) {
      addTab(activeWorktreeId, type);
    }
  }

  function handleCloseTab(e: React.MouseEvent, tabId: string) {
    e.stopPropagation();
    if (activeWorktreeId) {
      removeTab(activeWorktreeId, tabId);
    }
  }

  const claudeCount = tabs.filter((t) => t.type === "claude").length;
  const shellCount = tabs.filter((t) => t.type === "shell").length;
  function canClose(tab: WorkspaceTab) {
    if (tab.type === "changes") return false;
    if (tab.type === "claude" && claudeCount <= 1) return false;
    if (tab.type === "shell" && shellCount <= 1) return false;
    return true;
  }

  const sessionTabs = tabs.filter((t) => t.type !== "changes");
  const changesTab = tabs.find((t) => t.type === "changes");
  const isChangesActive = changesTab?.id === activeTabId;

  return (
    <div className="flex items-center w-full h-10 bg-bg-bar border-b border-border-subtle flex-shrink-0">
      {sessionTabs.map((tab) => {
        const Icon = TAB_ICONS[tab.type];
        const isActive = tab.id === activeTabId;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => activeWorktreeId && setActiveTabId(activeWorktreeId, tab.id)}
            className={[
              "group h-full px-3 text-sm font-medium transition-colors cursor-pointer flex items-center gap-1.5 relative",
              isActive
                ? "text-text-primary"
                : "text-text-tertiary hover:text-text-secondary",
            ].join(" ")}
          >
            <Icon size={14} />
            <span>{tab.label}</span>
            {canClose(tab) && (
              <button
                type="button"
                tabIndex={0}
                aria-label={`Close ${tab.label} tab`}
                onClick={(e) => handleCloseTab(e, tab.id)}
                className="ml-0.5 opacity-0 group-hover:opacity-100 hover:bg-bg-tertiary rounded p-0.5 transition-opacity cursor-pointer"
              >
                <X size={12} />
              </button>
            )}
            {isActive && (
              <motion.div
                layoutId={`tab-underline-${activeWorktreeId}`}
                className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent-primary"
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              />
            )}
          </button>
        );
      })}

      {/* Add tab button */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="h-10 px-2 text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer flex items-center"
          >
            <Plus size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => handleAddTab("claude")}>
            <Sparkles size={14} /> New Claude tab
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => handleAddTab("shell")}>
            <Terminal size={14} /> New terminal tab
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => handleAddTab("pr")}>
            <GitPullRequest size={14} /> PR & Checks
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Server play/stop button */}
      {runScript && (
        <button
          type="button"
          onClick={handleToggleServer}
          title={isServerRunningHere ? `Stop ${runScript.name}` : `Start ${runScript.name}`}
          className={[
            "h-10 px-2 transition-colors cursor-pointer flex items-center",
            isServerRunningHere
              ? "text-green-400 hover:text-red-400"
              : "text-text-tertiary hover:text-text-secondary",
          ].join(" ")}
        >
          {isServerRunningHere ? <Square size={14} /> : <Play size={14} />}
        </button>
      )}

      {/* Spacer pushes Changes to far right */}
      <div className="flex-1" />

      {/* Changes toggle — right-aligned, visually separated */}
      {changesTab && (
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => activeWorktreeId && setActiveTabId(activeWorktreeId, changesTab.id)}
            className={[
              "h-10 px-3 text-sm font-medium transition-colors cursor-pointer flex items-center gap-1.5",
              isChangesActive
                ? "text-text-primary bg-bg-secondary"
                : "text-text-tertiary hover:text-text-secondary",
            ].join(" ")}
          >
            <GitCompareArrows size={14} />
            <span>Changes</span>
          </button>
        </div>
      )}
    </div>
  );
}

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
  const setActiveTabId = useWorkspaceStore((s) => s.setActiveTabId);
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

      // Cmd+T: new tab of same type as current
      if (event.metaKey && !event.shiftKey && event.key === "t") {
        event.preventDefault();
        if (activeWorktreeId && activeTab) {
          const type = activeTab.type === "changes" ? "claude" : activeTab.type;
          addTab(activeWorktreeId, type);
        }
        return;
      }

      // Cmd+Shift+C: switch to Changes tab
      if (event.metaKey && event.shiftKey && event.key === "C") {
        event.preventDefault();
        if (activeWorktreeId) {
          const changesTab = tabs.find((t) => t.type === "changes");
          if (changesTab) setActiveTabId(activeWorktreeId, changesTab.id);
        }
        return;
      }

      // Cmd+Shift+T: switch to first terminal/claude tab
      if (event.metaKey && event.shiftKey && event.key === "T") {
        event.preventDefault();
        if (activeWorktreeId) {
          const termTab = tabs.find((t) => t.type !== "changes");
          if (termTab) setActiveTabId(activeWorktreeId, termTab.id);
        }
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeWorktreeId, activeTab, tabs, addTab, setActiveTabId]);

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

  // Detect server process exit via heartbeat timeout
  const runningServer = useWorkspaceStore((s) => s.runningServer);
  const setRunningServer = useWorkspaceStore((s) => s.setRunningServer);

  useEffect(() => {
    if (!runningServer) return;

    const interval = setInterval(() => {
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
        <TabBar />
        <StatusBar worktree={worktree} annotationCount={annotationCount} />
        <main className="flex-1 min-h-0 relative">
          {(activeTab?.type === "claude" || activeTab?.type === "shell" || activeTab?.type === "server") && (
            <TerminalView
              key={activeTab.id}
              tabId={activeTab.id}
              tabType={activeTab.type}
            />
          )}
          {activeTab?.type === "pr" && activeWorktreeId && worktree && (
            <PrDetailPanel worktree={worktree} repoPath={worktree.path} />
          )}
          {activeTab?.type === "changes" && activeWorktreeId && (
            <ChangesView
              worktreeId={activeWorktreeId}
              repoPath={worktree?.path ?? "."}
            />
          )}
          {!activeWorktreeId && (
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

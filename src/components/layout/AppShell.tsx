import { useState, useEffect, useRef, useCallback } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sidebar } from "../sidebar/Sidebar";
import { StatusBar } from "./StatusBar";
import { RemoteControlBar } from "./RemoteControlBar";
import { LayoutRenderer } from "./LayoutRenderer";
import { WorkspacePanel, WorkspacePanelMinimized } from "../changes/ChangesPanel";

import { RepoWelcomeScreen } from "../onboarding/RepoWelcomeScreen";
import { AddRepoModal } from "../onboarding/AddRepoModal";
import { RepoSetupDialog } from "../onboarding/RepoSetupDialog";
import { RemoveRepoDialog } from "../sidebar/RemoveRepoDialog";
import { CreateWorktreeDialog } from "../kanban/CreateWorktreeDialog";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useTabStore } from "../../stores/tabStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { useAppConfig } from "../../hooks/useAppConfig";
import { useDensity } from "../../hooks/useDensity";
import { useSessionRestore } from "../../hooks/useSessionRestore";
import { useServer } from "../../hooks/useServer";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useUpdater } from "../../hooks/useUpdater";
import { UpdateBanner } from "./UpdateBanner";
import { setRepoColor as setRepoColorApi, getConfig } from "../../api";
import { REPO_COLOR_PALETTE } from "../sidebar/RepoSelector";
import { saveAllSessions } from "../../services/SessionPersistence";
import { sessionManager } from "../../services/sessionManager";
import { usePrStore } from "../../stores/prStore";
import { lifecycleManager } from "../../services/lifecycleManager";
import { CommandPalette } from "../commandPalette/CommandPalette";
import logoSvg from "../../assets/logo-cat.svg";
import type { WorkspaceTab, AppConfig } from "../../types";

const EMPTY_TABS: WorkspaceTab[] = [];
const AUTO_SAVE_INTERVAL_MS = 30_000;

/** Snapshot current workspace + layout state and persist all sessions to disk. */
function collectAndSaveAllSessions(repoPath: string) {
  const state = useWorkspaceStore.getState();
  const tabState = useTabStore.getState();
  const prState = usePrStore.getState();
  const worktreeIds = state.worktrees.map((wt) => wt.id);
  return saveAllSessions(
    repoPath,
    worktreeIds,
    (wtId) => tabState.tabs[wtId] ?? [],
    (wtId) => tabState.activeTabId[wtId] ?? "",
    (tabId) => sessionManager.getBufferedOutputBase64(tabId),
    (wtId) => useLayoutStore.getState().layout[wtId],
    (wtId) => useLayoutStore.getState().panes[wtId],
    (wtId) => useLayoutStore.getState().activePaneId[wtId],
    (wtId) => state.worktrees.find((wt) => wt.id === wtId)?.column,
    (wtId) => state.diffViewMode[wtId],
    (wtId) => prState.columnOverrides[wtId] ?? null,
    (wtId) => prState.prPanelState[wtId],
    (wtId) => state.changesViewMode[wtId],
    (wtId) => state.changesPanelCollapsed[wtId],
    (wtId) => state.seenWorktrees.has(wtId) || undefined,
    (wtId) => state.worktrees.find((wt) => wt.id === wtId)?.claudeSessionId,
    (wtId) => state.worktrees.find((wt) => wt.id === wtId)?.archived || undefined,
    (wtId) => state.worktrees.find((wt) => wt.id === wtId)?.archivedAt,
    (wtId) => state.annotations[wtId]?.length ? state.annotations[wtId] : undefined,
  );
}

function AppShell() {
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const activeWorktreeId = useWorkspaceStore((s) => s.activeWorktreeId);
  const worktree = useWorkspaceStore((s) =>
    s.worktrees.find((wt) => wt.id === activeWorktreeId),
  );
  const allTabs = useTabStore((s) => s.tabs);
  const allActiveTabIds = useTabStore((s) => s.activeTabId);
  const tabs = activeWorktreeId ? (allTabs[activeWorktreeId] ?? EMPTY_TABS) : EMPTY_TABS;
  const activeTabIdValue = activeWorktreeId ? allActiveTabIds[activeWorktreeId] : undefined;
  const annotations = useWorkspaceStore((s) => s.annotations);
  const ensureDefaultTabs = useTabStore((s) => s.ensureDefaultTabs);
  useDensity();
  const updater = useUpdater();

  const {
    loading,
    error,
    clearError,
    activeRepo: repoPath,
    repos,
    addRepo,
    removeRepo,
    updateRepoMode,
    selectedRepos,
    repoColors,
    repoDisplayNames,
    toggleRepo,
    setRepoDisplayName,
    config,
    updateConfig,
  } = useAppConfig();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Listen for command palette's "new worktree" event
  useEffect(() => {
    const handler = () => setCreateDialogOpen(true);
    window.addEventListener("alfredo:create-worktree", handler);
    return () => window.removeEventListener("alfredo:create-worktree", handler);
  }, []);

  // Dialog state for multi-repo lifecycle
  const [addRepoModalOpen, setAddRepoModalOpen] = useState(false);
  const [setupDialogOpen, setSetupDialogOpen] = useState(false);
  const [setupRepoPath, setSetupRepoPath] = useState<string | null>(null);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [removeRepoPath, setRemoveRepoPath] = useState<string | null>(null);
  const [previousRepoConfig, setPreviousRepoConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    if (!setupRepoPath || repos.length <= 1) {
      setPreviousRepoConfig(null);
      return;
    }
    const otherRepo = repos.find((r) => r.path !== setupRepoPath);
    if (otherRepo) {
      getConfig(otherRepo.path)
        .then(setPreviousRepoConfig)
        .catch(() => setPreviousRepoConfig(null));
    }
  }, [setupRepoPath, repos]);

  const hasWorktrees = worktrees.length > 0;

  // Restore sidebar collapsed state from app config (one-time)
  const sidebarRestored = useRef(false);
  useEffect(() => {
    if (!sidebarRestored.current && config?.sidebarCollapsed != null) {
      sidebarRestored.current = true;
      useWorkspaceStore.getState().setSidebarCollapsed(config.sidebarCollapsed);
    }
  }, [config]);

  // Save sidebar collapsed state to config on toggle
  useEffect(() => {
    if (!sidebarRestored.current) return;
    let prev = useWorkspaceStore.getState().sidebarCollapsed;
    const unsub = useWorkspaceStore.subscribe((state) => {
      if (state.sidebarCollapsed !== prev) {
        prev = state.sidebarCollapsed;
        updateConfig({ sidebarCollapsed: state.sidebarCollapsed });
      }
    });
    return unsub;
  }, [updateConfig]);

  // Restore active worktree from app config (one-time)
  const worktreeRestored = useRef(false);
  useEffect(() => {
    if (worktreeRestored.current || !config?.activeWorktreeId) return;
    // Only restore once worktrees have loaded so the ID is valid
    if (worktrees.length > 0) {
      worktreeRestored.current = true;
      const exists = worktrees.some((wt) => wt.id === config.activeWorktreeId);
      if (exists) {
        useWorkspaceStore.getState().setActiveWorktree(config.activeWorktreeId!);
      }
    }
  }, [config, worktrees]);

  // Persist active worktree to config when it changes
  useEffect(() => {
    if (!worktreeRestored.current) return;
    let prev = useWorkspaceStore.getState().activeWorktreeId;
    const unsub = useWorkspaceStore.subscribe((state) => {
      if (state.activeWorktreeId !== prev) {
        prev = state.activeWorktreeId;
        updateConfig({ activeWorktreeId: state.activeWorktreeId });
      }
    });
    return unsub;
  }, [updateConfig]);

  // Extracted hooks
  useSessionRestore(repoPath, selectedRepos);
  const { runScript, isServerRunningHere, handleToggleServer } = useServer(activeWorktreeId);

  const activeTab: WorkspaceTab | undefined = tabs.find((t) => t.id === activeTabIdValue);
  useKeyboardShortcuts(activeWorktreeId, activeTab, tabs, () => setCreateDialogOpen(true), () => {
    window.dispatchEvent(new CustomEvent("alfredo:shortcuts-overlay"));
  }, () => setAddRepoModalOpen(true), () => setCommandPaletteOpen(true));


  // When a new repo is selected (from welcome screen or add modal)
  const handleRepoSelected = useCallback(async (path: string) => {
    const result = await addRepo(path);
    if (result) {
      setAddRepoModalOpen(false);
      setSetupRepoPath(path);
      setSetupDialogOpen(true);
      if (!repoColors?.[path]) {
        const usedColors = Object.values(repoColors ?? {});
        const available = REPO_COLOR_PALETTE.find((c) => !usedColors.includes(c.id));
        const colorId = available?.id ?? REPO_COLOR_PALETTE[repos.length % REPO_COLOR_PALETTE.length].id;
        await setRepoColorApi(path, colorId);
      }
    }
  }, [addRepo, repoColors, repos]);

  // When repo setup is configured
  const handleRepoConfigured = useCallback(async (result: { selectedWorktreeIds: string[] } | "createNew") => {
    if (!setupRepoPath) return;
    await updateRepoMode(setupRepoPath, "worktree");
    setSetupDialogOpen(false);
    if (result === "createNew") {
      setCreateDialogOpen(true);
    }
    // If result has selectedWorktreeIds, worktrees will be loaded by useSessionRestore
    // when the repo becomes active — no extra action needed here.
    setSetupRepoPath(null);
  }, [setupRepoPath, updateRepoMode]);


  // When removing a repo
  const handleRemoveRepo = useCallback(async () => {
    if (!removeRepoPath) return;
    await removeRepo(removeRepoPath);
    setRemoveDialogOpen(false);
    setRemoveRepoPath(null);
  }, [removeRepoPath, removeRepo]);

  // Sync layout when active worktree changes or tabs are added
  useEffect(() => {
    if (!activeWorktreeId) return;
    ensureDefaultTabs(activeWorktreeId);
    lifecycleManager.syncTabsToLayout(activeWorktreeId);
  }, [activeWorktreeId, tabs, ensureDefaultTabs]);

  // Track whether we just transitioned from onboarding to animate sidebar
  const wasOnboarding = useRef(true);
  const shouldAnimateSidebar = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (worktrees.length === 0) {
      wasOnboarding.current = true;
    } else if (wasOnboarding.current) {
      shouldAnimateSidebar.current = true;
      wasOnboarding.current = false;
      requestAnimationFrame(() => {
        shouldAnimateSidebar.current = false;
      });
    }
  }, [loading, worktrees.length]);

  // Save sessions on app quit (only when worktrees exist — not during onboarding)
  useEffect(() => {
    if (!repoPath || !hasWorktrees) return;

    const currentWindow = getCurrentWindow();
    const unlisten = currentWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await collectAndSaveAllSessions(repoPath);
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
      collectAndSaveAllSessions(repoPath)
        .catch((err) => console.error("Auto-save failed:", err));
    }, AUTO_SAVE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [repoPath, hasWorktrees]);

  // Clean up layout state for removed worktrees
  const worktreeIds = worktrees.map((wt) => wt.id);
  useEffect(() => {
    const layoutState = useLayoutStore.getState();
    for (const wtId of Object.keys(layoutState.layout)) {
      if (!worktreeIds.includes(wtId)) {
        layoutState.removeLayout(wtId);
      }
    }
  }, [JSON.stringify(worktreeIds)]);

  const changesPanelCollapsed = useWorkspaceStore((s) => s.changesPanelCollapsed[activeWorktreeId ?? ""] ?? false);
  const setChangesPanelCollapsed = useWorkspaceStore((s) => s.setChangesPanelCollapsed);

  // Cmd+I (Mac) / Ctrl+I (Windows/Linux) to toggle changes panel
  useEffect(() => {
    function handleTogglePanel(e: KeyboardEvent) {
      if (!activeWorktreeId) return;
      if (e.key === "i" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const current = useWorkspaceStore.getState().changesPanelCollapsed[activeWorktreeId] ?? false;
        setChangesPanelCollapsed(activeWorktreeId, !current);
      }
    }
    window.addEventListener("keydown", handleTogglePanel);
    return () => window.removeEventListener("keydown", handleTogglePanel);
  }, [activeWorktreeId, setChangesPanelCollapsed]);

  const annotationCount = activeWorktreeId
    ? (annotations[activeWorktreeId]?.length ?? 0)
    : 0;

  const hasNoRepos = !loading && repos.length === 0;
  const activeRepoEntry = repos.find((r) => r.path === repoPath);

  const sidebarLayout = useDefaultLayout({
    id: "sidebar",
    storage: localStorage,
  });

  const changesPanelLayout = useDefaultLayout({
    id: "changes-panel",
    storage: localStorage,
    panelIds: changesPanelCollapsed ? ["content"] : ["content", "changes"],
  });

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
            previousRepoConfig={null}
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
    <Group
      orientation="horizontal"
      defaultLayout={sidebarLayout.defaultLayout}
      onLayoutChanged={sidebarLayout.onLayoutChanged}
      className="h-screen"
    >
      <Panel defaultSize="320px" minSize="180px" maxSize="480px">
        <div
          className={`h-full overflow-hidden ${shouldAnimateSidebar.current ? "animate-slide-in-left" : ""}`}
        >
          <Sidebar
            hasRepo={!!repoPath}
            repos={repos}
            activeRepo={repoPath}
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
            selectedRepos={selectedRepos.length > 0 ? selectedRepos : (repoPath ? [repoPath] : [])}
            onToggleRepo={toggleRepo}
            repoColors={repoColors ?? {}}
            repoDisplayNames={repoDisplayNames ?? {}}
            onSetRepoDisplayName={setRepoDisplayName}
          />
        </div>
      </Panel>
      <Separator className="w-px bg-border-subtle hover:bg-accent-primary transition-colors data-[resize-handle-active]:bg-accent-primary cursor-col-resize" />
      <Panel minSize="50%">
      <div className="flex-1 flex flex-col min-w-0 h-full">
        <UpdateBanner updater={updater} />
        {activeWorktreeId && <RemoteControlBar worktreeId={activeWorktreeId} />}
        <StatusBar worktree={worktree} annotationCount={annotationCount} />
        <main className="flex-1 min-h-0 relative flex">
          {activeWorktreeId ? (
            <>
              <Group
                orientation="horizontal"
                className="flex-1 min-h-0"
                defaultLayout={changesPanelLayout.defaultLayout}
                onLayoutChanged={changesPanelLayout.onLayoutChanged}
              >
                <Panel id="content" minSize={changesPanelCollapsed ? "100%" : "50%"}>
                  <LayoutRenderer
                    worktreeId={activeWorktreeId}
                    onToggleServer={handleToggleServer}
                    isServerRunning={isServerRunningHere}
                    runScriptName={runScript?.name}
                    runScriptUrl={runScript?.url}
                  />
                </Panel>
                {!changesPanelCollapsed && (
                  <>
                    <Separator className="w-px bg-border-subtle hover:bg-accent-primary transition-colors data-[resize-handle-active]:bg-accent-primary cursor-col-resize" />
                    <Panel id="changes" defaultSize="220px" minSize="140px" maxSize="400px">
                      <WorkspacePanel
                        key={activeWorktreeId}
                        worktreeId={activeWorktreeId}
                        repoPath={worktree?.path ?? "."}
                        onCollapse={() => setChangesPanelCollapsed(activeWorktreeId, true)}
                      />
                    </Panel>
                  </>
                )}
              </Group>
              {changesPanelCollapsed && (
                <WorkspacePanelMinimized
                  worktreeId={activeWorktreeId}
                  repoPath={worktree?.path ?? "."}
                  onExpand={() => setChangesPanelCollapsed(activeWorktreeId, false)}
                />
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full w-full text-text-tertiary gap-3">
              <img src={logoSvg} alt="" className="w-16 h-16 opacity-[0.15] select-none pointer-events-none brightness-0 invert" draggable={false} />
              <div className="flex flex-col items-center gap-1">
                <span className="text-sm">Select a worktree to get started</span>
                <span className="text-xs">Each worktree gets its own branch, terminal, and agent · <kbd className="px-1.5 py-0.5 rounded bg-bg-elevated border border-border-default font-mono text-[11px]">⌘N</kbd> to create new worktree</span>
              </div>
            </div>
          )}
        </main>
      </div>
      </Panel>

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
          existingGithubToken={previousRepoConfig?.githubToken ?? null}
          existingLinearKey={previousRepoConfig?.linearApiKey ?? null}
          previousRepoConfig={previousRepoConfig}
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
        repos={repos}
        selectedRepos={selectedRepos.length > 0 ? selectedRepos : (repoPath ? [repoPath] : [])}
        repoColors={repoColors ?? {}}
        defaultRepoPath={
          worktrees.find((w) => w.id === activeWorktreeId)?.repoPath
          ?? (selectedRepos.length > 0 ? selectedRepos[0] : undefined)
          ?? repoPath
          ?? undefined
        }
      />
      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
      />
    </Group>
  );
}

export { AppShell };

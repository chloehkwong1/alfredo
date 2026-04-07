import { useEffect, useRef } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
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
import { useAppConfig } from "../../hooks/useAppConfig";
import { useDensity } from "../../hooks/useDensity";
import { useSessionRestore } from "../../hooks/useSessionRestore";
import { useServer } from "../../hooks/useServer";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useUpdater } from "../../hooks/useUpdater";
import { UpdateBanner } from "./UpdateBanner";
import { useAgentStore } from "../../stores/agentStore";
import { useRepoDialogs } from "./useRepoDialogs";
import { useSessionAutoSave } from "./useSessionAutoSave";
import { useStatePersistence } from "./useStatePersistence";
import { lifecycleManager } from "../../services/lifecycleManager";
import { CommandPalette } from "../commandPalette/CommandPalette";
import { EmptyWorkspaceView } from "./EmptyWorkspaceView";
import logoSvg from "../../assets/logo-cat.svg";
import type { WorkspaceTab } from "../../types";

const EMPTY_TABS: WorkspaceTab[] = [];

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
  const refreshAgents = useAgentStore((s) => s.refresh);

  useEffect(() => {
    refreshAgents();
  }, [refreshAgents]);

  const {
    loading,
    error,
    clearError,
    activeRepo: repoPath,
    repos,
    addRepo,
    removeRepo,
    updateRepoMode,
    switchRepo,
    selectedRepos,
    repoColors,
    repoDisplayNames,
    toggleRepo,
    setRepoDisplayName,
    config,
    updateConfig,
  } = useAppConfig();

  const {
    createDialogOpen,
    setCreateDialogOpen,
    commandPaletteOpen,
    setCommandPaletteOpen,
    addRepoModalOpen,
    setAddRepoModalOpen,
    setupDialogOpen,
    setSetupDialogOpen,
    setupRepoPath,
    removeDialogOpen,
    setRemoveDialogOpen,
    removeRepoPath,
    setRemoveRepoPath,
    previousRepoConfig,
    handleRepoSelected,
    handleRepoConfigured,
    handleRemoveRepo,
  } = useRepoDialogs({ repos, repoColors, addRepo, removeRepo, updateRepoMode, switchRepo });

  const hasWorktrees = worktrees.length > 0;
  useSessionAutoSave(repoPath, hasWorktrees);

  useStatePersistence(config, worktrees, activeWorktreeId, updateConfig);

  // Extracted hooks
  useSessionRestore(repoPath, selectedRepos, repos);
  const { runScript, isServerRunningHere, handleToggleServer } = useServer(activeWorktreeId);

  const activeTab: WorkspaceTab | undefined = tabs.find((t) => t.id === activeTabIdValue);
  useKeyboardShortcuts(activeWorktreeId, activeTab, tabs, () => setCreateDialogOpen(true), () => {
    window.dispatchEvent(new CustomEvent("alfredo:shortcuts-overlay"));
  }, () => setAddRepoModalOpen(true), () => setCommandPaletteOpen(true));


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
  const effectiveSelectedRepos = selectedRepos.length > 0 ? selectedRepos : (repoPath ? [repoPath] : []);
  const hasWorktreeRepos = repos.some(
    (r) => effectiveSelectedRepos.includes(r.path) && r.mode === "worktree",
  );

  // For branch-mode repos, extract the repo path from the ID ("branch::/path/to/repo")
  const activeRepoPath = worktree?.path
    ?? (activeWorktreeId?.startsWith("branch::") ? activeWorktreeId.slice(8) : null);

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
            selectedRepos={selectedRepos.length > 0 ? selectedRepos : (repoPath ? [repoPath] : [])}
            onToggleRepo={toggleRepo}
            repoColors={repoColors ?? {}}
            repoDisplayNames={repoDisplayNames ?? {}}
            onSetRepoDisplayName={setRepoDisplayName}
            onCheckForUpdates={updater.checkNow}
            checkingForUpdates={updater.checking}
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
                    hasWorktreeRepos={hasWorktreeRepos}
                  />
                </Panel>
                {!changesPanelCollapsed && (
                  <>
                    <Separator className="w-px bg-border-subtle hover:bg-accent-primary transition-colors data-[resize-handle-active]:bg-accent-primary cursor-col-resize" />
                    <Panel id="changes" defaultSize="220px" minSize="140px" maxSize="400px">
                      <WorkspacePanel
                        key={activeWorktreeId}
                        worktreeId={activeWorktreeId}
                        repoPath={activeRepoPath ?? "."}
                        onCollapse={() => setChangesPanelCollapsed(activeWorktreeId, true)}
                      />
                    </Panel>
                  </>
                )}
              </Group>
              {changesPanelCollapsed && (
                <WorkspacePanelMinimized
                  worktreeId={activeWorktreeId}
                  repoPath={activeRepoPath ?? "."}
                  onExpand={() => setChangesPanelCollapsed(activeWorktreeId, false)}
                />
              )}
            </>
          ) : (
            <EmptyWorkspaceView hasWorktreeRepos={hasWorktreeRepos} hasRepos={repos.length > 0} />
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

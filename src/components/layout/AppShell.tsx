import { useEffect, useRef, useState } from "react";
import { ChevronsRight } from "lucide-react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { Sidebar } from "../sidebar/Sidebar";
import { StatusBar } from "./StatusBar";
import { RemoteControlBar } from "./RemoteControlBar";
import { LayoutRenderer } from "./LayoutRenderer";
import { SectionErrorBoundary } from "../shared/SectionErrorBoundary";
import { WorkspacePanel, WorkspacePanelMinimized } from "../changes/ChangesPanel";

import { RepoWelcomeScreen } from "../onboarding/RepoWelcomeScreen";
import { AddRepoModal } from "../onboarding/AddRepoModal";
import { RepoSetupDialog } from "../onboarding/RepoSetupDialog";
import { QuickStartPanel } from "../onboarding/QuickStartPanel";
import { RemoveRepoDialog } from "../sidebar/RemoveRepoDialog";
import { CreateWorktreeDialog } from "../kanban/CreateWorktreeDialog";
import { OpenIssueRepoPicker } from "../kanban/OpenIssueRepoPicker";
import { GlobalSettingsDialog } from "../settings/GlobalSettingsDialog";
import { WorkspaceSettingsDialog } from "../settings/WorkspaceSettingsDialog";
import { ShortcutsOverlay } from "../settings/ShortcutsOverlay";
import { OPEN_WORKSPACE_SETTINGS_EVENT } from "../settings/openWorkspaceSettings";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useTabStore } from "../../stores/tabStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { tabSwitchTarget } from "../../lib/paneTabLayout";
import { useAppConfig } from "../../hooks/useAppConfig";
import { useDensity } from "../../hooks/useDensity";
import { useSessionRestore } from "../../hooks/useSessionRestore";
import { useServer, useStaleServerCleanup, useServerReconciliation } from "../../hooks/useServer";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useUpdater } from "../../hooks/useUpdater";
import { useLinearOpenIssue } from "../../hooks/useLinearOpenIssue";
import { UpdateBanner } from "./UpdateBanner";
import { useAgentStore } from "../../stores/agentStore";
import { useRepoDialogs } from "./useRepoDialogs";
import { useSessionAutoSave } from "./useSessionAutoSave";
import { useStatePersistence } from "./useStatePersistence";
import { lifecycleManager } from "../../services/lifecycleManager";
import { CommandPalette } from "../commandPalette/CommandPalette";
import { EmptyWorkspaceView } from "./EmptyWorkspaceView";
import { CatLogo } from "../ui/CatLogo";
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
  useLinearOpenIssue();
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
    repoShortLabels,
    worktreeLabels,
    toggleRepo,
    setRepoDisplayName,
    setRepoShortLabel,
    setRepoColor,
    setWorktreeLabel,
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

  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<
    "general" | "terminal" | "agent" | "notifications" | "integrations" | "comment-chips" | null
  >(null);
  const [settingsInitialFocusIndex, setSettingsInitialFocusIndex] = useState<number | null>(null);
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const [workspaceSettingsRepoOverride, setWorkspaceSettingsRepoOverride] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    const openGlobal = () => setGlobalSettingsOpen(true);
    const deepLink = (e: Event) => {
      const ce = e as CustomEvent<{ section?: string; focusIndex?: number }>;
      const section = ce.detail?.section;
      if (section === "comment-chips") {
        setSettingsInitialSection("comment-chips");
        setSettingsInitialFocusIndex(
          typeof ce.detail?.focusIndex === "number" ? ce.detail.focusIndex : null,
        );
        setGlobalSettingsOpen(true);
      }
    };
    const openWorkspace = (e: Event) => {
      const ce = e as CustomEvent<{ repoPath?: string }>;
      if (ce.detail?.repoPath) setWorkspaceSettingsRepoOverride(ce.detail.repoPath);
      setWorkspaceSettingsOpen(true);
    };
    const openShortcuts = () => setShortcutsOpen(true);
    window.addEventListener("alfredo:settings-open", openGlobal);
    window.addEventListener("open-global-settings", deepLink);
    window.addEventListener(OPEN_WORKSPACE_SETTINGS_EVENT, openWorkspace);
    window.addEventListener("alfredo:shortcuts-overlay", openShortcuts);
    return () => {
      window.removeEventListener("alfredo:settings-open", openGlobal);
      window.removeEventListener("open-global-settings", deepLink);
      window.removeEventListener(OPEN_WORKSPACE_SETTINGS_EVENT, openWorkspace);
      window.removeEventListener("alfredo:shortcuts-overlay", openShortcuts);
    };
  }, []);

  const hasWorktrees = worktrees.length > 0;
  useSessionAutoSave(repoPath, hasWorktrees);

  useStatePersistence(config, worktrees, activeWorktreeId, updateConfig);

  // Extracted hooks
  useSessionRestore(repoPath, selectedRepos, repos, config?.showMainCardRepos ?? []);
  const { runScript, isServerRunningHere, handleToggleServer } = useServer(activeWorktreeId);
  useStaleServerCleanup();
  useServerReconciliation();

  const activeTab: WorkspaceTab | undefined = tabs.find((t) => t.id === activeTabIdValue);
  useKeyboardShortcuts(activeWorktreeId, activeTab, tabs, () => setCreateDialogOpen(true), () => {
    window.dispatchEvent(new CustomEvent("alfredo:shortcuts-overlay"));
  }, () => setAddRepoModalOpen(true), () => setCommandPaletteOpen(true));


  // Inject default tabs only on worktree switch — not on every tabs change.
  // Otherwise an explicit close of the last shell/agent tab would be undone
  // by the auto-restore loop, making the close button feel broken.
  useEffect(() => {
    if (!activeWorktreeId) return;
    ensureDefaultTabs(activeWorktreeId);
  }, [activeWorktreeId, ensureDefaultTabs]);

  // Keep the layout in sync with tab additions/removals (orphan tabs into
  // panes, prune stale ids). Runs on tab changes too.
  useEffect(() => {
    if (!activeWorktreeId) return;
    lifecycleManager.syncTabsToLayout(activeWorktreeId);
  }, [activeWorktreeId, tabs]);

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
  const sidebarCollapsed = useWorkspaceStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar);

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

  // Cmd+J (Mac) / Ctrl+J (Windows/Linux) to toggle active pane between agent and diff tabs
  useEffect(() => {
    function handleTabToggle(e: KeyboardEvent) {
      if (!activeWorktreeId) return;
      if (e.key.toLowerCase() === "j" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const layout = useLayoutStore.getState();
        const paneId = layout.activePaneId[activeWorktreeId];
        const pane = paneId ? layout.panes[activeWorktreeId]?.[paneId] : undefined;
        if (!paneId || !pane) return;
        const tabs = useTabStore.getState().tabs[activeWorktreeId] ?? [];
        const paneTabs = pane.tabIds
          .map((id) => tabs.find((t) => t.id === id))
          .filter((t): t is NonNullable<typeof t> => t != null);
        const target = tabSwitchTarget(
          paneTabs,
          pane.activeTabId,
          layout.lastFocusedAgentTabId[activeWorktreeId],
          layout.lastFocusedNonAgentTabId[activeWorktreeId],
        );
        if (!target) return;
        layout.setPaneActiveTab(activeWorktreeId, paneId, target);
        layout.setActivePaneId(activeWorktreeId, paneId);
        useTabStore.getState().setActiveTabId(activeWorktreeId, target);
      }
    }
    window.addEventListener("keydown", handleTabToggle);
    return () => window.removeEventListener("keydown", handleTabToggle);
  }, [activeWorktreeId]);

  const annotationCount = activeWorktreeId
    ? (annotations[activeWorktreeId]?.length ?? 0)
    : 0;

  const hasNoRepos = !loading && repos.length === 0;
  const effectiveSelectedRepos = selectedRepos.length > 0 ? selectedRepos : (repoPath ? [repoPath] : []);
  const hasWorktreeRepos = repos.some(
    (r) => effectiveSelectedRepos.includes(r.path) && r.mode === "worktree",
  );

  const defaultRepoPath =
    worktrees.find((w) => w.id === activeWorktreeId)?.repoPath
    ?? effectiveSelectedRepos[0]
    ?? repoPath
    ?? undefined;

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
        <CatLogo aria-label="Alfredo" width={72} height={72} className="opacity-70 text-text-tertiary" />
      </div>
    );
  }

  // No repos — show welcome screen
  if (hasNoRepos) {
    return (
      <>
        <SectionErrorBoundary name="RepoWelcomeScreen">
          <RepoWelcomeScreen
            onRepoSelected={handleRepoSelected}
            error={error}
            onClearError={clearError}
          />
        </SectionErrorBoundary>
        {setupRepoPath && (
          <SectionErrorBoundary
            name="RepoSetupDialog (welcome)"
            variant="inline"
            onReset={() => setSetupDialogOpen(false)}
          >
            <RepoSetupDialog
              open={setupDialogOpen}
              onOpenChange={setSetupDialogOpen}
              repoPath={setupRepoPath}
              previousRepoConfig={null}
              repoColors={repoColors ?? {}}
              repoDisplayNames={repoDisplayNames ?? {}}
              repoShortLabels={repoShortLabels ?? {}}
              onSetRepoDisplayName={setRepoDisplayName}
              onSetRepoShortLabel={setRepoShortLabel}
              onSetRepoColor={setRepoColor}
              onConfigured={handleRepoConfigured}
            />
          </SectionErrorBoundary>
        )}
        <SectionErrorBoundary
          name="CreateWorktreeDialog (welcome)"
          variant="inline"
          onReset={() => setCreateDialogOpen(false)}
        >
          <CreateWorktreeDialog
            open={createDialogOpen}
            onOpenChange={setCreateDialogOpen}
            repoPath={setupRepoPath ?? undefined}
          />
        </SectionErrorBoundary>
      </>
    );
  }

  // Normal state — worktrees exist, show sidebar
  const sidebarPanel = (
    <>
      <Panel defaultSize="320px" minSize="180px" maxSize="480px">
        <div
          className={`h-full overflow-hidden ${shouldAnimateSidebar.current ? "animate-slide-in-left" : ""}`}
        >
          <SectionErrorBoundary name="Sidebar">
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
              repoShortLabels={repoShortLabels ?? {}}
              worktreeLabels={worktreeLabels ?? {}}
              onSetWorktreeLabel={setWorktreeLabel}
            />
          </SectionErrorBoundary>
        </div>
      </Panel>
      <Separator className="w-px bg-border-subtle hover:bg-accent-primary transition-colors data-[resize-handle-active]:bg-accent-primary cursor-col-resize" />
    </>
  );

  const mainContent = (
      <div className="flex-1 flex flex-col min-w-0 h-full">
        <SectionErrorBoundary name="UpdateBanner" variant="inline">
          <UpdateBanner updater={updater} />
        </SectionErrorBoundary>
        {activeWorktreeId && (
          <SectionErrorBoundary name="RemoteControlBar" variant="inline">
            <RemoteControlBar worktreeId={activeWorktreeId} />
          </SectionErrorBoundary>
        )}
        <SectionErrorBoundary name="StatusBar" variant="inline">
          <StatusBar worktree={worktree} annotationCount={annotationCount} />
        </SectionErrorBoundary>
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
                    assignedPort={worktree?.assignedPort}
                    hasWorktreeRepos={hasWorktreeRepos}
                  />
                </Panel>
                {!changesPanelCollapsed && (
                  <>
                    <Separator className="w-px bg-border-subtle hover:bg-accent-primary transition-colors data-[resize-handle-active]:bg-accent-primary cursor-col-resize" />
                    <Panel id="changes" defaultSize="220px" minSize="140px" maxSize="400px">
                      <SectionErrorBoundary name="WorkspacePanel">
                        <WorkspacePanel
                          key={activeWorktreeId}
                          worktreeId={activeWorktreeId}
                          repoPath={activeRepoPath ?? "."}
                          onCollapse={() => setChangesPanelCollapsed(activeWorktreeId, true)}
                        />
                      </SectionErrorBoundary>
                    </Panel>
                  </>
                )}
              </Group>
              {changesPanelCollapsed && (
                <SectionErrorBoundary name="WorkspacePanelMinimized" variant="inline">
                  <WorkspacePanelMinimized
                    worktreeId={activeWorktreeId}
                    repoPath={activeRepoPath ?? "."}
                    onExpand={() => setChangesPanelCollapsed(activeWorktreeId, false)}
                  />
                </SectionErrorBoundary>
              )}
            </>
          ) : (
            <SectionErrorBoundary name="EmptyWorkspaceView">
              <EmptyWorkspaceView hasWorktreeRepos={hasWorktreeRepos} hasRepos={repos.length > 0} />
            </SectionErrorBoundary>
          )}
        </main>
      </div>
  );

  const dialogs = (
    <>
      {/* Multi-repo dialogs */}
      <SectionErrorBoundary
        name="AddRepoModal"
        variant="inline"
        onReset={() => setAddRepoModalOpen(false)}
      >
        <AddRepoModal
          open={addRepoModalOpen}
          onOpenChange={setAddRepoModalOpen}
          onRepoSelected={handleRepoSelected}
          error={error}
          onClearError={clearError}
        />
      </SectionErrorBoundary>
      {setupRepoPath && (
        <SectionErrorBoundary
          name="RepoSetupDialog"
          variant="inline"
          onReset={() => setSetupDialogOpen(false)}
        >
          <RepoSetupDialog
            open={setupDialogOpen}
            onOpenChange={setSetupDialogOpen}
            repoPath={setupRepoPath}
            existingGithubToken={previousRepoConfig?.githubToken ?? null}
            previousRepoConfig={previousRepoConfig}
            repoColors={repoColors ?? {}}
            repoDisplayNames={repoDisplayNames ?? {}}
            repoShortLabels={repoShortLabels ?? {}}
            onSetRepoDisplayName={setRepoDisplayName}
            onSetRepoShortLabel={setRepoShortLabel}
            onSetRepoColor={setRepoColor}
            onConfigured={handleRepoConfigured}
          />
        </SectionErrorBoundary>
      )}
      <SectionErrorBoundary
        name="RemoveRepoDialog"
        variant="inline"
        onReset={() => setRemoveDialogOpen(false)}
      >
        <RemoveRepoDialog
          open={removeDialogOpen}
          onOpenChange={setRemoveDialogOpen}
          repoName={removeRepoPath?.split("/").filter(Boolean).pop() ?? ""}
          onConfirm={handleRemoveRepo}
        />
      </SectionErrorBoundary>
      <SectionErrorBoundary
        name="CreateWorktreeDialog"
        variant="inline"
        onReset={() => setCreateDialogOpen(false)}
      >
        <CreateWorktreeDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          repoPath={repoPath ?? undefined}
          repos={repos}
          repoColors={repoColors ?? {}}
          selectedRepos={effectiveSelectedRepos}
          defaultRepoPath={defaultRepoPath}
        />
      </SectionErrorBoundary>
      <OpenIssueRepoPicker
        repos={repos.filter((r) => r.mode === "worktree")}
        repoColors={repoColors ?? {}}
        repoDisplayNames={repoDisplayNames ?? {}}
        defaultRepoPath={defaultRepoPath}
      />
      <GlobalSettingsDialog
        open={globalSettingsOpen}
        onOpenChange={(open) => {
          setGlobalSettingsOpen(open);
          if (!open) {
            setSettingsInitialSection(null);
            setSettingsInitialFocusIndex(null);
          }
        }}
        onCheckForUpdates={updater.checkNow}
        checkingForUpdates={updater.checking}
        upToDate={updater.upToDate}
        initialSection={settingsInitialSection}
        initialFocusIndex={settingsInitialFocusIndex}
        onDeepLinkConsumed={() => {
          // Keep focusIndex around until CommentChipsSettings consumes it
          // but clear section so re-opening manually doesn't re-trigger.
          setSettingsInitialSection(null);
        }}
      />
      <ShortcutsOverlay open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <WorkspaceSettingsDialog
        open={workspaceSettingsOpen}
        onOpenChange={(open) => {
          setWorkspaceSettingsOpen(open);
          if (!open) setWorkspaceSettingsRepoOverride(null);
        }}
        repoPath={workspaceSettingsRepoOverride || repoPath || "."}
        repos={repos}
        repoColors={repoColors ?? {}}
        repoDisplayNames={repoDisplayNames ?? {}}
        repoShortLabels={repoShortLabels ?? {}}
        onSetRepoDisplayName={setRepoDisplayName}
        onSetRepoShortLabel={setRepoShortLabel}
        onSetRepoColor={setRepoColor}
        defaultRepoPath={workspaceSettingsRepoOverride ?? defaultRepoPath}
      />
      <SectionErrorBoundary
        name="CommandPalette"
        variant="inline"
        onReset={() => setCommandPaletteOpen(false)}
      >
        <CommandPalette
          open={commandPaletteOpen}
          onOpenChange={setCommandPaletteOpen}
        />
      </SectionErrorBoundary>
      <QuickStartPanel />
    </>
  );

  if (sidebarCollapsed) {
    return (
      <div className="flex h-screen">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Show sidebar (⌘B)"
          className="flex flex-col items-center w-8 h-full bg-bg-primary border-r border-border-default hover:bg-bg-hover transition-colors py-3 flex-shrink-0 cursor-pointer"
        >
          <ChevronsRight size={14} className="text-text-tertiary flex-shrink-0" />
        </button>
        {mainContent}
        {dialogs}
      </div>
    );
  }

  return (
    <Group
      orientation="horizontal"
      defaultLayout={sidebarLayout.defaultLayout}
      onLayoutChanged={sidebarLayout.onLayoutChanged}
      className="h-screen"
    >
      {sidebarPanel}
      <Panel minSize="50%">{mainContent}</Panel>
      {dialogs}
    </Group>
  );
}

export { AppShell };

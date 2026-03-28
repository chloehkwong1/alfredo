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
import { useSessionRestore } from "../../hooks/useSessionRestore";
import { useServer } from "../../hooks/useServer";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { setRepoColor as setRepoColorApi } from "../../api";
import { REPO_COLOR_PALETTE } from "../sidebar/RepoSelector";
import { saveAllSessions } from "../../services/SessionPersistence";
import { sessionManager } from "../../services/sessionManager";
import { lifecycleManager } from "../../services/lifecycleManager";
import logoSvg from "../../assets/logo-cat.svg";
import type { WorkspaceTab } from "../../types";

const EMPTY_TABS: WorkspaceTab[] = [];
const AUTO_SAVE_INTERVAL_MS = 30_000;

/** Snapshot current workspace + layout state and persist all sessions to disk. */
function collectAndSaveAllSessions(repoPath: string) {
  const state = useWorkspaceStore.getState();
  const worktreeIds = state.worktrees.map((wt) => wt.id);
  return saveAllSessions(
    repoPath,
    worktreeIds,
    (wtId) => state.tabs[wtId] ?? [],
    (wtId) => state.activeTabId[wtId] ?? "",
    (tabId) => sessionManager.getBufferedOutputBase64(tabId),
    (wtId) => useLayoutStore.getState().layout[wtId],
    (wtId) => useLayoutStore.getState().panes[wtId],
    (wtId) => useLayoutStore.getState().activePaneId[wtId],
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
  const annotations = useWorkspaceStore((s) => s.annotations);
  const ensureDefaultTabs = useWorkspaceStore((s) => s.ensureDefaultTabs);
  useDensity();

  const {
    loading,
    error,
    clearError,
    activeRepo: repoPath,
    repos,
    addRepo,
    removeRepo,
    switchRepo,
    updateRepoMode,
    selectedRepos,
    repoColors,
    repoDisplayNames,
    toggleRepo,
    setRepoDisplayName,
  } = useAppConfig();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  // Dialog state for multi-repo lifecycle
  const [addRepoModalOpen, setAddRepoModalOpen] = useState(false);
  const [setupDialogOpen, setSetupDialogOpen] = useState(false);
  const [setupRepoPath, setSetupRepoPath] = useState<string | null>(null);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [removeRepoPath, setRemoveRepoPath] = useState<string | null>(null);

  const hasWorktrees = worktrees.length > 0;

  // Extracted hooks
  useSessionRestore(repoPath, selectedRepos);
  const { runScript, isServerRunningHere, handleToggleServer } = useServer(activeWorktreeId, repoPath);

  const activeTab: WorkspaceTab | undefined = tabs.find((t) => t.id === activeTabIdValue);
  useKeyboardShortcuts(activeWorktreeId, activeTab, tabs, () => setCreateDialogOpen(true));

  // Repo switching handler — save sessions, switch active repo (worktrees persist)
  const handleSwitchRepo = useCallback(async (path: string) => {
    setSwitching(true);
    try {
      if (repoPath && hasWorktrees) {
        await collectAndSaveAllSessions(repoPath);
      }
      await switchRepo(path);
    } finally {
      setSwitching(false);
    }
  }, [repoPath, hasWorktrees, switchRepo]);

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

  const annotationCount = activeWorktreeId
    ? (annotations[activeWorktreeId]?.length ?? 0)
    : 0;

  const hasNoRepos = !loading && repos.length === 0;
  const activeRepoEntry = repos.find((r) => r.path === repoPath);

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
        initial={shouldAnimateSidebar.current ? { x: -320, opacity: 0 } : false}
        animate={{ x: 0, opacity: 1, width: 320 }}
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
          selectedRepos={selectedRepos.length > 0 ? selectedRepos : (repoPath ? [repoPath] : [])}
          onToggleRepo={toggleRepo}
          repoColors={repoColors ?? {}}
          repoDisplayNames={repoDisplayNames ?? {}}
          onSetRepoDisplayName={setRepoDisplayName}
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

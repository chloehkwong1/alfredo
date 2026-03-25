import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Plus, X, Terminal, Sparkles, GitCompareArrows } from "lucide-react";
import { Sidebar } from "../sidebar/Sidebar";
import { StatusBar } from "./StatusBar";
import { TerminalView } from "../terminal";
import { ChangesView } from "../changes/ChangesView";
import { OnboardingScreen } from "../onboarding/OnboardingScreen";
import { CreateWorktreeDialog } from "../kanban/CreateWorktreeDialog";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useRepoPath } from "../../hooks/useRepoPath";
import logoSvg from "../../assets/logo-cat.svg";
import type { TabType, WorkspaceTab } from "../../types";

const TAB_ICONS: Record<TabType, typeof Terminal> = {
  claude: Sparkles,
  shell: Terminal,
  changes: GitCompareArrows,
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
  const [menuOpen, setMenuOpen] = useState(false);

  // Ensure default tabs exist when worktree is selected
  useEffect(() => {
    if (activeWorktreeId) {
      ensureDefaultTabs(activeWorktreeId);
    }
  }, [activeWorktreeId, ensureDefaultTabs]);

  function handleAddTab(type: TabType) {
    if (activeWorktreeId) {
      addTab(activeWorktreeId, type);
    }
    setMenuOpen(false);
  }

  function handleCloseTab(e: React.MouseEvent, tabId: string) {
    e.stopPropagation();
    if (activeWorktreeId) {
      removeTab(activeWorktreeId, tabId);
    }
  }

  const nonChangeTabs = tabs.filter((t) => t.type !== "changes");
  const canClose = nonChangeTabs.length > 1;

  return (
    <div className="flex items-center h-9 bg-bg-secondary border-b border-border-default flex-shrink-0">
      {tabs.map((tab) => {
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
                ? "text-text-primary border-b-2 border-b-accent-primary"
                : "text-text-tertiary hover:text-text-secondary border-b-2 border-b-transparent",
            ].join(" ")}
          >
            <Icon size={13} />
            <span>{tab.label}</span>
            {canClose && tab.type !== "changes" && (
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => handleCloseTab(e, tab.id)}
                className="ml-0.5 opacity-0 group-hover:opacity-100 hover:bg-bg-tertiary rounded p-0.5 transition-opacity"
              >
                <X size={12} />
              </span>
            )}
          </button>
        );
      })}

      {/* Add tab button */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className="h-9 px-2 text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer flex items-center"
        >
          <Plus size={16} />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute top-full left-0 mt-1 bg-bg-secondary border border-border-default rounded-[var(--radius-md)] shadow-lg py-1 z-20 min-w-[160px]">
              <button
                type="button"
                onClick={() => handleAddTab("claude")}
                className="w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-tertiary flex items-center gap-2 cursor-pointer"
              >
                <Sparkles size={14} />
                New Claude tab
              </button>
              <button
                type="button"
                onClick={() => handleAddTab("shell")}
                className="w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-tertiary flex items-center gap-2 cursor-pointer"
              >
                <Terminal size={14} />
                New terminal tab
              </button>
            </div>
          </>
        )}
      </div>
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
  const sidebarCollapsed = useWorkspaceStore((s) => s.sidebarCollapsed);

  const { repoPath, setRepoPath, error, clearError, loading } = useRepoPath();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

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

  const isOnboarding = !loading && worktrees.length === 0;

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

  // Onboarding — no sidebar
  if (isOnboarding) {
    return (
      <>
        <OnboardingScreen
          repoPath={repoPath}
          error={error}
          onRepoSelected={setRepoPath}
          onClearError={clearError}
          onCreateWorktree={() => setCreateDialogOpen(true)}
        />
        <CreateWorktreeDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          repoPath={repoPath ?? undefined}
        />
      </>
    );
  }

  // Normal state — worktrees exist, show sidebar
  return (
    <div className="flex h-screen">
      <motion.div
        className="flex-shrink-0 h-full overflow-hidden"
        initial={shouldAnimateSidebar.current ? { x: -260, opacity: 0 } : false}
        animate={{ x: 0, opacity: 1, width: sidebarCollapsed ? 48 : 260 }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      >
        <Sidebar hasRepo={!!repoPath} />
      </motion.div>
      <div className="flex-1 flex flex-col min-w-0">
        <TabBar />
        <main className="flex-1 min-h-0">
          {activeTab?.type === "changes" && activeWorktreeId ? (
            <ChangesView
              worktreeId={activeWorktreeId}
              repoPath={worktree?.path ?? "."}
            />
          ) : activeTab?.type === "claude" || activeTab?.type === "shell" ? (
            <TerminalView
              tabId={activeTab.id}
              tabType={activeTab.type}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
              Select a worktree to get started
            </div>
          )}
        </main>
        <StatusBar worktree={worktree} annotationCount={annotationCount} />
      </div>
    </div>
  );
}

export { AppShell };

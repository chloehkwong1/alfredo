import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Sidebar } from "../sidebar/Sidebar";
import { StatusBar } from "./StatusBar";
import { TerminalView } from "../terminal";
import { ChangesView } from "../changes/ChangesView";
import { OnboardingScreen } from "../onboarding/OnboardingScreen";
import { CreateWorktreeDialog } from "../kanban/CreateWorktreeDialog";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useRepoPath } from "../../hooks/useRepoPath";
import logoSvg from "../../assets/logo-cat.svg";

function TabBar() {
  const activeWorktreeId = useWorkspaceStore((s) => s.activeWorktreeId);
  const activeTab = useWorkspaceStore((s) => s.activeTab);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);

  const currentTab = activeWorktreeId
    ? (activeTab[activeWorktreeId] ?? "terminal")
    : "terminal";

  function handleTabClick(tab: "terminal" | "changes") {
    if (activeWorktreeId) {
      setActiveTab(activeWorktreeId, tab);
    }
  }

  return (
    <div className="flex items-center h-9 bg-bg-secondary border-b border-border-default flex-shrink-0">
      <button
        type="button"
        onClick={() => handleTabClick("terminal")}
        className={[
          "h-full px-4 text-sm font-medium transition-colors cursor-pointer",
          currentTab === "terminal"
            ? "text-text-primary border-b-2 border-b-accent-primary"
            : "text-text-tertiary hover:text-text-secondary border-b-2 border-b-transparent",
        ].join(" ")}
      >
        Terminal
      </button>
      <button
        type="button"
        onClick={() => handleTabClick("changes")}
        className={[
          "h-full px-4 text-sm font-medium transition-colors cursor-pointer flex items-center gap-1.5",
          currentTab === "changes"
            ? "text-text-primary border-b-2 border-b-accent-primary"
            : "text-text-tertiary hover:text-text-secondary border-b-2 border-b-transparent",
        ].join(" ")}
      >
        Changes
      </button>
    </div>
  );
}

function AppShell() {
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const activeWorktreeId = useWorkspaceStore((s) => s.activeWorktreeId);
  const worktree = useWorkspaceStore((s) =>
    s.worktrees.find((wt) => wt.id === activeWorktreeId),
  );
  const activeTab = useWorkspaceStore((s) => s.activeTab);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const annotations = useWorkspaceStore((s) => s.annotations);

  const { repoPath, setRepoPath, error, clearError, loading } = useRepoPath();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Track whether we just transitioned from onboarding to animate sidebar
  const wasOnboarding = useRef(true);
  const shouldAnimateSidebar = useRef(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (document.activeElement as HTMLElement)?.isContentEditable
      )
        return;

      if (event.metaKey && event.shiftKey) {
        if (event.key === "T") {
          event.preventDefault();
          if (activeWorktreeId) setActiveTab(activeWorktreeId, "terminal");
        } else if (event.key === "C") {
          event.preventDefault();
          if (activeWorktreeId) setActiveTab(activeWorktreeId, "changes");
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeWorktreeId, setActiveTab]);

  const currentTab = activeWorktreeId
    ? (activeTab[activeWorktreeId] ?? "terminal")
    : "terminal";

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

  const isOnboarding = worktrees.length === 0;

  // Track onboarding → normal transition for sidebar animation
  useEffect(() => {
    if (isOnboarding) {
      wasOnboarding.current = true;
    } else if (wasOnboarding.current) {
      shouldAnimateSidebar.current = true;
      wasOnboarding.current = false;
    }
  }, [isOnboarding]);

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
  const sidebarAnimation = shouldAnimateSidebar.current
    ? { initial: { x: -260, opacity: 0 }, animate: { x: 0, opacity: 1 }, transition: { duration: 0.2, ease: "easeOut" as const } }
    : {};

  // Clear animation flag after it's been consumed
  useEffect(() => {
    if (shouldAnimateSidebar.current) {
      shouldAnimateSidebar.current = false;
    }
  });

  return (
    <div className="flex h-screen">
      <motion.div {...sidebarAnimation}>
        <Sidebar hasRepo={!!repoPath} />
      </motion.div>
      <div className="flex-1 flex flex-col min-w-0">
        <TabBar />
        <main className="flex-1 min-h-0">
          {currentTab === "terminal" ? (
            <TerminalView />
          ) : activeWorktreeId ? (
            <ChangesView
              worktreeId={activeWorktreeId}
              repoPath={worktree?.path ?? "."}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
              Select a worktree to view changes
            </div>
          )}
        </main>
        <StatusBar worktree={worktree} annotationCount={annotationCount} />
      </div>
    </div>
  );
}

export { AppShell };

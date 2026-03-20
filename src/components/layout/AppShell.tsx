import { useState, useEffect } from "react";
import { Sidebar } from "../sidebar/Sidebar";
import { StatusBar } from "./StatusBar";
import { TerminalView } from "../terminal";
import { ChangesView } from "../changes/ChangesView";
import { WelcomeScreen } from "../empty/WelcomeScreen";
import { EmptyWorkspace } from "../empty/EmptyWorkspace";
import { CreateWorktreeDialog } from "../kanban/CreateWorktreeDialog";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { getConfig } from "../../api";

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
        {/* Placeholder file count badge */}
        <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-bg-hover text-text-tertiary text-[10px] font-semibold">
          0
        </span>
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

  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  useEffect(() => {
    getConfig(".").then(c => {
      if (c.repoPath && c.repoPath !== ".") setRepoPath(c.repoPath);
    }).catch(() => {});
  }, []);

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

  const showWelcome = !repoPath && worktrees.length === 0;
  const showEmptyWorkspace =
    !showWelcome && worktrees.length === 0 && !activeWorktreeId;

  function handleOpenRepository() {
    // Placeholder: Tauri file dialog plugin not yet installed.
    // When @tauri-apps/plugin-dialog is available, replace with:
    //   const selected = await open({ directory: true });
    //   if (selected) setRepoPath(selected as string);
    console.log("TODO: open Tauri directory picker");
    // For development, set a dummy path so the UI progresses past welcome
    setRepoPath("/tmp/demo-repo");
  }

  function handleCreateWorktree() {
    setCreateDialogOpen(true);
  }

  // Welcome screen — no repo configured
  if (showWelcome) {
    return (
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <WelcomeScreen onOpenRepository={handleOpenRepository} />
          <StatusBar worktree={worktree} annotationCount={annotationCount} />
        </div>
      </div>
    );
  }

  // Repo configured but no worktrees
  if (showEmptyWorkspace) {
    return (
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <EmptyWorkspace onCreateWorktree={handleCreateWorktree} />
          <StatusBar worktree={worktree} annotationCount={annotationCount} />
        </div>
        <CreateWorktreeDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
        />
      </div>
    );
  }

  // Normal state — worktrees exist
  return (
    <div className="flex h-screen">
      <Sidebar />
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

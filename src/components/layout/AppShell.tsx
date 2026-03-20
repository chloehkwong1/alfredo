import { Sidebar } from "../sidebar/Sidebar";
import { StatusBar } from "./StatusBar";
import { TerminalView } from "../terminal";
import { useWorkspaceStore } from "../../stores/workspaceStore";

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
  const activeWorktreeId = useWorkspaceStore((s) => s.activeWorktreeId);
  const worktree = useWorkspaceStore((s) =>
    s.worktrees.find((wt) => wt.id === activeWorktreeId),
  );
  const activeTab = useWorkspaceStore((s) => s.activeTab);
  const annotations = useWorkspaceStore((s) => s.annotations);

  const currentTab = activeWorktreeId
    ? (activeTab[activeWorktreeId] ?? "terminal")
    : "terminal";

  const annotationCount = activeWorktreeId
    ? (annotations[activeWorktreeId]?.length ?? 0)
    : 0;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TabBar />
        <main className="flex-1 min-h-0">
          {currentTab === "terminal" ? (
            <TerminalView />
          ) : (
            <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
              Changes coming soon
            </div>
          )}
        </main>
        <StatusBar worktree={worktree} annotationCount={annotationCount} />
      </div>
    </div>
  );
}

export { AppShell };

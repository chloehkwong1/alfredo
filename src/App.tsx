import { KanbanBoard } from "./components/kanban";
import { TerminalView } from "./components/terminal";
import { useGithubSync } from "./hooks/useGithubSync";
import { useWorkspaceStore } from "./stores/workspaceStore";

function App() {
  const view = useWorkspaceStore((s) => s.view);

  // Start listening for background GitHub PR sync events
  useGithubSync();

  return (
    <>
      <div style={{ display: view === "board" ? "block" : "none" }}>
        <KanbanBoard />
      </div>
      <div
        className="h-screen"
        style={{ display: view === "terminal" ? "block" : "none" }}
      >
        <TerminalView />
      </div>
    </>
  );
}

export default App;

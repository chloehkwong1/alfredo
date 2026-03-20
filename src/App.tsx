import { AnimatePresence, motion } from "framer-motion";
import { KanbanBoard } from "./components/kanban";
import { TerminalView } from "./components/terminal";
import { useGithubSync } from "./hooks/useGithubSync";
import { useWorkspaceStore } from "./stores/workspaceStore";

function App() {
  const view = useWorkspaceStore((s) => s.view);

  // Start listening for background GitHub PR sync events
  useGithubSync();

  return (
    <AnimatePresence mode="wait">
      {view === "board" ? (
        <motion.div
          key="board"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <KanbanBoard />
        </motion.div>
      ) : (
        <motion.div
          key="terminal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="h-screen"
        >
          <TerminalView />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default App;

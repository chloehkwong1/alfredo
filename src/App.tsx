import { AppShell } from "./components/layout/AppShell";
import { useGithubSync } from "./hooks/useGithubSync";
import { useNotifications } from "./hooks/useNotifications";

function App() {
  useGithubSync();
  useNotifications();
  return <AppShell />;
}

export default App;

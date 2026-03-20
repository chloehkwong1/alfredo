import { AppShell } from "./components/layout/AppShell";
import { useGithubSync } from "./hooks/useGithubSync";

function App() {
  useGithubSync();
  return <AppShell />;
}

export default App;

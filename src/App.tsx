import { Component, type ReactNode } from "react";
import { AppShell } from "./components/layout/AppShell";
import { useGithubSync } from "./hooks/useGithubSync";
import { useNotifications } from "./hooks/useNotifications";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("React error boundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: "#f88", fontFamily: "monospace", fontSize: 13, whiteSpace: "pre-wrap" }}>
          <h2 style={{ color: "#fff" }}>Something went wrong</h2>
          <p>{this.state.error.message}</p>
          <pre>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  useGithubSync();
  useNotifications();
  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  );
}

export default App;

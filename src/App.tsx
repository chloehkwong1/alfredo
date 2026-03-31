import { Component, type ReactNode } from "react";
import { AppShell } from "./components/layout/AppShell";
import { useGithubSync } from "./hooks/useGithubSync";
import { useNotifications } from "./hooks/useNotifications";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; componentStack: string | null }
> {
  state: { error: Error | null; componentStack: string | null } = {
    error: null,
    componentStack: null,
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("React error boundary caught:", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  private handleReset = () => {
    this.setState({ error: null, componentStack: null });
  };

  private handleReportBug = () => {
    const { error, componentStack } = this.state;
    const body = [
      `**Error:** ${error?.message ?? "Unknown error"}`,
      "",
      "**Stack trace:**",
      "```",
      error?.stack ?? "No stack trace",
      "```",
      "",
      ...(componentStack
        ? ["**Component stack:**", "```", componentStack, "```", ""]
        : []),
      `**Platform:** ${navigator.platform}`,
      `**User Agent:** ${navigator.userAgent}`,
      `**Time:** ${new Date().toISOString()}`,
      "",
      "**Steps to reproduce:**",
      "<!-- Describe what you were doing when this happened. Paste any screenshots below. -->",
      "",
    ].join("\n");

    const title = `Bug: ${error?.message ?? "Unknown error"}`.slice(0, 120);
    const url = `https://github.com/chloehkwong1/alfredo/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=bug`;
    window.open(url, "_blank");
  };

  render() {
    if (this.state.error) {
      const btnBase: React.CSSProperties = {
        padding: "8px 16px",
        border: "1px solid #555",
        borderRadius: 6,
        cursor: "pointer",
        fontFamily: "monospace",
        fontSize: 13,
      };
      return (
        <div style={{ padding: 32, color: "#ccc", fontFamily: "monospace", fontSize: 13, whiteSpace: "pre-wrap", maxWidth: 720 }}>
          <h2 style={{ color: "#fff", marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ color: "#f88", marginBottom: 16 }}>{this.state.error.message}</p>
          <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
            <button
              type="button"
              onClick={this.handleReset}
              style={{ ...btnBase, background: "#2a6", color: "#fff", borderColor: "#2a6" }}
            >
              Try Again
            </button>
            <button
              type="button"
              onClick={this.handleReportBug}
              style={{ ...btnBase, background: "#333", color: "#fff" }}
            >
              Report Bug
            </button>
          </div>
          <details style={{ color: "#888" }}>
            <summary style={{ cursor: "pointer", marginBottom: 8 }}>Error details</summary>
            <pre style={{ fontSize: 11, overflow: "auto" }}>{this.state.error.stack}</pre>
          </details>
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

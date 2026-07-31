import { Component, useEffect, useState, type ReactNode } from "react";
import { AppShell } from "./components/layout/AppShell";
import { HelpSearch } from "./components/askAlfredo/HelpSearch";
import { WhatsNewDialog } from "./components/onboarding/WhatsNewDialog";
import { Toaster } from "./components/ui/Toaster";
import { SectionErrorBoundary } from "./components/shared/SectionErrorBoundary";
import { TooltipProvider } from "./components/ui";
import { useGithubSync } from "./hooks/useGithubSync";
import { useWorktreeSetup } from "./hooks/useWorktreeSetup";
import { useWhatsNew } from "./hooks/useWhatsNew";
import { applyPersistedZoom } from "./services/uiZoom";
import { debugLog } from "./api";
import { useAppConfigStore } from "./stores/appConfigStore";

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
    debugLog(
      `[react-error] section=root ${error.name}: ${error.message}\n${error.stack ?? ""}\nComponent stack:${info.componentStack ?? ""}`,
    ).catch(() => {});
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

function AppInner() {
  useGithubSync();
  useWorktreeSetup();
  const [askOpen, setAskOpen] = useState(false);
  const whatsNew = useWhatsNew();
  useEffect(() => {
    const handler = () => setAskOpen((v) => !v);
    window.addEventListener("alfredo:toggle-ask", handler);
    return () => window.removeEventListener("alfredo:toggle-ask", handler);
  }, []);
  useEffect(() => {
    void applyPersistedZoom();
  }, []);
  // Single global listener for the `config-changed` window event. Replaces
  // the per-hook listeners that used to fan out 6 concurrent getAppConfig
  // IPCs per save. Living inside a React effect (not at module scope) keeps
  // it HMR-safe — the cleanup tears down the old listener before the new
  // module attaches a fresh one.
  useEffect(() => {
    const handler = () => {
      void useAppConfigStore.getState().refetch();
    };
    window.addEventListener("config-changed", handler);
    if (import.meta.env.DEV) {
      const g = globalThis as { __alfredoConfigChangedListenerCount?: number };
      g.__alfredoConfigChangedListenerCount =
        (g.__alfredoConfigChangedListenerCount ?? 0) + 1;
      if (g.__alfredoConfigChangedListenerCount !== 1) {
        console.warn(
          `[appConfigStore] expected exactly one config-changed listener, found ${g.__alfredoConfigChangedListenerCount}`,
        );
      }
    }
    return () => {
      window.removeEventListener("config-changed", handler);
      if (import.meta.env.DEV) {
        const g = globalThis as { __alfredoConfigChangedListenerCount?: number };
        g.__alfredoConfigChangedListenerCount =
          (g.__alfredoConfigChangedListenerCount ?? 1) - 1;
      }
    };
  }, []);
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      const stack = e.error instanceof Error ? e.error.stack : undefined;
      debugLog(
        `[window-error] ${e.message} at ${e.filename}:${e.lineno}:${e.colno}\n${stack ?? ""}`,
      ).catch(() => {});
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason =
        e.reason instanceof Error
          ? `${e.reason.name}: ${e.reason.message}\n${e.reason.stack ?? ""}`
          : String(e.reason);
      debugLog(`[unhandled-rejection] ${reason}`).catch(() => {});
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return (
    <TooltipProvider>
      <AppShell />
      <HelpSearch
        open={askOpen}
        onClose={() => {
          setAskOpen(false);
          window.dispatchEvent(new CustomEvent("alfredo:close-ask"));
        }}
      />
      <WhatsNewDialog
        entries={whatsNew.entries}
        open={whatsNew.open}
        onDismiss={whatsNew.dismiss}
      />
      <Toaster />
    </TooltipProvider>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <SectionErrorBoundary name="App">
        <AppInner />
      </SectionErrorBoundary>
    </ErrorBoundary>
  );
}

export default App;

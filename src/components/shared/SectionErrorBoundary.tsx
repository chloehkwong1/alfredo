import { Component, type ReactNode } from "react";
import { copyText } from "../../lib/clipboard";

interface Props {
  children: ReactNode;
  name: string;
  variant?: "full" | "inline";
  onReset?: () => void;
}

interface State {
  error: Error | null;
  componentStack: string | null;
  copied: boolean;
}

export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null, copied: false };
  private copyTimeout?: ReturnType<typeof setTimeout>;

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentWillUnmount() {
    if (this.copyTimeout) clearTimeout(this.copyTimeout);
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[${this.props.name}] error boundary caught:`, error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
    import("../../api").then(({ debugLog }) =>
      debugLog(
        `[react-error] section=${this.props.name} ${error.name}: ${error.message}\n${error.stack ?? ""}\nComponent stack:${info.componentStack ?? ""}`,
      ).catch(() => {}),
    );
  }

  private getReportText() {
    const { error, componentStack } = this.state;
    if (!error) return "";
    return [
      `Section: ${this.props.name}`,
      `Error: ${error.name}: ${error.message}`,
      error.stack ? `\nStack:\n${error.stack}` : "",
      componentStack ? `\nComponent stack:${componentStack}` : "",
    ].join("\n");
  }

  private handleCopy = async () => {
    try {
      await copyText(this.getReportText());
      this.setState({ copied: true });
      if (this.copyTimeout) clearTimeout(this.copyTimeout);
      this.copyTimeout = setTimeout(() => this.setState({ copied: false }), 2000);
    } catch (e) {
      console.error("Failed to copy error report", e);
    }
  };

  private handleReset = () => {
    this.setState({ error: null, componentStack: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      const { error } = this.state;
      const variant = this.props.variant ?? "full";

      if (variant === "inline") {
        return (
          <div className="p-2 text-xs border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] flex items-center justify-between gap-3">
            <span className="truncate">
              {this.props.name} error: {error.name}: {error.message}
            </span>
            <div className="flex items-center gap-3 flex-shrink-0">
              <button
                type="button"
                onClick={this.handleReset}
                className="text-[var(--accent-primary)] hover:underline"
              >
                {this.props.onReset ? "Dismiss" : "Try again"}
              </button>
              <button
                type="button"
                onClick={this.handleCopy}
                className="text-[var(--accent-primary)] hover:underline"
              >
                {this.state.copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        );
      }

      return (
        <div className="flex items-center justify-center h-full min-h-[120px] p-4 text-xs text-[var(--text-tertiary)] overflow-auto">
          <div className="max-w-2xl w-full text-center">
            <p className="text-[var(--text-secondary)] mb-2">
              {this.props.name} encountered an error
            </p>
            <pre className="text-left text-[11px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded p-2 mb-2 overflow-auto max-h-64 whitespace-pre-wrap break-words text-[var(--text-secondary)]">
              {error.name}: {error.message}
              {error.stack ? `\n\n${error.stack}` : ""}
              {this.state.componentStack ? `\n\nComponent stack:${this.state.componentStack}` : ""}
            </pre>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={this.handleReset}
                className="text-[var(--accent-primary)] hover:underline"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={this.handleCopy}
                className="text-[var(--accent-primary)] hover:underline"
              >
                {this.state.copied ? "Copied!" : "Copy error for bug report"}
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

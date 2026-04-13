import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  name: string;
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
      await navigator.clipboard.writeText(this.getReportText());
      this.setState({ copied: true });
      if (this.copyTimeout) clearTimeout(this.copyTimeout);
      this.copyTimeout = setTimeout(() => this.setState({ copied: false }), 2000);
    } catch (e) {
      console.error("Failed to copy error report", e);
    }
  };

  render() {
    if (this.state.error) {
      const { error } = this.state;
      return (
        <div className="flex items-center justify-center h-full p-4 text-xs text-[var(--text-tertiary)] overflow-auto">
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
                onClick={() => this.setState({ error: null, componentStack: null })}
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

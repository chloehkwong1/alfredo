import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  name: string;
}

interface State {
  error: Error | null;
}

export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[${this.props.name}] error boundary caught:`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center justify-center h-full p-4 text-xs text-[var(--text-tertiary)]">
          <div className="text-center">
            <p className="text-[var(--text-secondary)] mb-1">
              {this.props.name} encountered an error
            </p>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="text-[var(--accent-primary)] hover:underline"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

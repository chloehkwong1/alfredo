import { X } from "lucide-react";

interface OrientationBannerProps {
  onDismiss: () => void;
}

function OrientationBanner({ onDismiss }: OrientationBannerProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 bg-accent-primary/5 border-b border-accent-primary/15">
      <p className="text-caption text-text-secondary">
        <span className="font-semibold text-text-primary">Welcome to Alfredo</span>
        {" — "}
        Each column is a worktree. Open the terminal tab to start an agent, or create a new worktree with{" "}
        <kbd className="px-1.5 py-0.5 rounded bg-bg-elevated border border-border-default text-micro font-mono">⌘N</kbd>.
      </p>
      <button
        type="button"
        className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-secondary cursor-pointer"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export { OrientationBanner };

import { X } from "lucide-react";
import { QuickStartRow, renderInfoFooter } from "./QuickStartRow";
import { useQuickStartTour } from "./useQuickStartTour";

export function QuickStartPanel() {
  const { open, dismiss } = useQuickStartTour();
  if (!open) return null;

  return (
    <div
      role="region"
      aria-label="Getting started checklist"
      className="fixed bottom-4 right-4 w-[280px] bg-bg-elevated border border-border-default rounded-[var(--radius-md)] shadow-lg p-3 z-[9997]"
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-text-primary">Getting started</h3>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className="text-text-tertiary hover:text-text-primary cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>
      <ul className="space-y-0.5">
        <QuickStartRow
          label="Create a worktree"
          shortcut="⌘N"
          target="create-worktree"
          missingMessage="Open a repo first."
        />
        <QuickStartRow
          label="(Optional) Configure setup script"
          subtitle="Runs after each worktree is created — e.g. copy env files, install deps."
          target="setup-script"
          followUpTarget="setup-script-tab"
          missingMessage="Open a repo first."
        />
        <QuickStartRow
          label="Start an agent"
          target="agent-terminal"
          missingMessage="Create a worktree first."
        />
        <QuickStartRow
          label="Open in your IDE"
          shortcut="⌘O"
          target="open-in-ide"
          missingMessage="Create a worktree first."
        />
      </ul>
      {renderInfoFooter(
        <span>PRs and changes appear in the main view once you push a branch.</span>,
      )}
    </div>
  );
}

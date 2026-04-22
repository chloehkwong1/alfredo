import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { PulseHighlight } from "./PulseHighlight";
import { QuickStartRow, renderInfoFooter } from "./QuickStartRow";
import { resolveTarget, type TourTargetId } from "./tourTargets";
import { useQuickStartTour } from "./useQuickStartTour";

const FOLLOW_UP_TIMEOUT_MS = 10_000;

export function QuickStartPanel() {
  const { open, dismiss } = useQuickStartTour();
  const [pulse, setPulse] = useState<{ target: HTMLElement; id: number } | null>(null);
  const pulseIdRef = useRef(0);
  const followUpCleanupRef = useRef<(() => void) | null>(null);

  const startPulse = useCallback((element: HTMLElement) => {
    pulseIdRef.current += 1;
    setPulse({ target: element, id: pulseIdRef.current });
  }, []);

  const cancelFollowUp = useCallback(() => {
    followUpCleanupRef.current?.();
    followUpCleanupRef.current = null;
  }, []);

  const scheduleFollowUp = useCallback(
    (id: TourTargetId) => {
      cancelFollowUp();
      const observer = new MutationObserver(() => {
        const state = resolveTarget(id);
        if (state.kind === "visible") {
          cancelFollowUp();
          startPulse(state.element);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      const timer = window.setTimeout(cancelFollowUp, FOLLOW_UP_TIMEOUT_MS);
      followUpCleanupRef.current = () => {
        observer.disconnect();
        window.clearTimeout(timer);
      };
    },
    [cancelFollowUp, startPulse],
  );

  const handlePulse = useCallback(
    (element: HTMLElement, followUp?: TourTargetId) => {
      cancelFollowUp();
      startPulse(element);
      if (followUp) scheduleFollowUp(followUp);
    },
    [cancelFollowUp, scheduleFollowUp, startPulse],
  );

  // Cancel any in-flight pulse or observer when the panel closes or unmounts.
  useEffect(() => {
    if (!open) {
      cancelFollowUp();
      setPulse(null);
    }
  }, [open, cancelFollowUp]);
  useEffect(() => cancelFollowUp, [cancelFollowUp]);

  if (!open) return null;

  return (
    <>
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
            label="Add a repo"
            target="add-repo"
            missingMessage="Add-repo affordance is hidden."
            onPulse={handlePulse}
          />
          <QuickStartRow
            label="Create a worktree"
            shortcut="⌘N"
            target="create-worktree"
            missingMessage="Open a repo first."
            onPulse={handlePulse}
          />
          <QuickStartRow
            label="(Optional) Configure setup script"
            subtitle="Runs after each worktree is created — e.g. copy env files, install deps."
            target="setup-script"
            followUpTarget="setup-script-tab"
            missingMessage="Open a repo first."
            onPulse={handlePulse}
          />
          <QuickStartRow
            label="Start an agent"
            target="agent-terminal"
            missingMessage="Create a worktree first."
            onPulse={handlePulse}
          />
          <QuickStartRow
            label="Open in your IDE"
            shortcut="⌘O"
            target="open-in-ide"
            missingMessage="Create a worktree first."
            onPulse={handlePulse}
          />
        </ul>
        {renderInfoFooter(
          <span>PRs and changes appear in the main view once you push a branch.</span>,
        )}
      </div>
      {pulse && (
        <PulseHighlight
          key={pulse.id}
          target={pulse.target}
          onDone={() => setPulse((cur) => (cur?.id === pulse.id ? null : cur))}
        />
      )}
    </>
  );
}

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { PulseHighlight } from "./PulseHighlight";
import { resolveTarget, type TourTargetId } from "./tourTargets";

interface QuickStartRowProps {
  label: string;
  subtitle?: string;
  shortcut?: string;
  target: TourTargetId;
  missingMessage: string;
  followUpTarget?: TourTargetId;
}

const FOLLOW_UP_TIMEOUT_MS = 10_000;

export function QuickStartRow({
  label,
  subtitle,
  shortcut,
  target,
  missingMessage,
  followUpTarget,
}: QuickStartRowProps) {
  const [pulseTarget, setPulseTarget] = useState<HTMLElement | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const followUpCleanupRef = useRef<(() => void) | null>(null);

  const cancelFollowUp = () => {
    followUpCleanupRef.current?.();
    followUpCleanupRef.current = null;
  };

  const scheduleFollowUp = (id: TourTargetId) => {
    cancelFollowUp();
    const observer = new MutationObserver(() => {
      const state = resolveTarget(id);
      if (state.kind === "visible") {
        cancelFollowUp();
        setPulseTarget(state.element);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setTimeout(cancelFollowUp, FOLLOW_UP_TIMEOUT_MS);
    followUpCleanupRef.current = () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  };

  useEffect(() => cancelFollowUp, []);

  const handleClick = () => {
    const state = resolveTarget(target);
    if (state.kind === "visible") {
      setStatusMessage(null);
      setPulseTarget(state.element);
      if (followUpTarget) scheduleFollowUp(followUpTarget);
    } else if (state.kind === "hidden-sidebar") {
      setStatusMessage("Sidebar is hidden — ⌘B to reopen.");
    } else {
      setStatusMessage(missingMessage);
    }
  };

  return (
    <li>
      <button
        type="button"
        onClick={handleClick}
        className="group w-full flex items-start justify-between gap-3 py-1.5 px-2 -mx-2 rounded-[var(--radius-sm)] hover:bg-bg-hover text-left cursor-pointer"
      >
        <div className="min-w-0">
          <div className="text-xs text-text-primary flex items-center gap-1.5">
            <span>{label}</span>
            {shortcut && (
              <kbd className="px-1 py-[1px] rounded bg-bg-elevated border border-border-default font-mono text-[10px] text-text-tertiary">
                {shortcut}
              </kbd>
            )}
          </div>
          {subtitle && (
            <div className="text-[11px] text-text-tertiary mt-0.5 leading-snug">
              {subtitle}
            </div>
          )}
          {statusMessage && (
            <div role="status" className="text-[11px] text-text-tertiary italic mt-1">
              {statusMessage}
            </div>
          )}
        </div>
        <ChevronRight
          size={12}
          className="text-text-tertiary group-hover:text-accent-primary flex-shrink-0 mt-[3px] transition-colors"
        />
      </button>
      {pulseTarget && (
        <PulseHighlight target={pulseTarget} onDone={() => setPulseTarget(null)} />
      )}
    </li>
  );
}

export type { QuickStartRowProps };

export function renderInfoFooter(children: ReactNode) {
  return <div className="text-[11px] text-text-tertiary mt-2 pt-2 border-t border-border-default">{children}</div>;
}

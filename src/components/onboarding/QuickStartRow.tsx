import { useState, type ReactNode } from "react";
import { PulseHighlight } from "./PulseHighlight";
import { resolveTarget, type TourTargetId } from "./tourTargets";

interface QuickStartRowProps {
  label: string;
  subtitle?: string;
  shortcut?: string;
  target: TourTargetId;
  missingMessage: string;
}

export function QuickStartRow({
  label,
  subtitle,
  shortcut,
  target,
  missingMessage,
}: QuickStartRowProps) {
  const [pulseTarget, setPulseTarget] = useState<HTMLElement | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleClick = () => {
    const state = resolveTarget(target);
    if (state.kind === "visible") {
      setStatusMessage(null);
      setPulseTarget(state.element);
    } else if (state.kind === "hidden-sidebar") {
      setStatusMessage("Sidebar is hidden — ⌘B to reopen.");
    } else {
      setStatusMessage(missingMessage);
    }
  };

  return (
    <li className="flex items-start justify-between gap-3 py-1.5">
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
      <button
        type="button"
        onClick={handleClick}
        className="text-[11px] text-accent-primary hover:underline cursor-pointer flex-shrink-0 mt-[2px]"
      >
        Show me
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

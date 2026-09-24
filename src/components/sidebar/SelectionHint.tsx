import { Lightbulb } from "lucide-react";
import { Tooltip } from "../ui";

/** Explains the multi-select gestures. Always available on header hover —
 *  deliberately not a one-time coachmark, which only teaches dismissal. */
export function SelectionHint() {
  return (
    <Tooltip
      side="bottom"
      content={
        <div className="w-52 space-y-1 text-left">
          <p className="font-semibold text-text-primary">Selecting several</p>
          <p>
            <span className="text-text-primary">⇧-click</span> a second row to select
            everything between it and the first.
          </p>
          <p>
            <span className="text-text-primary">⌘-click</span> to add or remove one row.
          </p>
          <p>Selections stay inside one column.</p>
        </div>
      }
    >
      <button
        type="button"
        onClick={(e) => e.stopPropagation()}
        className="opacity-0 group-hover/grp:opacity-100 transition-opacity p-0.5 rounded text-text-tertiary hover:text-text-secondary mr-2 cursor-pointer"
        aria-label="How to select several worktrees"
      >
        <Lightbulb className="h-3.5 w-3.5" />
      </button>
    </Tooltip>
  );
}

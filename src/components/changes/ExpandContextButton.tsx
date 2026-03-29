import { memo } from "react";
import { ChevronsUp, ChevronsDown, Ellipsis } from "lucide-react";

interface ExpandContextButtonProps {
  /** Where this button sits relative to the hunks */
  position: "top" | "between" | "bottom";
  /** Number of hidden lines in the gap */
  hiddenLineCount: number;
  /** Called when user clicks to expand by ~20 lines */
  onExpandIncremental: (direction: "up" | "down") => void;
  /** Called when user clicks "Show all" */
  onExpandAll: () => void;
}

const EXPAND_INCREMENT = 20;

const ExpandContextButton = memo(function ExpandContextButton({
  position,
  hiddenLineCount,
  onExpandIncremental,
  onExpandAll,
}: ExpandContextButtonProps) {
  if (hiddenLineCount <= 0) return null;

  const showDualActions = position === "between" && hiddenLineCount > EXPAND_INCREMENT;

  return (
    <div className="flex items-center justify-center gap-2 px-3 py-1 bg-bg-secondary border-y border-border-subtle cursor-pointer select-none hover:bg-bg-hover transition-colors group">
      {position === "top" && (
        <button
          className="flex items-center gap-1.5 text-[11px] text-text-tertiary group-hover:text-accent-primary transition-colors bg-transparent border-none cursor-pointer font-[inherit]"
          onClick={() => onExpandIncremental("up")}
        >
          <ChevronsUp size={14} />
          <span>Show {Math.min(hiddenLineCount, EXPAND_INCREMENT)} more lines</span>
        </button>
      )}

      {position === "bottom" && (
        <button
          className="flex items-center gap-1.5 text-[11px] text-text-tertiary group-hover:text-accent-primary transition-colors bg-transparent border-none cursor-pointer font-[inherit]"
          onClick={() => onExpandIncremental("down")}
        >
          <ChevronsDown size={14} />
          <span>Show {Math.min(hiddenLineCount, EXPAND_INCREMENT)} more lines</span>
        </button>
      )}

      {position === "between" && !showDualActions && (
        <button
          className="flex items-center gap-1.5 text-[11px] text-text-tertiary group-hover:text-accent-primary transition-colors bg-transparent border-none cursor-pointer font-[inherit]"
          onClick={onExpandAll}
        >
          <Ellipsis size={14} />
          <span>Show all {hiddenLineCount} lines</span>
        </button>
      )}

      {position === "between" && showDualActions && (
        <div className="flex items-center gap-3">
          <button
            className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-accent-primary transition-colors bg-transparent border-none cursor-pointer font-[inherit]"
            onClick={() => onExpandIncremental("down")}
          >
            <ChevronsDown size={12} />
            Show {EXPAND_INCREMENT} lines
          </button>
          <span className="text-border-default text-[11px]">·</span>
          <button
            className="text-[11px] text-text-tertiary hover:text-accent-primary transition-colors bg-transparent border-none cursor-pointer font-[inherit]"
            onClick={onExpandAll}
          >
            Show all {hiddenLineCount} lines
          </button>
          <span className="text-border-default text-[11px]">·</span>
          <button
            className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-accent-primary transition-colors bg-transparent border-none cursor-pointer font-[inherit]"
            onClick={() => onExpandIncremental("up")}
          >
            <ChevronsUp size={12} />
            Show {EXPAND_INCREMENT} lines
          </button>
        </div>
      )}
    </div>
  );
});

export { ExpandContextButton, EXPAND_INCREMENT };
export type { ExpandContextButtonProps };

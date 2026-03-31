import { memo } from "react";
import { ChevronsUp, ChevronsDown, UnfoldVertical } from "lucide-react";

interface ExpandContextButtonProps {
  /** Where this button sits relative to the hunks */
  position: "top" | "between" | "bottom";
  /** Number of hidden lines in the gap (ignored for bottom — count is unknown) */
  hiddenLineCount: number;
  /** Called when user clicks to expand all hidden lines */
  onExpandAll: () => void;
}

const ExpandContextButton = memo(function ExpandContextButton({
  position,
  hiddenLineCount,
  onExpandAll,
}: ExpandContextButtonProps) {
  if (position !== "bottom" && hiddenLineCount <= 0) return null;

  const icon =
    position === "top" ? <ChevronsUp size={14} /> :
    position === "bottom" ? <ChevronsDown size={14} /> :
    <UnfoldVertical size={14} />;

  const label =
    position === "bottom"
      ? "Expand to end of file"
      : `Show ${hiddenLineCount} hidden lines`;

  return (
    <button
      className="flex items-center justify-center gap-1.5 w-full px-3 py-1 bg-bg-secondary border-y border-border-subtle cursor-pointer select-none hover:bg-bg-hover transition-colors text-[11px] text-text-tertiary hover:text-accent-primary font-[inherit]"
      onClick={onExpandAll}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
});

export { ExpandContextButton };
export type { ExpandContextButtonProps };

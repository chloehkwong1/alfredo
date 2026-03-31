import type { RefObject } from "react";
import { Search, ChevronUp, ChevronDown, X } from "lucide-react";
import { IconButton } from "../ui/IconButton";

interface DiffSearchBarProps {
  isOpen: boolean;
  onClose: () => void;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  matchCount: number;
  activeMatch: number;
  onPrev: () => void;
  onNext: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

function DiffSearchBar({
  isOpen,
  onClose,
  searchTerm,
  onSearchChange,
  matchCount,
  activeMatch,
  onPrev,
  onNext,
  inputRef,
}: DiffSearchBarProps) {
  if (!isOpen) return null;

  return (
    <div className="flex items-center gap-1 border border-border-default rounded bg-bg-primary px-1.5 py-0.5">
      <Search size={11} className="text-text-tertiary flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        placeholder="Search in diffs..."
        className="w-32 text-[10px] bg-transparent text-text-primary placeholder:text-text-tertiary focus:outline-none"
        value={searchTerm}
        onChange={(e) => onSearchChange(e.target.value)}
        autoFocus
      />
      {searchTerm && (
        <span className="text-[9px] text-text-tertiary whitespace-nowrap">
          {matchCount > 0
            ? `${activeMatch + 1}/${matchCount}`
            : "0 results"}
        </span>
      )}
      <IconButton
        size="sm"
        label="Previous match"
        className="h-auto w-auto p-0 text-text-tertiary hover:text-text-primary"
        onClick={onPrev}
        disabled={matchCount === 0}
      >
        <ChevronUp size={12} />
      </IconButton>
      <IconButton
        size="sm"
        label="Next match"
        className="h-auto w-auto p-0 text-text-tertiary hover:text-text-primary"
        onClick={onNext}
        disabled={matchCount === 0}
      >
        <ChevronDown size={12} />
      </IconButton>
      <IconButton
        size="sm"
        label="Close search"
        className="h-auto w-auto p-0 text-text-tertiary hover:text-text-primary"
        onClick={onClose}
      >
        <X size={11} />
      </IconButton>
    </div>
  );
}

export { DiffSearchBar };
export type { DiffSearchBarProps };

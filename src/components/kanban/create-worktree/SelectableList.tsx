import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

interface SelectableListProps {
  loading: boolean;
  error: string | null;
  emptyMessage: string;
  isEmpty: boolean;
  children: ReactNode;
}

function SelectableList({ loading, error, emptyMessage, isEmpty, children }: SelectableListProps) {
  return (
    <div className="max-h-[240px] overflow-y-auto rounded-[var(--radius-md)] border border-border-default bg-bg-primary p-1">
      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
        </div>
      )}
      {error && (
        <div className="text-xs text-danger text-center py-4">
          {error}
        </div>
      )}
      {!loading && !error && isEmpty && (
        <div className="text-xs text-text-tertiary text-center py-8">
          {emptyMessage}
        </div>
      )}
      {!loading && !error && children}
    </div>
  );
}

interface SelectableItemProps {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}

function SelectableItem({ selected, onClick, children }: SelectableItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full text-left px-3 py-2.5 rounded-[var(--radius-sm)] cursor-pointer",
        "transition-colors duration-[var(--transition-fast)]",
        selected
          ? "bg-accent-muted text-text-primary"
          : "text-text-secondary hover:bg-bg-hover hover:text-text-primary",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export { SelectableList, SelectableItem };

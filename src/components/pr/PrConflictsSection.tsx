import { AlertTriangle } from "lucide-react";
import { CollapsibleSection } from "./CollapsibleSection";

interface PrConflictsSectionProps {
  mergeable: boolean | null;
}

function PrConflictsSection({ mergeable }: PrConflictsSectionProps) {
  if (mergeable !== false) return null;

  return (
    <CollapsibleSection title="Conflicts" defaultOpen>
      <div className="flex items-center gap-2 py-1">
        <AlertTriangle className="h-4 w-4 text-status-error flex-shrink-0" />
        <span className="text-sm text-status-error">
          This branch has merge conflicts that must be resolved
        </span>
      </div>
    </CollapsibleSection>
  );
}

export { PrConflictsSection };

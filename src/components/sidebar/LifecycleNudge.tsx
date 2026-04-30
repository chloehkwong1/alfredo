import { Lightbulb, X } from "lucide-react";

interface LifecycleNudgeProps {
  /** Number of done worktrees the user has — passed for the inline "N done" copy if desired. */
  doneCount: number;
  onArchiveAllDone: () => void;
  onOpenAutoArchive: () => void;
  onDismiss: () => void;
}

function LifecycleNudge({ doneCount, onArchiveAllDone, onOpenAutoArchive, onDismiss }: LifecycleNudgeProps) {
  return (
    <div className="mx-3 my-2 flex items-start gap-2 rounded-md border border-[rgba(96,165,250,0.18)] bg-[rgba(96,165,250,0.06)] px-2.5 py-2 text-[11px] text-text-secondary">
      <Lightbulb className="h-3 w-3 text-[#60a5fa] flex-shrink-0 mt-0.5" />
      <div className="flex-1 leading-snug">
        <div>
          <strong className="text-text-primary font-medium">Done with these {doneCount > 0 ? `${doneCount} ` : ""}worktrees?</strong>
        </div>
        <div className="text-text-tertiary mt-0.5">
          Archive to clear them out now, or change how long Done worktrees stay before they auto-archive.
        </div>
        <div className="flex items-center gap-3 mt-1.5">
          <button
            type="button"
            onClick={() => { onArchiveAllDone(); onDismiss(); }}
            className="text-[#60a5fa] hover:text-[#93c5fd] font-medium cursor-pointer"
          >
            Archive all done
          </button>
          <button
            type="button"
            onClick={() => { onOpenAutoArchive(); onDismiss(); }}
            className="text-text-tertiary hover:text-text-secondary cursor-pointer"
          >
            Lifecycle rules…
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-text-tertiary hover:text-text-primary cursor-pointer p-0.5 -m-0.5 flex-shrink-0"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

export { LifecycleNudge };
export type { LifecycleNudgeProps };

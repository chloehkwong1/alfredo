import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/Dialog";
import { Button } from "../ui";
import { worktreeDirtyState, type WorktreeDirtyState } from "../../api";

interface DeleteWorktreeConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branch: string;
  /** Worktree path. When provided, the dialog checks for untracked/uncommitted
   *  work the diff badge can't see and warns before the irreversible delete. */
  worktreePath?: string;
  /** Called after Radix's close animation finishes (200ms after the user
   *  confirms) so the unmounting consumer doesn't kill the overlay mid-animation. */
  onConfirm: () => void;
}

const MAX_LISTED = 8;

function DeleteWorktreeConfirm({ open, onOpenChange, branch, worktreePath, onConfirm }: DeleteWorktreeConfirmProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [dirty, setDirty] = useState<WorktreeDirtyState | null>(null);

  // Check for would-be-destroyed work each time the dialog opens. Untracked
  // files (e.g. /research output) never show in the diff badge, so without this
  // the worktree looks empty and the user deletes real work unknowingly.
  useEffect(() => {
    if (!open || !worktreePath) {
      setDirty(null);
      return;
    }
    let cancelled = false;
    setDirty(null);
    worktreeDirtyState(worktreePath)
      .then((d) => { if (!cancelled) setDirty(d); })
      .catch(() => { if (!cancelled) setDirty({ untracked: [], uncommitted: [], ignored: [] }); });
    return () => { cancelled = true; };
  }, [open, worktreePath]);

  // Untracked first — it's the dangerous, invisible-in-the-badge case.
  const lost = dirty ? [...dirty.untracked, ...dirty.uncommitted] : [];
  const hasUnsaved = lost.length > 0;
  // Gitignored-but-not-regenerable files (mockups, plan docs). Reported
  // separately: they're routinely deletable, so they mustn't cry wolf in the
  // red block — but a worktree holding only these looks 100% clean otherwise.
  const ignored = dirty?.ignored ?? [];
  const hasIgnored = ignored.length > 0;
  // While the check is in flight (path given, result not yet in) we can't know
  // whether there's unseen work — block Delete so a click can't pre-empt the
  // warning. (Enter is already safe: focus is on Cancel until settled.)
  const loading = worktreePath != null && dirty === null;
  // Keep focus on Cancel while the check is in flight or when there IS unsaved
  // work, so an accidental Enter can't blow away unseen files. Ignored files
  // count here too: a worktree whose only content is a gitignored mockup is
  // exactly the case where Enter-to-delete loses the work.
  const settledClean = dirty !== null && !hasUnsaved && !hasIgnored;
  const focusTarget = settledClean ? confirmRef : cancelRef;

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => focusTarget.current?.focus(), 0);
    return () => clearTimeout(t);
    // focusTarget is derived from settledClean; re-run when that flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settledClean]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[460px]"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          focusTarget.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Delete worktree</DialogTitle>
          <DialogDescription>
            Delete worktree and local branch <code className="text-text-secondary font-mono text-xs">{branch}</code>? This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {hasUnsaved && (
          <div className="rounded-md border border-red-400/25 bg-red-400/10 px-3 py-2.5 text-xs">
            <p className="font-medium text-red-400">
              {lost.length} unsaved {lost.length === 1 ? "change" : "changes"} will be permanently deleted
            </p>
            <p className="mt-1 text-text-secondary">
              {dirty && dirty.untracked.length > 0
                ? "Untracked files (e.g. /research output) don't show in the changes badge, but deleting the worktree erases them:"
                : "These uncommitted changes will be erased:"}
            </p>
            <ul className="mt-1.5 space-y-0.5 font-mono text-text-secondary">
              {lost.slice(0, MAX_LISTED).map((p) => (
                <li key={p} className="truncate">{p}</li>
              ))}
              {lost.length > MAX_LISTED && (
                <li className="text-text-tertiary">…and {lost.length - MAX_LISTED} more</li>
              )}
            </ul>
          </div>
        )}

        {hasIgnored && (
          <div className="rounded-md border border-amber-400/25 bg-amber-400/10 px-3 py-2.5 text-xs">
            <p className="font-medium text-amber-400">
              {ignored.length} ignored {ignored.length === 1 ? "file" : "files"} will also be deleted
            </p>
            <p className="mt-1 text-text-secondary">
              Gitignored, so they never appear in the changes badge — but they only exist in this worktree:
            </p>
            <ul className="mt-1.5 space-y-0.5 font-mono text-text-secondary">
              {ignored.slice(0, MAX_LISTED).map((p) => (
                <li key={p} className="truncate">{p}</li>
              ))}
              {ignored.length > MAX_LISTED && (
                <li className="text-text-tertiary">…and {ignored.length - MAX_LISTED} more</li>
              )}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button ref={cancelRef} variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            ref={confirmRef}
            variant="danger"
            disabled={loading}
            onClick={() => {
              onOpenChange(false);
              // Defer so Radix's close animation finishes before the
              // consumer unmounts. Otherwise the overlay leaks and blocks clicks.
              setTimeout(onConfirm, 200);
            }}
          >
            {loading ? "Checking…" : hasUnsaved ? "Delete anyway" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { DeleteWorktreeConfirm };
export type { DeleteWorktreeConfirmProps };

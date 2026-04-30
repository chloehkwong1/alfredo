import { useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/Dialog";
import { Button } from "../ui";

interface DeleteWorktreeConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branch: string;
  /** Called after Radix's close animation finishes (200ms after the user
   *  confirms) so the unmounting consumer doesn't kill the overlay mid-animation. */
  onConfirm: () => void;
}

function DeleteWorktreeConfirm({ open, onOpenChange, branch, onConfirm }: DeleteWorktreeConfirmProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      // Focus the confirm button on open so Enter confirms.
      const t = setTimeout(() => confirmRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[420px]"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          confirmRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Delete worktree</DialogTitle>
          <DialogDescription>
            Delete worktree and local branch <code className="text-text-secondary font-mono text-xs">{branch}</code>? This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            ref={confirmRef}
            variant="danger"
            onClick={() => {
              onOpenChange(false);
              // Defer so Radix's close animation finishes before the
              // consumer unmounts. Otherwise the overlay leaks and blocks clicks.
              setTimeout(onConfirm, 200);
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { DeleteWorktreeConfirm };
export type { DeleteWorktreeConfirmProps };

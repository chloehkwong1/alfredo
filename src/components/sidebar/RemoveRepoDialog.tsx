import { Button } from "../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/Dialog";

interface RemoveRepoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoName: string;
  onConfirm: () => void;
}

function RemoveRepoDialog({
  open,
  onOpenChange,
  repoName,
  onConfirm,
}: RemoveRepoDialogProps) {
  function handleConfirm() {
    onConfirm();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[420px]">
        <DialogHeader>
          <DialogTitle>Remove repository</DialogTitle>
          <DialogDescription>
            Remove {repoName} from Alfredo? This won't delete any files.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <button
            type="button"
            className="inline-flex items-center justify-center font-medium h-8 px-3 text-sm gap-2 rounded-[var(--radius-md)] bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
            onClick={handleConfirm}
          >
            Remove
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { RemoveRepoDialog };

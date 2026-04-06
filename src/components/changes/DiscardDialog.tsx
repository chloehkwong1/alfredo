import { Button } from "../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/Dialog";
import type { DiscardTarget } from "./useDiscardChanges";

interface DiscardDialogProps {
  discardTarget: DiscardTarget;
  uncommittedCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

function DiscardDialog({ discardTarget, uncommittedCount, onCancel, onConfirm }: DiscardDialogProps) {
  return (
    <Dialog open={discardTarget !== null} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {discardTarget?.type === "all" ? "Discard all changes?" : "Discard changes?"}
          </DialogTitle>
          <DialogDescription>
            {discardTarget?.type === "all"
              ? `This will revert ${uncommittedCount} file${uncommittedCount !== 1 ? "s" : ""} to their last committed state. This action cannot be undone.`
              : discardTarget?.type === "file" && discardTarget.status === "added"
                ? `This will delete "${discardTarget.path}". This action cannot be undone.`
                : `This will revert all changes to "${discardTarget?.type === "file" ? discardTarget.path : ""}". This action cannot be undone.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {discardTarget?.type === "all" ? "Discard All" : "Discard"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { DiscardDialog };
export type { DiscardDialogProps };

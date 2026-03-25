import { useState, useCallback, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { FolderOpen } from "lucide-react";
import { Button } from "../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../ui/Dialog";

interface AddRepoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRepoSelected: (path: string) => void;
  error: string | null;
  onClearError: () => void;
}

function AddRepoModal({
  open: isOpen,
  onOpenChange,
  onRepoSelected,
  error,
  onClearError,
}: AddRepoModalProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  // Tauri v2 drag-and-drop via webview events — listens at window level, same
  // as OnboardingScreen, so it works even when rendered inside a modal.
  useEffect(() => {
    if (!isOpen) return;

    let unlisten: (() => void) | undefined;

    getCurrentWebviewWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over") {
          setIsDragOver(true);
          onClearError();
        } else if (event.payload.type === "drop") {
          setIsDragOver(false);
          const paths = event.payload.paths;
          if (paths.length > 0) {
            onRepoSelected(paths[0]);
            onOpenChange(false);
          }
        } else if (event.payload.type === "leave") {
          setIsDragOver(false);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, [isOpen, onRepoSelected, onClearError, onOpenChange]);

  const handleOpenPicker = useCallback(async () => {
    onClearError();
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected) {
        onRepoSelected(selected as string);
        onOpenChange(false);
      }
    } catch {
      // User cancelled or error — no-op
    }
  }, [onRepoSelected, onClearError, onOpenChange]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a repository</DialogTitle>
          <DialogDescription>
            Select a git repository to add to Alfredo
          </DialogDescription>
        </DialogHeader>

        {/* Drag-and-drop zone */}
        <div
          className={[
            "flex flex-col items-center justify-center gap-4 py-10 px-6",
            "border-2 border-dashed rounded-lg transition-colors",
            isDragOver
              ? "border-border-hover bg-[rgba(147,51,234,0.04)]"
              : "border-border-subtle",
          ].join(" ")}
        >
          <Button size="lg" onClick={handleOpenPicker} className="py-3 px-6 text-body">
            <FolderOpen className="h-[18px] w-[18px]" />
            Open a repository
          </Button>
          <p className="text-body text-text-tertiary">
            or drag a folder here
          </p>
        </div>

        {error && (
          <p className="text-caption text-status-error mt-3">{error}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export { AddRepoModal };

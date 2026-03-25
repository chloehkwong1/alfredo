import { useState, useCallback, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { FolderOpen } from "lucide-react";
import { Button } from "../ui/Button";
import logoSvg from "../../assets/logo-cat.svg";

interface RepoWelcomeScreenProps {
  onRepoSelected: (path: string) => void;
  error: string | null;
  onClearError: () => void;
}

function RepoWelcomeScreen({ onRepoSelected, error, onClearError }: RepoWelcomeScreenProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
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
  }, [onRepoSelected, onClearError]);

  const handleOpenPicker = useCallback(async () => {
    onClearError();
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected) {
        onRepoSelected(selected as string);
      }
    } catch {
      // User cancelled or error — no-op
    }
  }, [onRepoSelected, onClearError]);

  return (
    <div className="flex-1 flex items-center justify-center h-screen relative">
      {/* Drag-over indicator */}
      {isDragOver && (
        <div className="absolute inset-4 border-2 border-dashed border-border-hover rounded-[var(--radius-lg)] pointer-events-none z-10" />
      )}

      <div className="flex flex-col items-center text-center max-w-[480px] px-8">
        {/* Logo with gradient container */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-[rgba(147,51,234,0.08)] to-[rgba(147,51,234,0.03)] mb-8">
          <img
            src={logoSvg}
            alt="Alfredo"
            width={64}
            height={64}
            className="opacity-70"
          />
        </div>

        <h1 className="text-display font-semibold text-text-primary mb-3 tracking-[-0.5px]">
          Add your first repository
        </h1>
        <p className="text-subheading text-text-secondary leading-relaxed mb-8">
          Manage your AI coding agents across git worktrees.
        </p>
        <Button size="lg" onClick={handleOpenPicker} className="py-3 px-6 text-body">
          <FolderOpen className="h-[18px] w-[18px]" />
          Open a repository
        </Button>
        {error && (
          <p className="text-caption text-status-error mt-5">{error}</p>
        )}
        <p className="text-body text-text-tertiary mt-5">
          or drag a folder here
        </p>
      </div>
    </div>
  );
}

export { RepoWelcomeScreen };

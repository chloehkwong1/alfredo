import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { FolderOpen, Plus } from "lucide-react";
import { Button } from "../ui/Button";
import logoSvg from "../../assets/logo-cat.svg";

interface OnboardingScreenProps {
  repoPath: string | null;
  error: string | null;
  onRepoSelected: (path: string) => void;
  onClearError: () => void;
  onCreateWorktree: () => void;
}

const transition = { duration: 0.2, ease: "easeInOut" as const };

function OnboardingScreen({
  repoPath,
  error,
  onRepoSelected,
  onClearError,
  onCreateWorktree,
}: OnboardingScreenProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  // Tauri v2 drag-and-drop via webview events
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

  const repoName = repoPath?.split("/").filter(Boolean).pop() ?? "";

  return (
    <div className="flex-1 flex items-center justify-center h-screen relative">
      {/* Drag-over indicator */}
      {isDragOver && (
        <div className="absolute inset-4 border-2 border-dashed border-border-hover rounded-[var(--radius-lg)] pointer-events-none z-10" />
      )}

      <div className="flex flex-col items-center text-center max-w-[420px] px-6">
        {/* Cat logo — stable anchor across both states */}
        <img
          src={logoSvg}
          alt="Alfredo"
          width={72}
          height={72}
          className="mb-8 opacity-70"
        />

        <AnimatePresence mode="wait">
          {!repoPath ? (
            <motion.div
              key="welcome"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={transition}
              className="flex flex-col items-center"
            >
              <h1 className="text-[26px] font-semibold text-text-primary mb-3 tracking-[-0.3px]">
                Welcome to Alfredo
              </h1>
              <p className="text-[15px] text-text-secondary leading-relaxed mb-9">
                Manage your AI coding agents across git worktrees.
              </p>
              <Button size="lg" onClick={handleOpenPicker}>
                <FolderOpen className="h-[18px] w-[18px]" />
                Open a repository
              </Button>
              {error && (
                <p className="text-sm text-status-error mt-4">{error}</p>
              )}
              <p className="text-[13px] text-text-tertiary mt-5">
                or drag a folder here
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="create-worktree"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={transition}
              className="flex flex-col items-center w-full"
            >
              {/* Repo confirmation */}
              <div className="flex items-center gap-3 w-full px-4 py-2.5 rounded-[var(--radius-md)] mb-10 text-left">
                <div className="h-7 w-7 rounded-full bg-[rgba(74,222,128,0.12)] flex items-center justify-center flex-shrink-0">
                  <span className="text-status-idle text-sm">✓</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-text-primary">
                    {repoName}
                  </div>
                  <div className="text-[11px] text-text-tertiary font-mono truncate">
                    {repoPath}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-xs text-accent-primary hover:underline flex-shrink-0 cursor-pointer"
                  onClick={handleOpenPicker}
                >
                  Change
                </button>
              </div>

              <h2 className="text-xl font-semibold text-text-primary mb-3 tracking-[-0.2px]">
                Create your first worktree
              </h2>
              <p className="text-[15px] text-text-secondary leading-relaxed mb-9">
                Each worktree gets its own branch, terminal, and agent.
              </p>
              <Button size="lg" onClick={onCreateWorktree}>
                <Plus className="h-[18px] w-[18px]" />
                Create a worktree
              </Button>
              {error && (
                <p className="text-sm text-status-error mt-4">{error}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export { OnboardingScreen };

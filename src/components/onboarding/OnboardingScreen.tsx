import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { FolderOpen, Key, Terminal, Check } from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { CreateWorktreeDialog } from "../kanban/CreateWorktreeDialog";
import { getConfig, saveConfig } from "../../api";
import logoSvg from "../../assets/logo-cat.svg";

interface OnboardingScreenProps {
  repoPath: string | null;
  error: string | null;
  onRepoSelected: (path: string) => void;
  onClearError: () => void;
  onCreateWorktree: () => void;
}

const transition = { duration: 0.2, ease: "easeInOut" as const };

/** Derive parent directory from a path (e.g. /Users/chloe/dev/alfredo -> /Users/chloe/dev) */
function parentDir(path: string): string {
  const segments = path.replace(/\/+$/, "").split("/");
  segments.pop();
  return segments.join("/") || "/";
}

function OnboardingScreen({
  repoPath,
  error,
  onRepoSelected,
  onClearError,
  onCreateWorktree: _onCreateWorktree,
}: OnboardingScreenProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  // Step 2 form state
  const [githubTokenInput, setGithubTokenInput] = useState("");
  const [setupScriptInput, setSetupScriptInput] = useState("");
  const [worktreeBasePathInput, setWorktreeBasePathInput] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);

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

  // Load existing config when repo is selected (step 2 mount)
  useEffect(() => {
    if (!repoPath) return;
    const defaultBase = parentDir(repoPath);
    setWorktreeBasePathInput(defaultBase);

    getConfig(repoPath).then((config) => {
      if (config.githubToken) setGithubTokenInput(config.githubToken);
      if (config.setupScripts?.length > 0) {
        setSetupScriptInput(config.setupScripts[0].command);
      }
      if (config.worktreeBasePath) {
        setWorktreeBasePathInput(config.worktreeBasePath);
      }
    }).catch(() => {
      // Config doesn't exist yet — use defaults
    });
  }, [repoPath]);

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

  const handleConfigure = useCallback(async () => {
    if (!repoPath) return;
    try {
      const current = await getConfig(repoPath);
      const updated = { ...current };

      if (githubTokenInput.trim()) {
        updated.githubToken = githubTokenInput.trim();
      }
      if (setupScriptInput.trim()) {
        updated.setupScripts = [
          { name: "Setup", command: setupScriptInput.trim(), runOn: "create" },
        ];
      }
      if (worktreeBasePathInput.trim() && worktreeBasePathInput !== parentDir(repoPath)) {
        updated.worktreeBasePath = worktreeBasePathInput.trim();
      }

      await saveConfig(repoPath, updated);
    } catch {
      // Save failed — proceed anyway
    }
    setShowCreateDialog(true);
  }, [repoPath, githubTokenInput, setupScriptInput, worktreeBasePathInput]);

  const repoName = repoPath?.split("/").filter(Boolean).pop() ?? "";

  return (
    <div className="flex-1 flex items-center justify-center h-screen relative">
      {/* Drag-over indicator */}
      {isDragOver && (
        <div className="absolute inset-4 border-2 border-dashed border-border-hover rounded-[var(--radius-lg)] pointer-events-none z-10" />
      )}

      <div className="flex flex-col items-center text-center max-w-[480px] px-8">
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

              <h1 className="text-[26px] font-semibold text-text-primary mb-3 tracking-[-0.5px]">
                Welcome to Alfredo
              </h1>
              <p className="text-[15px] text-text-secondary leading-relaxed mb-8">
                Manage your AI coding agents across git worktrees.
              </p>
              <Button size="lg" onClick={handleOpenPicker} className="py-3 px-6 text-[14px]">
                <FolderOpen className="h-[18px] w-[18px]" />
                Open a repository
              </Button>
              {error && (
                <p className="text-sm text-status-error mt-5">{error}</p>
              )}
              <p className="text-[13px] text-text-tertiary mt-5">
                or drag a folder here
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="configure"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={transition}
              className="flex flex-col items-center w-full pt-10"
            >
              {/* Repo confirmation bar */}
              <div className="flex items-center gap-2 text-[13px] mb-7">
                <Check className="h-4 w-4 text-status-idle" />
                <span className="font-medium text-text-primary">{repoName}</span>
                <button
                  type="button"
                  className="text-accent-primary hover:underline cursor-pointer"
                  onClick={handleOpenPicker}
                >
                  Change
                </button>
              </div>

              {/* Title & subtitle */}
              <h2 className="text-[20px] font-semibold tracking-[-0.3px] text-text-primary">
                Set up your workspace
              </h2>
              <p className="text-[14px] text-text-tertiary mt-2">
                Configure integrations and scripts. You can always change these later in settings.
              </p>

              <div className="w-full mt-9 text-left">
                {/* GitHub card */}
                <div className="p-5 border border-border-default rounded-[10px] mb-7">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="h-8 w-8 rounded-lg bg-[rgba(245,242,239,0.04)] flex items-center justify-center shrink-0">
                      <Key className="h-4 w-4 text-text-secondary" />
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold text-text-primary">Connect GitHub</div>
                      <div className="text-[10px] text-text-tertiary">Enables PR status, check runs, and branch management</div>
                    </div>
                  </div>
                  <Input
                    type="password"
                    placeholder="GitHub personal access token"
                    value={githubTokenInput}
                    onChange={(e) => setGithubTokenInput(e.target.value)}
                  />
                  <p className="text-[11px] text-text-tertiary mt-2">
                    Optional — you can add this later in settings
                  </p>
                </div>

                {/* Setup scripts card */}
                <div className="p-5 border border-border-default rounded-[10px] mb-7">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="h-8 w-8 rounded-lg bg-[rgba(245,242,239,0.04)] flex items-center justify-center shrink-0">
                      <Terminal className="h-4 w-4 text-text-secondary" />
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold text-text-primary">Setup scripts</div>
                      <div className="text-[10px] text-text-tertiary">Run automatically when creating new worktrees</div>
                    </div>
                  </div>
                  <Input
                    className="font-mono"
                    placeholder="npm install"
                    value={setupScriptInput}
                    onChange={(e) => setSetupScriptInput(e.target.value)}
                  />
                </div>

                {/* Worktree location card */}
                <div className="p-5 border border-border-default rounded-[10px] mb-9">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="h-8 w-8 rounded-lg bg-[rgba(245,242,239,0.04)] flex items-center justify-center shrink-0">
                      <FolderOpen className="h-4 w-4 text-text-secondary" />
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold text-text-primary">Worktree location</div>
                      <div className="text-[10px] text-text-tertiary">Where new worktrees are created on disk</div>
                    </div>
                  </div>
                  <Input
                    value={worktreeBasePathInput}
                    onChange={(e) => setWorktreeBasePathInput(e.target.value)}
                  />
                  <p className="text-[11px] text-text-tertiary mt-2">
                    Default: sibling directories of the repository
                  </p>
                </div>

                {/* CTA */}
                <Button size="lg" className="w-full" onClick={handleConfigure}>
                  Create your first worktree
                </Button>
                <p className="text-[12px] text-text-tertiary mt-3 text-center">
                  This will open the worktree creation dialog
                </p>
              </div>

              {error && (
                <p className="text-sm text-status-error mt-5">{error}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* CreateWorktreeDialog */}
      {repoPath && (
        <CreateWorktreeDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          repoPath={repoPath}
        />
      )}
    </div>
  );
}

export { OnboardingScreen };

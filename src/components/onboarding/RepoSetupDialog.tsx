import { useState, useCallback, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Terminal, Check, Github, Loader2, Key } from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/Dialog";
import { getConfig, saveConfig, githubAuthStatus, githubAuthToken, listWorktrees } from "../../api";

interface RepoSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoPath: string;
  existingGithubToken?: string | null;
  existingLinearKey?: string | null;
  onConfigured: (mode: "worktree" | "branch") => void;
}

/** Derive parent directory from a path (e.g. /Users/chloe/dev/alfredo -> /Users/chloe/dev) */
function parentDir(path: string): string {
  const segments = path.replace(/\/+$/, "").split("/");
  segments.pop();
  return segments.join("/") || "/";
}

function RepoSetupDialog({
  open: isOpen,
  onOpenChange,
  repoPath,
  existingGithubToken,
  existingLinearKey,
  onConfigured,
}: RepoSetupDialogProps) {
  // GitHub state
  const [githubConnected, setGithubConnected] = useState<string | null>(null);
  const [githubAuthState, setGithubAuthState] = useState<
    | { step: "idle" }
    | { step: "checking" }
  >({ step: "idle" });
  const [githubToken, setGithubToken] = useState("");
  const [githubError, setGithubError] = useState<string | null>(null);
  // Tracks whether the user wants to use the existing token from another repo
  const [usingExistingGithub, setUsingExistingGithub] = useState(false);

  // Linear state
  const [linearKey, setLinearKey] = useState("");

  // Worktree location state
  const [worktreeBasePathInput, setWorktreeBasePathInput] = useState(() => parentDir(repoPath));

  // Setup scripts state
  const [setupScriptInput, setSetupScriptInput] = useState("");

  // Existing worktree detection
  const [existingWorktreeCount, setExistingWorktreeCount] = useState(0);

  // Resolve username for existingGithubToken on open
  const [existingGithubUsername, setExistingGithubUsername] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Reset form
    setGithubConnected(null);
    setGithubAuthState({ step: "idle" });
    setGithubToken("");
    setGithubError(null);
    setUsingExistingGithub(false);
    setLinearKey(existingLinearKey ?? "");
    setWorktreeBasePathInput(parentDir(repoPath));
    setSetupScriptInput("");
    setExistingGithubUsername(null);
    setExistingWorktreeCount(0);

    // Detect existing worktrees (e.g. from Conductor or other tools)
    listWorktrees(repoPath)
      .then((wts) => setExistingWorktreeCount(wts.length))
      .catch(() => { /* no worktrees or error — ignore */ });

    // Load existing config for this repo
    getConfig(repoPath)
      .then((config) => {
        if (config.githubToken) {
          setGithubToken(config.githubToken);
          githubAuthStatus()
            .then((status) => {
              if (status.authenticated && status.username) {
                setGithubConnected(status.username);
              }
            })
            .catch(() => { /* token invalid */ });
        }
        if (config.setupScripts?.length > 0) {
          setSetupScriptInput(config.setupScripts[0].command);
        }
        if (config.worktreeBasePath) {
          setWorktreeBasePathInput(config.worktreeBasePath);
        }
        if (config.linearApiKey) {
          setLinearKey(config.linearApiKey);
        }
      })
      .catch(() => {
        // Config doesn't exist yet — use defaults
      });

    // Resolve username for the passed-in existing token (from another repo)
    if (existingGithubToken) {
      githubAuthStatus()
        .then((status) => {
          if (status.authenticated && status.username) {
            setExistingGithubUsername(status.username);
          }
        })
        .catch(() => { /* token invalid — hide the offer */ });
    }
  }, [isOpen, repoPath, existingGithubToken, existingLinearKey]);

  const startGithubAuth = useCallback(async () => {
    setGithubError(null);
    setUsingExistingGithub(false);
    setGithubAuthState({ step: "checking" });
    try {
      const status = await githubAuthStatus();
      if (!status.installed) {
        setGithubError("GitHub CLI (gh) is not installed. Install it with: brew install gh");
        setGithubAuthState({ step: "idle" });
        return;
      }
      if (!status.authenticated) {
        setGithubError("GitHub CLI is not authenticated. Run: gh auth login");
        setGithubAuthState({ step: "idle" });
        return;
      }

      const token = await githubAuthToken();
      setGithubToken(token);
      setGithubConnected(status.username ?? "unknown");
      setGithubAuthState({ step: "idle" });
    } catch (e) {
      setGithubError(e instanceof Error ? e.message : String(e));
      setGithubAuthState({ step: "idle" });
    }
  }, []);

  const handleUseExistingGithub = useCallback(() => {
    if (!existingGithubToken || !existingGithubUsername) return;
    setGithubToken(existingGithubToken);
    setGithubConnected(existingGithubUsername);
    setUsingExistingGithub(true);
    setGithubAuthState({ step: "idle" });
  }, [existingGithubToken, existingGithubUsername]);

  const handleSave = useCallback(async (mode: "worktree" | "branch") => {
    try {
      const current = await getConfig(repoPath);
      const updated = { ...current };

      if (githubToken) {
        updated.githubToken = githubToken;
      }
      if (linearKey.trim()) {
        updated.linearApiKey = linearKey.trim();
      }
      if (setupScriptInput.trim()) {
        updated.setupScripts = [
          { name: "Setup", command: setupScriptInput.trim(), runOn: "create" },
        ];
      }
      if (worktreeBasePathInput.trim()) {
        updated.worktreeBasePath = worktreeBasePathInput.trim();
      }

      await saveConfig(repoPath, updated);
    } catch {
      // Save failed — proceed anyway
    }
    onConfigured(mode);
  }, [repoPath, githubToken, linearKey, setupScriptInput, worktreeBasePathInput, onConfigured]);

  // Show "use existing" offer when: existing token resolves a username, and
  // we don't yet have a different token connected for this repo.
  const showExistingGithubOffer =
    existingGithubUsername !== null &&
    !githubConnected &&
    !usingExistingGithub &&
    githubAuthState.step === "idle";

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Set up your workspace</DialogTitle>
          <DialogDescription>
            Configure integrations and scripts. You can always change these later in settings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* GitHub card */}
          <div className="px-4 py-3.5 border border-border-subtle rounded-lg">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-7 w-7 rounded-md bg-[rgba(255,255,255,0.03)] flex items-center justify-center shrink-0">
                <Github className="h-3.5 w-3.5 text-text-tertiary" />
              </div>
              <div className="min-w-0">
                <div className="text-caption font-medium text-text-primary">Connect GitHub</div>
                <div className="text-micro text-text-tertiary">PR status, check runs, and branch management</div>
              </div>
            </div>

            {githubConnected ? (
              <div className="flex items-center gap-2 text-body">
                <Check className="h-3.5 w-3.5 text-green-400" />
                <span className="text-text-primary font-medium">@{githubConnected}</span>
                {usingExistingGithub && (
                  <span className="text-micro text-text-tertiary">(from another repository)</span>
                )}
              </div>
            ) : githubAuthState.step === "checking" ? (
              <div className="flex items-center gap-1.5 text-micro text-text-tertiary">
                <Loader2 className="h-3 w-3 animate-spin" />
                Checking GitHub CLI...
              </div>
            ) : showExistingGithubOffer ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleUseExistingGithub}
                  >
                    <Check className="h-3.5 w-3.5 mr-1.5" />
                    Use @{existingGithubUsername}
                  </Button>
                  <button
                    type="button"
                    className="text-micro text-accent-primary hover:underline cursor-pointer"
                    onClick={startGithubAuth}
                  >
                    Connect different account
                  </button>
                </div>
                <p className="text-micro text-text-tertiary">
                  Connected as @{existingGithubUsername} — use this account?
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={startGithubAuth}
                >
                  <Github className="h-3.5 w-3.5 mr-1.5" />
                  Connect to GitHub
                </Button>
                <p className="text-micro text-text-tertiary">
                  Optional — you can add this later in settings
                </p>
                {githubError && (
                  <p className="text-micro text-red-400">{githubError}</p>
                )}
              </div>
            )}
          </div>

          {/* Linear card */}
          <div className="px-4 py-3.5 border border-border-subtle rounded-lg">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-7 w-7 rounded-md bg-[rgba(255,255,255,0.03)] flex items-center justify-center shrink-0">
                <Key className="h-3.5 w-3.5 text-text-tertiary" />
              </div>
              <div className="min-w-0">
                <div className="text-caption font-medium text-text-primary">Connect Linear</div>
                <div className="text-micro text-text-tertiary">Link tickets and track progress</div>
              </div>
            </div>
            <Input
              type="password"
              placeholder="lin_api_..."
              value={linearKey}
              onChange={(e) => setLinearKey(e.target.value)}
            />
            {existingLinearKey && linearKey === existingLinearKey && (
              <p className="text-micro text-text-tertiary mt-1.5">
                Using key from another repository
              </p>
            )}
            {!existingLinearKey && (
              <p className="text-micro text-text-tertiary mt-1.5">
                Optional — you can add this later in settings
              </p>
            )}
          </div>

          {/* Worktree location card */}
          <div className="px-4 py-3.5 border border-border-subtle rounded-lg">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-7 w-7 rounded-md bg-[rgba(255,255,255,0.03)] flex items-center justify-center shrink-0">
                <FolderOpen className="h-3.5 w-3.5 text-text-tertiary" />
              </div>
              <div className="min-w-0">
                <div className="text-caption font-medium text-text-primary">Worktree location</div>
                <div className="text-micro text-text-tertiary">Where new worktrees are created on disk</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Input
                className="flex-1"
                value={worktreeBasePathInput}
                onChange={(e) => setWorktreeBasePathInput(e.target.value)}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  const selected = await open({ directory: true, multiple: false });
                  if (selected) setWorktreeBasePathInput(selected as string);
                }}
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-micro text-text-tertiary mt-1.5">
              Default: sibling directories of the repository
            </p>
          </div>

          {/* Setup scripts card */}
          <div className="px-4 py-3.5 border border-border-subtle rounded-lg">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-7 w-7 rounded-md bg-[rgba(255,255,255,0.03)] flex items-center justify-center shrink-0">
                <Terminal className="h-3.5 w-3.5 text-text-tertiary" />
              </div>
              <div className="min-w-0">
                <div className="text-caption font-medium text-text-primary">Setup scripts</div>
                <div className="text-micro text-text-tertiary">Run automatically when creating new worktrees</div>
              </div>
            </div>
            <Input
              className="font-mono"
              placeholder="npm install"
              value={setupScriptInput}
              onChange={(e) => setSetupScriptInput(e.target.value)}
            />
          </div>
        </div>

        {existingWorktreeCount > 0 && (
          <div className="px-4 py-3 border border-accent-primary/20 bg-accent-primary/5 rounded-lg">
            <p className="text-caption text-text-secondary">
              Found <span className="font-medium text-text-primary">{existingWorktreeCount}</span> existing{" "}
              {existingWorktreeCount === 1 ? "worktree" : "worktrees"} — {existingWorktreeCount === 1 ? "it" : "they"}'ll appear on your board automatically.
            </p>
          </div>
        )}

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <button
            type="button"
            className="text-caption text-text-tertiary hover:text-text-secondary cursor-pointer hover:underline"
            onClick={() => handleSave("branch")}
          >
            Skip — just use branches
          </button>
          <Button size="lg" onClick={() => handleSave("worktree")}>
            Save &amp; create first worktree
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { RepoSetupDialog };

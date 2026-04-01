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
} from "../ui/Dialog";
import { getConfig, saveConfig, githubAuthStatus, githubAuthToken, listWorktrees } from "../../api";
import type { AppConfig, Worktree } from "../../types";

interface RepoSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoPath: string;
  existingGithubToken?: string | null;
  existingLinearKey?: string | null;
  /** Config from most recently added repo, for carry-forward. Null for first repo. */
  previousRepoConfig?: AppConfig | null;
  onConfigured: (result: { selectedWorktreeIds: string[] } | "createNew") => void;
}

/** Derive parent directory from a path (e.g. /Users/chloe/dev/alfredo -> /Users/chloe/dev) */
function parentDir(path: string): string {
  const segments = path.replace(/\/+$/, "").split("/");
  segments.pop();
  return segments.join("/") || "/";
}

/** Collapse /Users/<user> prefix to ~ for display */
function tildePath(path: string): string {
  const home =
    typeof window !== "undefined"
      ? (window as unknown as Record<string, string>).__TAURI_HOME__ ?? ""
      : "";
  // Fallback: match /Users/<something> or /home/<something> pattern
  if (home && path.startsWith(home)) {
    return "~" + path.slice(home.length);
  }
  return path.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

/** Extract last path segment as repo name */
function repoNameFromPath(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() ?? path;
}

function RepoSetupDialog({
  open: isOpen,
  onOpenChange,
  repoPath,
  existingGithubToken,
  existingLinearKey,
  onConfigured,
  previousRepoConfig,
}: RepoSetupDialogProps) {
  // GitHub state
  const [githubConnected, setGithubConnected] = useState<string | null>(null);
  const [githubAuthState, setGithubAuthState] = useState<
    | { step: "idle" }
    | { step: "checking" }
  >({ step: "idle" });
  const [githubToken, setGithubToken] = useState("");
  const [githubError, setGithubError] = useState<string | null>(null);
  const [usingExistingGithub, setUsingExistingGithub] = useState(false);

  // Linear state
  const [linearKey, setLinearKey] = useState("");

  // Worktree location state
  const [worktreeBasePathInput, setWorktreeBasePathInput] = useState(() => parentDir(repoPath));

  // Setup scripts state
  const [setupScriptInput, setSetupScriptInput] = useState("");

  // Worktree detection state
  const [detectedWorktrees, setDetectedWorktrees] = useState<Worktree[]>([]);
  const [selectedWorktreeIds, setSelectedWorktreeIds] = useState<Set<string>>(new Set());

  // Existing github username (for "use existing" offer)
  const [existingGithubUsername, setExistingGithubUsername] = useState<string | null>(null);

  // Track whether github/linear values came from carry-forward vs own config
  const [githubFromCarryForward, setGithubFromCarryForward] = useState(false);
  const [linearFromCarryForward, setLinearFromCarryForward] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    // Reset form
    setGithubConnected(null);
    setGithubAuthState({ step: "idle" });
    setGithubToken("");
    setGithubError(null);
    setUsingExistingGithub(false);
    setWorktreeBasePathInput(parentDir(repoPath));
    setSetupScriptInput("");
    setExistingGithubUsername(null);
    setDetectedWorktrees([]);
    setSelectedWorktreeIds(new Set());
    setGithubFromCarryForward(false);
    setLinearFromCarryForward(false);

    // Pre-fill from carry-forward
    let carryForwardGithubToken: string | null = null;
    if (previousRepoConfig?.githubToken) {
      setGithubToken(previousRepoConfig.githubToken);
      carryForwardGithubToken = previousRepoConfig.githubToken;
      setGithubFromCarryForward(true);
    }
    if (previousRepoConfig?.linearApiKey) {
      setLinearKey(previousRepoConfig.linearApiKey);
      setLinearFromCarryForward(true);
    } else {
      setLinearKey(existingLinearKey ?? "");
    }

    // Detect existing worktrees
    listWorktrees(repoPath)
      .then((wts) => {
        setDetectedWorktrees(wts);
        setSelectedWorktreeIds(new Set(wts.map((wt) => wt.id)));
      })
      .catch(() => {
        setDetectedWorktrees([]);
        setSelectedWorktreeIds(new Set());
      });

    // Load existing config for this repo — overrides carry-forward values
    getConfig(repoPath)
      .then((config) => {
        if (config.githubToken) {
          setGithubToken(config.githubToken);
          setGithubFromCarryForward(false);
          githubAuthStatus()
            .then((status) => {
              if (status.authenticated && status.username) {
                setGithubConnected(status.username);
              }
            })
            .catch(() => { /* token invalid */ });
        } else if (carryForwardGithubToken) {
          // Check auth status with the carry-forward token
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
          setLinearFromCarryForward(false);
        }
      })
      .catch(() => {
        // Config doesn't exist yet — check carry-forward token auth
        if (carryForwardGithubToken) {
          githubAuthStatus()
            .then((status) => {
              if (status.authenticated && status.username) {
                setGithubConnected(status.username);
              }
            })
            .catch((e) => console.warn('[repo-setup] Failed to check GitHub auth:', e));
        }
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
  }, [isOpen, repoPath, existingGithubToken, existingLinearKey, previousRepoConfig]);

  // ── Worktree toggle helpers ──────────────────────────────────────

  const toggleWorktree = useCallback((id: string) => {
    setSelectedWorktreeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAllWorktrees = useCallback(() => {
    if (selectedWorktreeIds.size === detectedWorktrees.length) {
      setSelectedWorktreeIds(new Set());
    } else {
      setSelectedWorktreeIds(new Set(detectedWorktrees.map((wt) => wt.id)));
    }
  }, [selectedWorktreeIds.size, detectedWorktrees]);

  const hasDetectedWorktrees = detectedWorktrees.length > 0;

  // ── GitHub auth ──────────────────────────────────────────────────

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
      setGithubFromCarryForward(false);
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

  // ── Save ─────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
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

    if (hasDetectedWorktrees) {
      onConfigured({ selectedWorktreeIds: Array.from(selectedWorktreeIds) });
    } else {
      onConfigured("createNew");
    }
  }, [repoPath, githubToken, linearKey, setupScriptInput, worktreeBasePathInput, onConfigured, hasDetectedWorktrees, selectedWorktreeIds]);

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
            Configure integrations and worktrees for{" "}
            <span className="font-medium text-text-primary">{tildePath(repoPath)}</span>
          </DialogDescription>
          {previousRepoConfig && (
            <p className="text-micro text-text-tertiary mt-1">
              Settings carried over from {repoNameFromPath(previousRepoConfig.repoPath)}
            </p>
          )}
        </DialogHeader>

        <div className="space-y-4">
          {/* ── Worktree detection hero ────────────────────────────── */}
          {hasDetectedWorktrees ? (
            <div className="px-4 py-3.5 border border-accent-primary/20 bg-accent-primary/5 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="h-[22px] w-[22px] rounded-md bg-accent-primary/15 flex items-center justify-center shrink-0">
                    <FolderOpen className="h-3 w-3 text-accent-primary" />
                  </div>
                  <span className="text-caption font-semibold text-text-primary">
                    Found {detectedWorktrees.length} {detectedWorktrees.length === 1 ? "worktree" : "worktrees"}
                  </span>
                </div>
                <button
                  type="button"
                  className="text-micro text-accent-primary hover:underline cursor-pointer"
                  onClick={toggleAllWorktrees}
                >
                  {selectedWorktreeIds.size === detectedWorktrees.length ? "Deselect all" : "Select all"}
                </button>
              </div>

              <div className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto">
                {detectedWorktrees.map((wt) => {
                  const isSelected = selectedWorktreeIds.has(wt.id);
                  return (
                    <button
                      key={wt.id}
                      type="button"
                      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-caption cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-accent-primary/8 border border-accent-primary/25"
                          : "bg-[rgba(255,255,255,0.02)] border border-border-default opacity-60"
                      }`}
                      onClick={() => toggleWorktree(wt.id)}
                    >
                      {/* Checkbox */}
                      <div
                        className={`h-[18px] w-[18px] rounded shrink-0 flex items-center justify-center ${
                          isSelected
                            ? "bg-accent-primary"
                            : "border-[1.5px] border-text-quaternary"
                        }`}
                      >
                        {isSelected && <Check className="h-3 w-3 text-white" />}
                      </div>
                      {/* Branch name */}
                      <span className={`font-medium ${isSelected ? "text-text-primary" : "text-text-secondary"}`}>
                        {wt.branch}
                      </span>
                      {/* Disk path */}
                      <span className="ml-auto text-micro text-text-quaternary truncate max-w-[200px]">
                        {tildePath(wt.path)}
                      </span>
                    </button>
                  );
                })}
              </div>

              <p className="text-micro text-text-quaternary mt-2.5">
                {selectedWorktreeIds.size} of {detectedWorktrees.length} selected{" "}
                &middot; Deselected worktrees stay on disk, just hidden from your board
              </p>
            </div>
          ) : (
            <div className="px-4 py-3.5 border border-border-subtle rounded-lg">
              <div className="flex items-center gap-2">
                <div className="h-[22px] w-[22px] rounded-md bg-[rgba(255,255,255,0.03)] flex items-center justify-center shrink-0">
                  <FolderOpen className="h-3 w-3 text-text-tertiary" />
                </div>
                <span className="text-caption text-text-secondary">
                  No existing worktrees found — you'll create your first one next
                </span>
              </div>
            </div>
          )}

          {/* ── GitHub card ────────────────────────────────────────── */}
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
                {(usingExistingGithub || githubFromCarryForward) && (
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

          {/* ── Linear card ────────────────────────────────────────── */}
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
            {linearFromCarryForward && linearKey === previousRepoConfig?.linearApiKey && (
              <p className="text-micro text-text-tertiary mt-1.5">
                Using key from another repository
              </p>
            )}
            {existingLinearKey && !linearFromCarryForward && linearKey === existingLinearKey && (
              <p className="text-micro text-text-tertiary mt-1.5">
                Using key from another repository
              </p>
            )}
            {!existingLinearKey && !linearFromCarryForward && (
              <p className="text-micro text-text-tertiary mt-1.5">
                Optional — you can add this later in settings
              </p>
            )}
          </div>

          {/* ── Worktree location card ─────────────────────────────── */}
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

          {/* ── Setup scripts card ─────────────────────────────────── */}
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

        <div className="mt-7 pt-5 flex items-center justify-between gap-3 border-t border-border-default">
          <span className="text-micro text-text-quaternary">You can add more worktrees later</span>
          <Button size="lg" onClick={handleSave}>
            {hasDetectedWorktrees ? "Open board \u2192" : "Save & create first worktree"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { RepoSetupDialog };

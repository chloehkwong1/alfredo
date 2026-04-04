import { useState, useCallback, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { FolderOpen, Check, Github, Loader2, ChevronLeft } from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../ui/Dialog";
import {
  getConfig,
  saveConfig,
  githubAuthStatus,
  githubAuthToken,
  listWorktrees,
  linearOAuthStart,
  linearOAuthStatus,
  linearOAuthDisconnect,
} from "../../api";
import type { AppConfig, RepoMode, Worktree } from "../../types";

interface RepoSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoPath: string;
  existingGithubToken?: string | null;
  /** Config from most recently added repo, for carry-forward. Null for first repo. */
  previousRepoConfig?: AppConfig | null;
  onConfigured: (result: { mode: RepoMode; selectedWorktreeIds?: string[] }) => void;
}

/** Derive parent directory from a path */
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
  if (home && path.startsWith(home)) {
    return "~" + path.slice(home.length);
  }
  return path.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

/** Extract last path segment as repo name */
function repoNameFromPath(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() ?? path;
}

type LinearState =
  | { step: "loading" }
  | { step: "disconnected" }
  | { step: "connecting" }
  | { step: "connected"; displayName: string }
  | { step: "error"; message: string };

function RepoSetupDialog({
  open: isOpen,
  onOpenChange,
  repoPath,
  existingGithubToken,
  previousRepoConfig,
  onConfigured,
}: RepoSetupDialogProps) {
  // ── Step state ────────────────────────────────────────────────
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<RepoMode>("branch");

  // ── GitHub state ──────────────────────────────────────────────
  const [githubConnected, setGithubConnected] = useState<string | null>(null);
  const [githubChecking, setGithubChecking] = useState(false);
  const [githubToken, setGithubToken] = useState("");
  const [githubError, setGithubError] = useState<string | null>(null);

  // ── Linear OAuth state ────────────────────────────────────────
  const [linearState, setLinearState] = useState<LinearState>({ step: "loading" });

  // ── Worktree location state ───────────────────────────────────
  const [worktreeBasePathInput, setWorktreeBasePathInput] = useState(() => parentDir(repoPath));

  // ── Scripts state (Step 2) ────────────────────────────────────
  const [setupScript, setSetupScript] = useState("");
  const [runScript, setRunScript] = useState("");
  const [archiveScript, setArchiveScript] = useState("");

  // ── Worktree detection state ──────────────────────────────────
  const [detectedWorktrees, setDetectedWorktrees] = useState<Worktree[]>([]);
  const [selectedWorktreeIds, setSelectedWorktreeIds] = useState<Set<string>>(new Set());

  // ── Existing github username (for "use existing" offer) ───────
  const [existingGithubUsername, setExistingGithubUsername] = useState<string | null>(null);

  // ── Initialize on open ────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;

    // Reset form
    setStep(1);
    setMode("branch");
    setGithubConnected(null);
    setGithubChecking(false);
    setGithubToken("");
    setGithubError(null);
    setLinearState({ step: "loading" });
    setWorktreeBasePathInput(parentDir(repoPath));
    setSetupScript("");
    setRunScript("");
    setArchiveScript("");
    setDetectedWorktrees([]);
    setSelectedWorktreeIds(new Set());
    setExistingGithubUsername(null);

    // Detect existing worktrees
    listWorktrees(repoPath)
      .then((wts) => {
        setDetectedWorktrees(wts);
        setSelectedWorktreeIds(new Set(wts.map((wt) => wt.id)));
        if (wts.length > 0) setMode("worktree");
      })
      .catch(() => {
        setDetectedWorktrees([]);
        setSelectedWorktreeIds(new Set());
      });

    // Check Linear OAuth status
    linearOAuthStatus()
      .then((status) => {
        if (status.connected) {
          setLinearState({ step: "connected", displayName: status.displayName ?? "Connected" });
        } else {
          setLinearState({ step: "disconnected" });
        }
      })
      .catch(() => setLinearState({ step: "disconnected" }));

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
            .catch(() => {});
        }
        if (config.setupScripts?.length > 0) {
          setSetupScript(config.setupScripts[0].command);
        }
        if (config.runScript) {
          setRunScript(config.runScript.command);
        }
        if (config.archiveScript) {
          setArchiveScript(config.archiveScript);
        }
        if (config.worktreeBasePath) {
          setWorktreeBasePathInput(config.worktreeBasePath);
        }
        if (config.branchMode) {
          setMode("branch");
        }
      })
      .catch(() => {});

    // Check carry-forward GitHub token
    if (previousRepoConfig?.githubToken) {
      setGithubToken(previousRepoConfig.githubToken);
      githubAuthStatus()
        .then((status) => {
          if (status.authenticated && status.username) {
            setGithubConnected(status.username);
          }
        })
        .catch(() => {});
    }

    // Resolve username for existing token
    if (existingGithubToken) {
      githubAuthStatus()
        .then((status) => {
          if (status.authenticated && status.username) {
            setExistingGithubUsername(status.username);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, repoPath, existingGithubToken, previousRepoConfig]);

  // ── Linear OAuth event listeners ──────────────────────────────
  useEffect(() => {
    if (!isOpen) return;

    const unlistenComplete = listen("linear-oauth-complete", () => {
      linearOAuthStatus()
        .then((status) => {
          setLinearState({
            step: "connected",
            displayName: status.displayName ?? "Connected",
          });
        })
        .catch(() => setLinearState({ step: "connected", displayName: "Connected" }));
    });

    const unlistenError = listen<string>("linear-oauth-error", (event) => {
      setLinearState({ step: "error", message: event.payload });
    });

    return () => {
      unlistenComplete.then((f) => f());
      unlistenError.then((f) => f());
    };
  }, [isOpen]);

  // ── Worktree toggle helpers ───────────────────────────────────
  const hasDetectedWorktrees = detectedWorktrees.length > 0;

  const toggleWorktree = useCallback((id: string) => {
    setSelectedWorktreeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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

  // ── GitHub auth ───────────────────────────────────────────────
  const startGithubAuth = useCallback(async () => {
    setGithubError(null);
    setGithubChecking(true);
    try {
      const status = await githubAuthStatus();
      if (!status.installed) {
        setGithubError("GitHub CLI (gh) is not installed. Install it with: brew install gh");
        setGithubChecking(false);
        return;
      }
      if (!status.authenticated) {
        setGithubError("GitHub CLI is not authenticated. Run: gh auth login");
        setGithubChecking(false);
        return;
      }
      const token = await githubAuthToken();
      setGithubToken(token);
      setGithubConnected(status.username ?? "unknown");
      setGithubChecking(false);
    } catch (e) {
      setGithubError(e instanceof Error ? e.message : String(e));
      setGithubChecking(false);
    }
  }, []);

  const handleUseExistingGithub = useCallback(() => {
    if (!existingGithubToken || !existingGithubUsername) return;
    setGithubToken(existingGithubToken);
    setGithubConnected(existingGithubUsername);
  }, [existingGithubToken, existingGithubUsername]);

  // ── Linear OAuth ──────────────────────────────────────────────
  const handleLinearConnect = useCallback(async () => {
    setLinearState({ step: "connecting" });
    try {
      await linearOAuthStart();
    } catch (e) {
      setLinearState({ step: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const handleLinearDisconnect = useCallback(async () => {
    await linearOAuthDisconnect();
    setLinearState({ step: "disconnected" });
  }, []);

  // ── Save ──────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    try {
      const current = await getConfig(repoPath);
      const updated = { ...current };

      if (githubToken) {
        updated.githubToken = githubToken;
      }

      updated.branchMode = mode === "branch";

      if (mode === "worktree") {
        if (worktreeBasePathInput.trim()) {
          updated.worktreeBasePath = worktreeBasePathInput.trim();
        }
        if (setupScript.trim()) {
          updated.setupScripts = [
            { name: "Setup", command: setupScript.trim(), runOn: "create" },
          ];
        }
        if (runScript.trim()) {
          updated.runScript = { name: "Run", command: runScript.trim() };
        }
        if (archiveScript.trim()) {
          updated.archiveScript = archiveScript.trim();
        } else {
          updated.archiveScript = null;
        }
      }

      await saveConfig(repoPath, updated);
    } catch {
      // Save failed — proceed anyway
    }

    if (mode === "branch") {
      onConfigured({ mode: "branch" });
    } else if (hasDetectedWorktrees) {
      onConfigured({ mode: "worktree", selectedWorktreeIds: Array.from(selectedWorktreeIds) });
    } else {
      onConfigured({ mode: "worktree" });
    }
  }, [repoPath, githubToken, mode, worktreeBasePathInput, setupScript, runScript, archiveScript, onConfigured, hasDetectedWorktrees, selectedWorktreeIds]);

  // ── Show "use existing" offer ─────────────────────────────────
  const showExistingGithubOffer =
    existingGithubUsername !== null &&
    !githubConnected &&
    !githubChecking;

  // ── Render ────────────────────────────────────────────────────
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Set up your workspace</DialogTitle>
          <DialogDescription>
            Configure{" "}
            <span className="font-medium text-text-primary">{tildePath(repoPath)}</span>
          </DialogDescription>
          {previousRepoConfig && (
            <p className="text-micro text-text-tertiary mt-1">
              Settings carried over from {repoNameFromPath(previousRepoConfig.repoPath)}
            </p>
          )}
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-4">
            {/* ── Mode toggle ──────────────────────────────────── */}
            <div className="flex bg-bg-primary border border-border-default rounded-lg p-0.5">
              <button
                type="button"
                className={`flex-1 text-center py-1.5 rounded-md text-caption font-medium transition-colors cursor-pointer ${
                  mode === "branch"
                    ? "bg-bg-tertiary text-text-primary"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
                onClick={() => setMode("branch")}
              >
                Branches
              </button>
              <button
                type="button"
                className={`flex-1 text-center py-1.5 rounded-md text-caption font-medium transition-colors cursor-pointer ${
                  mode === "worktree"
                    ? "bg-bg-tertiary text-text-primary"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
                onClick={() => setMode("worktree")}
              >
                Worktrees
              </button>
            </div>

            {/* ── Worktree detection hero (worktree mode only) ── */}
            {mode === "worktree" && (
              hasDetectedWorktrees ? (
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
                          <div
                            className={`h-[18px] w-[18px] rounded shrink-0 flex items-center justify-center ${
                              isSelected
                                ? "bg-accent-primary"
                                : "border-[1.5px] border-text-quaternary"
                            }`}
                          >
                            {isSelected && <Check className="h-3 w-3 text-white" />}
                          </div>
                          <span className={`font-medium ${isSelected ? "text-text-primary" : "text-text-secondary"}`}>
                            {wt.branch}
                          </span>
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
              )
            )}

            {/* ── GitHub card ──────────────────────────────────── */}
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
                </div>
              ) : githubChecking ? (
                <div className="flex items-center gap-1.5 text-micro text-text-tertiary">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Checking GitHub CLI...
                </div>
              ) : showExistingGithubOffer ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={handleUseExistingGithub}>
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
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Button variant="secondary" size="sm" onClick={startGithubAuth}>
                    <Github className="h-3.5 w-3.5 mr-1.5" />
                    Connect to GitHub
                  </Button>
                  <p className="text-micro text-text-tertiary">
                    Optional — you can add this later in settings
                  </p>
                  {githubError && <p className="text-micro text-red-400">{githubError}</p>}
                </div>
              )}
            </div>

            {/* ── Linear OAuth card ───────────────────────────── */}
            <div className="px-4 py-3.5 border border-border-subtle rounded-lg">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-7 w-7 rounded-md bg-[rgba(255,255,255,0.03)] flex items-center justify-center shrink-0">
                  <svg className="h-3.5 w-3.5 text-text-tertiary" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M2.5 10.5L12 3l9.5 7.5L12 21 2.5 10.5z" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <div className="text-caption font-medium text-text-primary">Connect Linear</div>
                    <span className="text-micro text-text-quaternary">Optional</span>
                  </div>
                  <div className="text-micro text-text-tertiary">Link tickets and track progress</div>
                </div>
              </div>

              {linearState.step === "loading" && (
                <div className="flex items-center gap-1.5 text-micro text-text-tertiary">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Checking Linear connection...
                </div>
              )}

              {linearState.step === "disconnected" && (
                <div className="space-y-1.5">
                  <Button variant="secondary" size="sm" onClick={handleLinearConnect}>
                    Connect to Linear
                  </Button>
                  <p className="text-micro text-text-tertiary">Opens browser for authorization</p>
                </div>
              )}

              {linearState.step === "connecting" && (
                <div className="flex items-center gap-1.5 text-micro text-text-tertiary">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Waiting for authorization in browser...
                </div>
              )}

              {linearState.step === "connected" && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-body">
                    <Check className="h-3.5 w-3.5 text-green-400" />
                    <span className="text-text-primary font-medium">{linearState.displayName}</span>
                  </div>
                  <button
                    type="button"
                    className="text-micro text-text-tertiary hover:text-text-secondary cursor-pointer"
                    onClick={handleLinearDisconnect}
                  >
                    Disconnect
                  </button>
                </div>
              )}

              {linearState.step === "error" && (
                <div className="space-y-1.5">
                  <p className="text-micro text-red-400">{linearState.message}</p>
                  <Button variant="secondary" size="sm" onClick={handleLinearConnect}>
                    Try again
                  </Button>
                </div>
              )}
            </div>

            {/* ── Worktree location (worktree mode only) ──────── */}
            {mode === "worktree" && (
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
            )}
          </div>
        ) : (
          /* ── Step 2: Scripts ──────────────────────────────────── */
          <div className="space-y-4">
            <div>
              <h3 className="text-body font-semibold text-text-primary">Scripts</h3>
              <p className="text-micro text-text-tertiary">Automate worktree lifecycle — all optional</p>
            </div>

            {/* Setup script */}
            <div className="px-4 py-3.5 border border-border-subtle rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="text-caption font-medium text-text-primary">Setup</div>
                <span className="text-micro text-text-quaternary">Runs when creating a worktree</span>
              </div>
              <textarea
                className="w-full bg-bg-primary border border-border-default rounded-md px-3 py-2 text-caption font-mono text-text-primary placeholder:text-text-quaternary resize-y min-h-[60px] focus:outline-none focus:ring-1 focus:ring-accent-primary/50"
                placeholder="npm install"
                value={setupScript}
                onChange={(e) => setSetupScript(e.target.value)}
                rows={2}
              />
            </div>

            {/* Run script */}
            <div className="px-4 py-3.5 border border-border-subtle rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="text-caption font-medium text-text-primary">Run</div>
                <span className="text-micro text-text-quaternary">Dev server or background process</span>
              </div>
              <textarea
                className="w-full bg-bg-primary border border-border-default rounded-md px-3 py-2 text-caption font-mono text-text-primary placeholder:text-text-quaternary resize-y min-h-[60px] focus:outline-none focus:ring-1 focus:ring-accent-primary/50"
                placeholder="npm run dev"
                value={runScript}
                onChange={(e) => setRunScript(e.target.value)}
                rows={2}
              />
            </div>

            {/* Archive script */}
            <div className="px-4 py-3.5 border border-border-subtle rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="text-caption font-medium text-text-primary">Archive</div>
                <span className="text-micro text-text-quaternary">Runs when archiving a worktree</span>
              </div>
              <textarea
                className="w-full bg-bg-primary border border-border-default rounded-md px-3 py-2 text-caption font-mono text-text-primary placeholder:text-text-quaternary resize-y min-h-[60px] focus:outline-none focus:ring-1 focus:ring-accent-primary/50"
                placeholder="docker compose down"
                value={archiveScript}
                onChange={(e) => setArchiveScript(e.target.value)}
                rows={2}
              />
            </div>

            <div className="bg-accent-primary/5 rounded-md px-3 py-2">
              <p className="text-micro text-text-secondary">
                Scripts can also be configured later in workspace settings.
              </p>
            </div>
          </div>
        )}

        {/* ── Footer ─────────────────────────────────────────── */}
        <div className="mt-7 pt-5 flex items-center justify-between gap-3 border-t border-border-default">
          {step === 1 ? (
            <>
              <span className="text-micro text-text-quaternary">
                {mode === "worktree" ? "Step 1 of 2" : ""}
              </span>
              {mode === "branch" ? (
                <Button size="lg" onClick={handleSave}>
                  Save & open board
                </Button>
              ) : (
                <Button size="lg" onClick={() => setStep(2)}>
                  Next →
                </Button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                className="flex items-center gap-1 text-caption text-accent-primary hover:underline cursor-pointer"
                onClick={() => setStep(1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Back
              </button>
              <div className="flex items-center gap-3">
                <span className="text-micro text-text-quaternary">Step 2 of 2</span>
                <Button size="lg" onClick={handleSave}>
                  {hasDetectedWorktrees ? "Open board →" : "Save & create first worktree"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { RepoSetupDialog };

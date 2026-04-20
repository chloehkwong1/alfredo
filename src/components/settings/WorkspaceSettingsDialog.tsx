import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, FolderOpen } from "lucide-react";
import type { AppConfig, GlobalAppConfig, RepoEntry, RepoMode } from "../../types";
import { getConfig, saveConfig, getAppConfig, saveAppConfig, setRepoMode } from "../../api";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { Button } from "../ui/Button";
import {
  Dialog,
  DialogContent,
} from "../ui/Dialog";
import { RepoDropdown } from "../ui/RepoDropdown";

type WorkspaceTab = "repository" | "scripts";

const TABS: { id: WorkspaceTab; label: string }[] = [
  { id: "repository", label: "Repository" },
  { id: "scripts", label: "Scripts" },
];

const inputClass = [
  "h-8 w-full px-3 text-sm",
  "bg-bg-primary text-text-primary",
  "border border-border-default rounded-[var(--radius-md)]",
  "placeholder:text-text-tertiary",
  "hover:border-border-hover",
  "focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-accent-primary/50",
  "transition-all duration-[var(--transition-fast)]",
].join(" ");

const textareaClass = [
  "w-full px-3 py-2 text-sm font-mono",
  "bg-bg-secondary text-text-primary",
  "border border-border-default rounded-[var(--radius-md)]",
  "placeholder:text-text-tertiary",
  "hover:border-border-hover",
  "focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-accent-primary/50",
  "transition-all duration-[var(--transition-fast)]",
  "resize-none",
].join(" ");

function CopyButton({ value }: { value: string }) {
  const { copied, copy } = useCopyToClipboard();
  if (!value) return null;
  return (
    <button
      type="button"
      className="absolute top-2 right-2 p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
      title="Copy to clipboard"
      onClick={() => copy(value)}
    >
      {copied ? <Check size={14} className="text-diff-added" /> : <Copy size={14} />}
    </button>
  );
}

interface WorkspaceSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoPath: string;
  repos: RepoEntry[];
  repoColors: Record<string, string>;
  repoDisplayNames: Record<string, string>;
  onSetRepoDisplayName?: (repoPath: string, name: string | null) => void;
  defaultRepoPath?: string;
}

function WorkspaceSettingsDialog({
  open,
  onOpenChange,
  repoPath,
  repos,
  repoColors,
  repoDisplayNames,
  onSetRepoDisplayName,
  defaultRepoPath,
}: WorkspaceSettingsDialogProps) {
  const [tab, setTab] = useState<WorkspaceTab>("repository");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [appConfig, setAppConfig] = useState<GlobalAppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [currentRepoPath, setCurrentRepoPath] = useState(
    defaultRepoPath ?? repoPath,
  );
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [switchingMode, setSwitchingMode] = useState(false);
  const [modeSaved, setModeSaved] = useState(false);
  const modeSavedTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const prevOpenRef = useRef(false);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      const initPath = defaultRepoPath ?? repoPath;
      setCurrentRepoPath(initPath);
      setDisplayNameDraft(repoDisplayNames[initPath] ?? "");
      setSaveError(null);
    }
    if (!open && modeSavedTimerRef.current) {
      clearTimeout(modeSavedTimerRef.current);
      setModeSaved(false);
    }
    prevOpenRef.current = open;
  }, [open, defaultRepoPath, repoPath, repoDisplayNames]);

  // Load config when dialog opens or currentRepoPath changes
  useEffect(() => {
    if (!open) return;
    getConfig(currentRepoPath)
      .then((c) => {
        setConfig(c);
        setDirty(false);
      })
      .catch(() => {
        setConfig({
          repoPath: currentRepoPath,
          setupScripts: [],
          githubToken: null,
          linearApiKey: null,
          branchMode: false,
          worktreeBasePath: null,
        });
      });
    getAppConfig().then(setAppConfig).catch((e) => console.error("Failed to load app config:", e));
  }, [open, currentRepoPath]);

  const updateConfig = useCallback((patch: Partial<AppConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
    setSaveError(null);
  }, []);

  const updateGlobalConfig = useCallback((patch: Partial<GlobalAppConfig>) => {
    setAppConfig((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
    setSaveError(null);
  }, []);

  const handleRepoChange = useCallback(
    (newPath: string) => {
      if (newPath === currentRepoPath) return;
      if (dirty) {
        const discard = window.confirm(
          "You have unsaved changes. Discard and switch repository?",
        );
        if (!discard) return;
      }
      setCurrentRepoPath(newPath);
      setDisplayNameDraft(repoDisplayNames[newPath] ?? "");
      setModeSaved(false);
    },
    [currentRepoPath, dirty, repoDisplayNames],
  );

  const currentMode: RepoMode = repos.find((r) => r.path === currentRepoPath)?.mode ?? "worktree";

  const handleModeSwitch = useCallback(async (newMode: RepoMode) => {
    if (newMode === currentMode) return;
    const label = newMode === "branch" ? "branch" : "worktree";
    const confirmed = window.confirm(
      `Switch to ${label} mode? The board will reload to reflect the change.`,
    );
    if (!confirmed) return;
    setSwitchingMode(true);
    setSaveError(null);
    try {
      await setRepoMode(currentRepoPath, newMode);
      // Re-fetch both configs so local snapshots reflect the saved mode.
      // Without this, handleSave would clobber the mode change with stale data
      // (appConfig.repos[].mode and config.branchMode would both be old values).
      const [fresh, freshConfig] = await Promise.all([
        getAppConfig(),
        getConfig(currentRepoPath),
      ]);
      setAppConfig(fresh);
      setConfig(freshConfig);
      window.dispatchEvent(new Event("config-changed"));
      setModeSaved(true);
      if (modeSavedTimerRef.current) clearTimeout(modeSavedTimerRef.current);
      modeSavedTimerRef.current = setTimeout(() => setModeSaved(false), 2500);
    } catch (e) {
      console.error("Failed to switch repo mode:", e);
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSwitchingMode(false);
    }
  }, [currentRepoPath, currentMode]);

  const handleSave = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    setSaveError(null);
    try {
      await Promise.all([
        saveConfig(currentRepoPath, config),
        ...(appConfig ? [saveAppConfig(appConfig)] : []),
      ]);
      const newName = displayNameDraft.trim() || null;
      const oldName = repoDisplayNames[currentRepoPath] ?? null;
      if (newName !== oldName) {
        await onSetRepoDisplayName?.(currentRepoPath, newName);
      }
      setDirty(false);
      // config-changed triggers useAppConfig to re-fetch and sync to workspace store
      window.dispatchEvent(new Event("config-changed"));
      onOpenChange(false);
    } catch (e) {
      console.error("Failed to save workspace settings:", e);
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [config, appConfig, currentRepoPath, displayNameDraft, repoDisplayNames, onSetRepoDisplayName, onOpenChange]);

  if (!config) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[680px] p-0 overflow-hidden">
        <form onSubmit={(e) => { e.preventDefault(); if (dirty && !saving) handleSave(); }}>
        {/* Header with repo selector */}
        <div className="px-6 pt-6 pb-4 border-b border-border-default">
          <h2 className="text-base font-semibold text-text-primary mb-3.5">Repository Settings</h2>
          <RepoDropdown
            repos={repos}
            repoColors={repoColors}
            repoDisplayNames={repoDisplayNames}
            value={currentRepoPath}
            onChange={handleRepoChange}
          />
        </div>

        <div className="flex h-[380px]">
          {/* Rail */}
          <nav className="flex flex-col gap-0.5 w-40 flex-shrink-0 py-5 px-3 border-r border-border-default bg-bg-primary">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={[
                  "px-3 py-2 text-[13px] rounded-[var(--radius-md)] text-left",
                  "transition-colors duration-[var(--transition-fast)]",
                  "cursor-pointer",
                  tab === t.id
                    ? "bg-accent-muted text-text-primary font-medium"
                    : "text-text-tertiary hover:text-text-secondary hover:bg-bg-hover",
                ].join(" ")}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="flex-1 min-w-0 min-h-0 p-6 overflow-y-auto">
            {tab === "repository" && (
              <div>
                {/* Mode toggle */}
                <div className="mb-4">
                  <div className="text-[13px] font-medium text-text-primary mb-1.5">
                    Mode
                  </div>
                  <div className="flex bg-bg-primary border border-border-default rounded-lg p-0.5">
                    <button
                      type="button"
                      disabled={switchingMode}
                      className={`flex-1 text-center py-1.5 rounded-md text-[13px] font-medium transition-colors cursor-pointer ${
                        currentMode === "branch"
                          ? "bg-bg-elevated text-text-primary"
                          : "text-text-tertiary hover:text-text-secondary"
                      }`}
                      onClick={() => handleModeSwitch("branch")}
                    >
                      Branches
                    </button>
                    <button
                      type="button"
                      disabled={switchingMode}
                      className={`flex-1 text-center py-1.5 rounded-md text-[13px] font-medium transition-colors cursor-pointer ${
                        currentMode === "worktree"
                          ? "bg-bg-elevated text-text-primary"
                          : "text-text-tertiary hover:text-text-secondary"
                      }`}
                      onClick={() => handleModeSwitch("worktree")}
                    >
                      Worktrees
                    </button>
                  </div>
                  <p className="text-xs text-text-tertiary mt-[5px]">
                    {modeSaved ? (
                      <span className="text-green-500">Mode saved — close this dialog or make further changes.</span>
                    ) : (
                      <>Branch mode shows git branches. Worktree mode uses git worktrees with a kanban board.</>
                    )}
                  </p>
                </div>

                {/* Repo Path (read-only) */}
                <div className="mb-4">
                  <div className="text-[13px] font-medium text-text-primary mb-1.5">
                    Repository Path
                  </div>
                  <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border-default bg-bg-primary px-3 h-8 text-sm text-text-secondary">
                    <FolderOpen className="h-4 w-4 flex-shrink-0 text-text-tertiary" />
                    <span className="truncate">
                      {config.repoPath && config.repoPath !== "." ? config.repoPath : "No repository configured"}
                    </span>
                  </div>
                </div>

                {/* Display Name */}
                <div className="mb-4">
                  <div className="text-[13px] font-medium text-text-primary mb-1.5">
                    Display Name
                  </div>
                  <input
                    type="text"
                    className={inputClass}
                    placeholder={currentRepoPath.split("/").filter(Boolean).pop() ?? ""}
                    value={displayNameDraft}
                    onChange={(e) => {
                      setDisplayNameDraft(e.target.value);
                      setDirty(true);
                      setSaveError(null);
                    }}
                  />
                  <p className="text-xs text-text-tertiary mt-[5px]">
                    Short name shown in sidebar repo chips. Defaults to directory name.
                  </p>
                </div>

                {currentMode === "worktree" && (
                  <>
                    {/* Worktree Base Path */}
                    <div className="mb-4">
                      <div className="text-[13px] font-medium text-text-primary mb-1.5">
                        Worktree Directory
                      </div>
                      <input
                        type="text"
                        className={inputClass}
                        placeholder="e.g. /Users/you/worktrees"
                        value={config.worktreeBasePath ?? ""}
                        onChange={(e) =>
                          updateConfig({ worktreeBasePath: e.target.value || null })
                        }
                      />
                      <p className="text-xs text-text-tertiary mt-[5px]">
                        Where new worktrees are created. Defaults to the repository parent.
                      </p>
                    </div>

                    {/* Port Management */}
                    <div className="mb-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-[13px] font-medium text-text-primary">
                            Auto-assign dev server ports
                          </div>
                          <p className="text-xs text-text-tertiary mt-[3px]">
                            Assign unique ports (3001–3099) to each worktree so multiple dev servers can run simultaneously.
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={config.autoAssignPorts ?? false}
                          onClick={() => updateConfig({ autoAssignPorts: !config.autoAssignPorts })}
                          className={[
                            "relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 cursor-pointer",
                            config.autoAssignPorts ? "bg-accent-primary" : "bg-bg-tertiary",
                          ].join(" ")}
                        >
                          <span
                            className={[
                              "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                              config.autoAssignPorts ? "translate-x-[18px]" : "translate-x-[3px]",
                            ].join(" ")}
                          />
                        </button>
                      </div>
                      {config.autoAssignPorts && (
                        <div className="mt-4">
                          <label className="text-[13px] text-text-secondary block mb-1">
                            Port environment variable
                          </label>
                          <input
                            className={inputClass + " !w-40"}
                            placeholder="PORT"
                            value={config.portEnvVar ?? ""}
                            onChange={(e) =>
                              updateConfig({ portEnvVar: e.target.value || null })
                            }
                          />
                          <p className="text-xs text-text-tertiary mt-[3px]">
                            The env var injected into each session. Defaults to PORT.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Archive & Cleanup */}
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary mb-3 mt-6">
                      Archive &amp; Cleanup
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-[13px] text-text-primary">
                          Auto-archive merged worktrees after
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            className={inputClass + " !w-16 text-center"}
                            value={appConfig?.archiveAfterDays ?? 2}
                            onChange={(e) =>
                              updateGlobalConfig({ archiveAfterDays: Math.max(0, parseInt(e.target.value) || 0) })
                            }
                          />
                          <span className="text-sm text-text-secondary w-10">days</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-[13px] text-text-primary">
                          Auto-delete archived worktrees after
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            className={inputClass + " !w-16 text-center"}
                            value={appConfig?.deleteAfterDays ?? 0}
                            onChange={(e) =>
                              updateGlobalConfig({ deleteAfterDays: Math.max(0, parseInt(e.target.value) || 0) })
                            }
                          />
                          <span className="text-sm text-text-secondary w-10">days</span>
                        </div>
                      </div>
                      <p className="text-xs text-text-tertiary">
                        Set to 0 to disable.
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === "scripts" && (
              <div>
                {currentMode === "worktree" && (
                  <>
                    {/* Setup Scripts */}
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary mb-3.5">
                      Setup Scripts
                    </div>
                    <p className="text-xs text-text-tertiary -mt-2 mb-3">
                      Run automatically when a new worktree is created.
                    </p>
                    <div className="relative">
                      <textarea
                        className={textareaClass}
                        rows={2}
                        style={{ fieldSizing: "content" } as React.CSSProperties}
                        placeholder="Command (e.g. npm install)"
                        value={config.setupScripts[0]?.command ?? ""}
                        onChange={(e) =>
                          updateConfig({
                            setupScripts: e.target.value.trim()
                              ? [{ name: "Setup", command: e.target.value, runOn: "create" }]
                              : [],
                          })
                        }
                      />
                      <CopyButton value={config.setupScripts[0]?.command ?? ""} />
                    </div>
                  </>
                )}

                {/* Run Script */}
                <div className={`text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary mb-3.5 ${currentMode === "worktree" ? "mt-8" : ""}`}>
                  Run Script
                </div>
                <p className="text-xs text-text-tertiary -mt-2 mb-3">
                  Started from any {currentMode === "worktree" ? "worktree" : "branch"} via the play button in the tab bar.
                </p>
                <div className="relative">
                  <textarea
                    className={textareaClass}
                    rows={2}
                    style={{ fieldSizing: "content" } as React.CSSProperties}
                    placeholder="Command (e.g. npm run dev)"
                    value={config.runScript?.command ?? ""}
                    onChange={(e) =>
                      updateConfig({
                        runScript: e.target.value.trim()
                          ? { name: "Run", command: e.target.value }
                          : null,
                      })
                    }
                  />
                  <CopyButton value={config.runScript?.command ?? ""} />
                </div>

                {currentMode === "worktree" && (
                  <>
                    {/* Archive Script */}
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary mb-3.5 mt-8">
                      Archive Script
                    </div>
                    <p className="text-xs text-text-tertiary -mt-2 mb-3">
                      Runs when a worktree is archived.
                    </p>
                    <div className="relative">
                      <textarea
                        className={textareaClass}
                        rows={2}
                        style={{ fieldSizing: "content" } as React.CSSProperties}
                        placeholder="Command (e.g. docker compose down)"
                        value={config.archiveScript ?? ""}
                        onChange={(e) =>
                          updateConfig({
                            archiveScript: e.target.value.trim() ? e.target.value : null,
                          })
                        }
                      />
                      <CopyButton value={config.archiveScript ?? ""} />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-border-default">
          {saveError && (
            <span className="text-xs text-status-error mr-auto truncate" title={saveError}>
              {saveError}
            </span>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!dirty || saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { WorkspaceSettingsDialog };

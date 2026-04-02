import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import type { AppConfig, RepoEntry, SetupScript } from "../../types";
import { getConfig, saveConfig } from "../../api";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { Button } from "../ui/Button";
import {
  Dialog,
  DialogContent,
} from "../ui/Dialog";
import { RepoDropdown } from "../ui/RepoDropdown";
import { ScriptEditor } from "./ScriptEditor";

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
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [currentRepoPath, setCurrentRepoPath] = useState(
    defaultRepoPath ?? repoPath,
  );
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const prevOpenRef = useRef(false);

  // Reset currentRepoPath and display name draft when dialog opens
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      const initPath = defaultRepoPath ?? repoPath;
      setCurrentRepoPath(initPath);
      setDisplayNameDraft(repoDisplayNames[initPath] ?? "");
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
  }, [open, currentRepoPath]);

  const updateConfig = useCallback((patch: Partial<AppConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
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
    },
    [currentRepoPath, dirty, repoDisplayNames],
  );

  const handleSave = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    try {
      await saveConfig(currentRepoPath, config);
      const newName = displayNameDraft.trim() || null;
      const oldName = repoDisplayNames[currentRepoPath] ?? null;
      if (newName !== oldName) {
        await onSetRepoDisplayName?.(currentRepoPath, newName);
      }
      // Sync archive/delete settings to workspace store
      const wsStore = useWorkspaceStore.getState();
      if (config.archiveAfterDays != null && config.archiveAfterDays !== wsStore.archiveAfterDays) {
        useWorkspaceStore.setState({ archiveAfterDays: config.archiveAfterDays });
      }
      if (config.deleteAfterDays != null && config.deleteAfterDays !== wsStore.deleteAfterDays) {
        useWorkspaceStore.setState({ deleteAfterDays: config.deleteAfterDays });
      }
      setDirty(false);
      window.dispatchEvent(new Event("config-changed"));
      onOpenChange(false);
    } catch {
      setDirty(false);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }, [config, currentRepoPath, onOpenChange]);

  if (!config) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[680px] p-0 overflow-hidden">
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
                    }}
                  />
                  <p className="text-xs text-text-tertiary mt-[5px]">
                    Short name shown in sidebar repo chips. Defaults to directory name.
                  </p>
                </div>

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
                        value={config.archiveAfterDays ?? 2}
                        onChange={(e) =>
                          updateConfig({ archiveAfterDays: Math.max(0, parseInt(e.target.value) || 0) })
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
                        value={config.deleteAfterDays ?? 7}
                        onChange={(e) =>
                          updateConfig({ deleteAfterDays: Math.max(0, parseInt(e.target.value) || 0) })
                        }
                      />
                      <span className="text-sm text-text-secondary w-10">days</span>
                    </div>
                  </div>
                  <p className="text-xs text-text-tertiary">
                    Set to 0 to disable.
                  </p>
                </div>
              </div>
            )}

            {tab === "scripts" && (
              <div>
                {/* Run Script */}
                <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary mb-3.5">
                  Run Script
                </div>
                <p className="text-xs text-text-tertiary -mt-2 mb-3">
                  Started from any worktree via the play button in the tab bar.
                </p>
                <div className="rounded-[var(--radius-md)] border border-border-default bg-bg-primary p-3 space-y-2">
                  <input
                    type="text"
                    className={inputClass}
                    placeholder="Name (e.g. Dev Server)"
                    value={config.runScript?.name ?? ""}
                    onChange={(e) =>
                      updateConfig({
                        runScript: e.target.value || config.runScript?.command
                          ? { name: e.target.value, command: config.runScript?.command ?? "" }
                          : null,
                      })
                    }
                  />
                  <textarea
                    className={textareaClass}
                    rows={3}
                    placeholder="Command (e.g. npm run dev)"
                    value={config.runScript?.command ?? ""}
                    onChange={(e) =>
                      updateConfig({
                        runScript: config.runScript?.name || e.target.value
                          ? { name: config.runScript?.name ?? "", command: e.target.value }
                          : null,
                      })
                    }
                  />
                </div>

                {/* Setup Scripts */}
                <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary mb-3.5 mt-8">
                  Setup Scripts
                </div>
                <p className="text-xs text-text-tertiary -mt-2 mb-3">
                  Run automatically when a new worktree is created.
                </p>
                <ScriptEditor
                  scripts={config.setupScripts}
                  onChange={(scripts: SetupScript[]) =>
                    updateConfig({ setupScripts: scripts })
                  }
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-border-default">
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { WorkspaceSettingsDialog };

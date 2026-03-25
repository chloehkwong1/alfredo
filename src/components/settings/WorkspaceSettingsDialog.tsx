import { useCallback, useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import type { AppConfig, SetupScript } from "../../types";
import { getConfig, saveConfig } from "../../api";
import { Button } from "../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/Dialog";
import { ScriptEditor } from "./ScriptEditor";

type WorkspaceTab = "repository" | "scripts" | "display";

const TABS: { id: WorkspaceTab; label: string }[] = [
  { id: "repository", label: "Repository" },
  { id: "scripts", label: "Scripts" },
  { id: "display", label: "Display" },
];

interface WorkspaceSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function WorkspaceSettingsDialog({
  open,
  onOpenChange,
}: WorkspaceSettingsDialogProps) {
  const [tab, setTab] = useState<WorkspaceTab>("repository");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Load config when dialog opens
  useEffect(() => {
    if (!open) return;
    getConfig(".")
      .then((c) => {
        setConfig(c);
        setDirty(false);
      })
      .catch(() => {
        setConfig({
          repoPath: ".",
          setupScripts: [],
          githubToken: null,
          linearApiKey: null,
          branchMode: false,
          worktreeBasePath: null,
        });
      });
  }, [open]);

  const updateConfig = useCallback((patch: Partial<AppConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    try {
      await saveConfig(".", config);
      setDirty(false);
      onOpenChange(false);
    } catch {
      // Backend not available — close anyway during dev
      setDirty(false);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }, [config, onOpenChange]);

  if (!config) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Workspace Settings</DialogTitle>
        </DialogHeader>

        {/* Vertical tab layout */}
        <div className="flex gap-6 min-h-[280px]">
          {/* Tab rail */}
          <nav className="flex flex-col gap-0.5 w-36 flex-shrink-0 border-r border-border-default pr-4">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={[
                  "px-3 py-1.5 text-sm rounded-[var(--radius-md)] text-left",
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

          {/* Tab content */}
          <div className="flex-1 min-w-0">
            {tab === "repository" && (
              <div className="space-y-5">
                {/* Repo Path (read-only) */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-text-primary">
                    Repository Path
                  </label>
                  <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border-default bg-bg-secondary px-3 h-8 text-sm text-text-secondary">
                    <FolderOpen className="h-4 w-4 flex-shrink-0 text-text-tertiary" />
                    <span className="truncate">
                      {config.repoPath && config.repoPath !== "." ? config.repoPath : "No repository configured"}
                    </span>
                  </div>
                </div>

                {/* Worktree Base Path */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-text-primary">
                    Worktree Directory
                  </label>
                  <p className="text-xs text-text-tertiary">
                    Where new worktrees are created. Defaults to the parent of the repository.
                  </p>
                  <input
                    type="text"
                    className="w-full rounded-[var(--radius-md)] border border-border-default bg-bg-primary px-3 h-8 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent-primary"
                    placeholder="e.g. /Users/you/worktrees"
                    value={config.worktreeBasePath ?? ""}
                    onChange={(e) =>
                      updateConfig({
                        worktreeBasePath: e.target.value || null,
                      })
                    }
                  />
                </div>

                {/* Default Branch */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-text-primary">
                    Default Branch
                  </label>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-bg-hover text-text-tertiary">Coming soon</span>
                </div>
              </div>
            )}

            {tab === "scripts" && (
              <ScriptEditor
                scripts={config.setupScripts}
                onChange={(scripts: SetupScript[]) =>
                  updateConfig({ setupScripts: scripts })
                }
              />
            )}

            {tab === "display" && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-text-primary">
                      Collapse empty status groups
                    </label>
                    <p className="text-xs text-text-tertiary mt-0.5">
                      Hide status groups with no worktrees in the sidebar.
                    </p>
                  </div>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-bg-hover text-text-tertiary">Coming soon</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { WorkspaceSettingsDialog };

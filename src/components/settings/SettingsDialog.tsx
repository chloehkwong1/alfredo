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
import { GithubSettings } from "./GithubSettings";
import { ScriptEditor } from "./ScriptEditor";
import { TerminalSettings } from "./TerminalSettings";

type SettingsTab = "general" | "terminal" | "scripts" | "integrations";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "terminal", label: "Terminal" },
  { id: "scripts", label: "Scripts" },
  { id: "integrations", label: "Integrations" },
];

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>("general");
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
        // Backend not available — use defaults
        setConfig({
          repoPath: ".",
          setupScripts: [],
          githubToken: null,
          linearApiKey: null,
          branchMode: false,
        });
      });
  }, [open]);

  const updateConfig = useCallback(
    (patch: Partial<AppConfig>) => {
      setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
      setDirty(true);
    },
    [],
  );

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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-border-default mb-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={[
                "px-3 py-2 text-sm font-medium",
                "border-b-2 -mb-px transition-colors duration-[var(--transition-fast)]",
                "cursor-pointer",
                tab === t.id
                  ? "border-accent-primary text-text-primary"
                  : "border-transparent text-text-tertiary hover:text-text-secondary",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="min-h-[260px]">
          {tab === "general" && (
            <GeneralTab
              config={config}
              onBranchModeChange={(v) => updateConfig({ branchMode: v })}
            />
          )}
          {tab === "terminal" && <TerminalSettings />}
          {tab === "scripts" && (
            <ScriptEditor
              scripts={config.setupScripts}
              onChange={(scripts: SetupScript[]) =>
                updateConfig({ setupScripts: scripts })
              }
            />
          )}
          {tab === "integrations" && (
            <GithubSettings
              githubToken={config.githubToken ?? ""}
              linearApiKey={config.linearApiKey ?? ""}
              onGithubTokenChange={(v) =>
                updateConfig({ githubToken: v || null })
              }
              onLinearApiKeyChange={(v) =>
                updateConfig({ linearApiKey: v || null })
              }
            />
          )}
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

// ── General Tab (inline since it's small) ────────────────────────

function GeneralTab({
  config,
  onBranchModeChange,
}: {
  config: AppConfig;
  onBranchModeChange: (value: boolean) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Repo Path */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-text-primary">
          Repository Path
        </label>
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border-default bg-bg-secondary px-3 h-8 text-sm text-text-secondary">
          <FolderOpen className="h-4 w-4 flex-shrink-0 text-text-tertiary" />
          <span className="truncate">{config.repoPath || "."}</span>
        </div>
      </div>

      {/* Branch Mode */}
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium text-text-primary">
            Branch Mode
          </label>
          <p className="text-xs text-text-tertiary mt-0.5">
            Show branches instead of worktrees on the board.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={config.branchMode}
          onClick={() => onBranchModeChange(!config.branchMode)}
          className={[
            "relative inline-flex h-5 w-9 items-center rounded-full",
            "transition-colors duration-[var(--transition-fast)]",
            "cursor-pointer",
            config.branchMode ? "bg-accent-primary" : "bg-bg-active",
          ].join(" ")}
        >
          <span
            className={[
              "inline-block h-3.5 w-3.5 rounded-full bg-white",
              "transition-transform duration-[var(--transition-fast)]",
              config.branchMode
                ? "translate-x-[18px]"
                : "translate-x-[3px]",
            ].join(" ")}
          />
        </button>
      </div>
    </div>
  );
}

export { SettingsDialog };

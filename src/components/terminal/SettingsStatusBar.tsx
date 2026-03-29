import { useState, useEffect, useCallback } from "react";
import { RotateCcw, SquarePen, TerminalSquare } from "lucide-react";
import { Button } from "../ui/Button";
import { SettingsChip } from "./SettingsChip";
import { getConfig, saveConfig, openInEditor, openInTerminal, getAppConfig } from "../../api";
import { useAppConfig } from "../../hooks/useAppConfig";
import { resolveSettings } from "../../services/claudeSettingsResolver";
import type { ClaudeOverrides } from "../../types";

const CLAUDE_DEFAULTS = {
  effort: "high",
  permissionMode: "default",
  outputStyle: "Default",
} as const;

const EFFORT_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
];

const PERMISSION_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "acceptEdits", label: "Accept Edits" },
  { value: "plan", label: "Plan" },
  { value: "auto", label: "Auto" },
  { value: "dontAsk", label: "Don't Ask" },
  { value: "bypassPermissions", label: "Bypass" },
];

const OUTPUT_OPTIONS = [
  { value: "Default", label: "Default" },
  { value: "Explanatory", label: "Explanatory" },
  { value: "Learning", label: "Learning" },
];

function displayLabel(options: { value: string; label: string }[], value: string | undefined, defaultValue: string): string {
  const effective = value || defaultValue;
  return options.find((o) => o.value === effective)?.label ?? effective;
}

interface SettingsStatusBarProps {
  branch: string;
  worktreePath: string;
  onRestartSession: () => void;
}

function SettingsStatusBar({ branch, worktreePath, onRestartSession }: SettingsStatusBarProps) {
  const { activeRepo: repoPath } = useAppConfig();
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Resolved settings (defaults merged with overrides)
  const [resolved, setResolved] = useState<{
    effort?: string;
    permissionMode?: string;
    outputStyle?: string;
  }>({});

  // Load resolved settings on mount and branch change
  useEffect(() => {
    if (!repoPath) return;
    Promise.all([getAppConfig(), getConfig(repoPath)]).then(([appCfg, config]) => {
      const merged = resolveSettings(
        appCfg,
        config.claudeDefaults,
        config.worktreeOverrides?.[branch],
      );
      setResolved({
        effort: merged.effort,
        permissionMode: merged.permissionMode,
        outputStyle: merged.outputStyle,
      });
    }).catch((err) => { console.error("Failed to load settings:", err); });
  }, [repoPath, branch]);

  const handleChange = useCallback(async (field: keyof ClaudeOverrides, value: string) => {
    if (!repoPath) return;

    // Update local state immediately
    const prev = { ...resolved };  // capture for rollback
    setResolved((r) => ({ ...r, [field]: value }));
    setHasChanges(true);

    try {
      // Save to worktreeOverrides
      const config = await getConfig(repoPath);
      const allOverrides = { ...config.worktreeOverrides };
      const current = allOverrides[branch] ?? {};
      const next = { ...current, [field]: value || undefined };

      // Clean out undefined/falsy values
      const cleaned: ClaudeOverrides = {};
      if (next.effort) cleaned.effort = next.effort;
      if (next.permissionMode) cleaned.permissionMode = next.permissionMode;
      if (next.outputStyle && next.outputStyle !== "Default") cleaned.outputStyle = next.outputStyle;

      if (Object.keys(cleaned).length > 0) {
        allOverrides[branch] = cleaned;
      } else {
        delete allOverrides[branch];
      }

      await saveConfig(repoPath, {
        ...config,
        worktreeOverrides: Object.keys(allOverrides).length > 0 ? allOverrides : undefined,
      });
    } catch (err) {
      console.error("Failed to save settings:", err);
      setResolved(prev);
      setHasChanges(false);
    }
  }, [repoPath, branch, resolved]);

  const toggleDropdown = useCallback((name: string) => {
    setOpenDropdown((prev) => (prev === name ? null : name));
  }, []);

  const handleRestart = useCallback(() => {
    setHasChanges(false);
    onRestartSession();
  }, [onRestartSession]);

  const handleOpenEditor = useCallback(async () => {
    if (!worktreePath) return;
    try {
      const appCfg = await getAppConfig();
      await openInEditor(worktreePath, appCfg.preferredEditor, appCfg.customEditorPath ?? undefined);
    } catch (e) {
      console.error("Failed to open editor:", e);
    }
  }, [worktreePath]);

  const handleOpenTerminal = useCallback(async () => {
    if (!worktreePath) return;
    try {
      const appCfg = await getAppConfig();
      await openInTerminal(worktreePath, appCfg.preferredTerminal, appCfg.customTerminalPath ?? undefined);
    } catch (e) {
      console.error("Failed to open terminal:", e);
    }
  }, [worktreePath]);

  return (
    <div className="flex items-center justify-between px-2 py-1 border-t border-border-default flex-shrink-0">
      <div className="flex items-center gap-1.5">
        <SettingsChip
          label={displayLabel(EFFORT_OPTIONS, resolved.effort, CLAUDE_DEFAULTS.effort)}
          options={EFFORT_OPTIONS}
          value={resolved.effort ?? ""}
          isOpen={openDropdown === "effort"}
          onToggle={() => toggleDropdown("effort")}
          onChange={(v) => handleChange("effort", v)}
        />
        <SettingsChip
          label={displayLabel(PERMISSION_OPTIONS, resolved.permissionMode, CLAUDE_DEFAULTS.permissionMode)}
          options={PERMISSION_OPTIONS}
          value={resolved.permissionMode ?? ""}
          isOpen={openDropdown === "permissionMode"}
          onToggle={() => toggleDropdown("permissionMode")}
          onChange={(v) => handleChange("permissionMode", v)}
        />
        <SettingsChip
          label={displayLabel(OUTPUT_OPTIONS, resolved.outputStyle, CLAUDE_DEFAULTS.outputStyle)}
          options={OUTPUT_OPTIONS}
          value={resolved.outputStyle ?? ""}
          isOpen={openDropdown === "outputStyle"}
          onToggle={() => toggleDropdown("outputStyle")}
          onChange={(v) => handleChange("outputStyle", v)}
        />
      </div>

      <div className="flex items-center gap-2">
        {hasChanges && (
          <>
            <span className="text-xs text-text-tertiary">Settings changed</span>
            <Button size="sm" variant="secondary" onClick={handleRestart}>
              <RotateCcw size={10} />
              Restart
            </Button>
          </>
        )}
        <button
          type="button"
          onClick={handleOpenEditor}
          className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
          title="Open in editor"
        >
          <SquarePen size={13} />
          Editor
        </button>
        <button
          type="button"
          onClick={handleOpenTerminal}
          className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
          title="Open in terminal"
        >
          <TerminalSquare size={13} />
          Terminal
        </button>
      </div>
    </div>
  );
}

export { SettingsStatusBar };

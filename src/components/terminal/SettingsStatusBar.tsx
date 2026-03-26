import { useState, useEffect, useCallback } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "../ui/Button";
import { SettingsChip } from "./SettingsChip";
import { getConfig, saveConfig } from "../../api";
import { useAppConfig } from "../../hooks/useAppConfig";
import { resolveSettings } from "../../services/claudeSettingsResolver";
import type { ClaudeOverrides } from "../../types";

const MODEL_OPTIONS = [
  { value: "", label: "Default" },
  { value: "claude-opus-4-6", label: "Opus 4.6" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5" },
];

const EFFORT_OPTIONS = [
  { value: "", label: "Default" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
];

const PERMISSION_OPTIONS = [
  { value: "", label: "Default" },
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

function displayLabel(options: { value: string; label: string }[], value: string | undefined, fallback: string): string {
  return options.find((o) => o.value === value)?.label ?? fallback;
}

interface SettingsStatusBarProps {
  branch: string;
  onRestartSession: () => void;
}

function SettingsStatusBar({ branch, onRestartSession }: SettingsStatusBarProps) {
  const { activeRepo: repoPath } = useAppConfig();
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Resolved settings (defaults merged with overrides)
  const [resolved, setResolved] = useState<{
    model?: string;
    effort?: string;
    permissionMode?: string;
    outputStyle?: string;
  }>({});

  // Load resolved settings on mount and branch change
  useEffect(() => {
    if (!repoPath) return;
    getConfig(repoPath).then((config) => {
      const merged = resolveSettings(
        config.claudeDefaults,
        config.worktreeOverrides?.[branch],
      );
      setResolved({
        model: merged.model,
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
      if (next.model) cleaned.model = next.model;
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

  return (
    <div className="flex items-center justify-between px-2 py-1 border-t border-border-default flex-shrink-0">
      <div className="flex items-center gap-1.5">
        <SettingsChip
          label={displayLabel(MODEL_OPTIONS, resolved.model, "Model")}
          options={MODEL_OPTIONS}
          value={resolved.model ?? ""}
          isOpen={openDropdown === "model"}
          onToggle={() => toggleDropdown("model")}
          onChange={(v) => handleChange("model", v)}
        />
        <SettingsChip
          label={displayLabel(EFFORT_OPTIONS, resolved.effort, "Effort")}
          options={EFFORT_OPTIONS}
          value={resolved.effort ?? ""}
          isOpen={openDropdown === "effort"}
          onToggle={() => toggleDropdown("effort")}
          onChange={(v) => handleChange("effort", v)}
        />
        <SettingsChip
          label={displayLabel(PERMISSION_OPTIONS, resolved.permissionMode, "Permissions")}
          options={PERMISSION_OPTIONS}
          value={resolved.permissionMode ?? ""}
          isOpen={openDropdown === "permissionMode"}
          onToggle={() => toggleDropdown("permissionMode")}
          onChange={(v) => handleChange("permissionMode", v)}
        />
        <SettingsChip
          label={displayLabel(OUTPUT_OPTIONS, resolved.outputStyle, "Output")}
          options={OUTPUT_OPTIONS}
          value={resolved.outputStyle ?? ""}
          isOpen={openDropdown === "outputStyle"}
          onToggle={() => toggleDropdown("outputStyle")}
          onChange={(v) => handleChange("outputStyle", v)}
        />
      </div>

      {hasChanges && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-tertiary">Settings changed</span>
          <Button size="sm" variant="secondary" onClick={handleRestart}>
            <RotateCcw size={10} />
            Restart
          </Button>
        </div>
      )}
    </div>
  );
}

export { SettingsStatusBar };

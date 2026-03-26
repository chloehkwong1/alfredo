import { useState, useEffect, useCallback } from "react";
import { Settings, RotateCcw } from "lucide-react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { getConfig, saveConfig } from "../../api";
import { useAppConfig } from "../../hooks/useAppConfig";
import type { ClaudeOverrides } from "../../types";

const MODEL_OPTIONS = [
  { value: "", label: "Default" },
  { value: "claude-opus-4-6", label: "Opus 4.6" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5" },
];

const EFFORT_OPTIONS = ["low", "medium", "high", "max"] as const;
const PERMISSION_OPTIONS = [
  { value: "", label: "Default" },
  { value: "accept-edits", label: "Accept Edits" },
  { value: "plan", label: "Plan" },
  { value: "auto", label: "Auto" },
];
const OUTPUT_OPTIONS = ["Default", "Explanatory", "Learning"] as const;

interface AgentSettingsPopoverProps {
  branch: string;
  onRestartSession: () => void;
}

function AgentSettingsPopover({ branch, onRestartSession }: AgentSettingsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [overrides, setOverrides] = useState<ClaudeOverrides>({});
  const { activeRepo: repoPath } = useAppConfig();

  useEffect(() => {
    if (!open || !repoPath) return;
    getConfig(repoPath).then((config) => {
      setOverrides(config.worktreeOverrides?.[branch] ?? {});
    }).catch(() => {});
  }, [open, repoPath, branch]);

  const hasOverrides = Object.values(overrides).some((v) => v !== undefined);

  const save = useCallback(async (next: ClaudeOverrides) => {
    if (!repoPath) return;
    const config = await getConfig(repoPath);
    const allOverrides = { ...config.worktreeOverrides };

    // Clean out undefined values
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
  }, [repoPath, branch]);

  const update = useCallback(async (patch: Partial<ClaudeOverrides>) => {
    const next = { ...overrides, ...patch };
    setOverrides(next);
    await save(next);
  }, [overrides, save]);

  const resetAll = useCallback(async () => {
    setOverrides({});
    await save({});
  }, [save]);

  if (!open) {
    return (
      <IconButton
        size="sm"
        onClick={() => setOpen(true)}
        label="Agent settings for this worktree"
      >
        <Settings size={14} className={hasOverrides ? "text-accent-primary" : ""} />
      </IconButton>
    );
  }

  return (
    <>
      <IconButton
        size="sm"
        onClick={() => setOpen(false)}
        label="Close agent settings"
      >
        <Settings size={14} className="text-accent-primary" />
      </IconButton>

      {/* Popover */}
      <div className="absolute bottom-full right-0 mb-2 w-72 bg-bg-primary border border-border-default rounded-[var(--radius-lg)] shadow-lg p-4 space-y-3 z-50">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-text-primary">
            Worktree Settings
          </h3>
          {hasOverrides && (
            <button
              type="button"
              onClick={resetAll}
              className="text-xs text-accent-primary hover:underline cursor-pointer"
            >
              Reset all
            </button>
          )}
        </div>

        {/* Model */}
        <div className="space-y-1">
          <label className="text-xs text-text-secondary">Model</label>
          <select
            value={overrides.model ?? ""}
            onChange={(e) => update({ model: e.target.value || undefined })}
            className={[
              "w-full px-2 py-1 text-xs bg-bg-hover text-text-primary border rounded-[var(--radius-sm)] focus:outline-none focus:ring-1 focus:ring-accent-primary",
              overrides.model ? "border-accent-primary text-accent-primary" : "border-border-default",
            ].join(" ")}
          >
            {MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Effort */}
        <div className="space-y-1">
          <label className="text-xs text-text-secondary">Effort</label>
          <div className="flex rounded-[var(--radius-sm)] border border-border-default overflow-hidden">
            {EFFORT_OPTIONS.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => update({ effort: overrides.effort === level ? undefined : level })}
                className={[
                  "flex-1 px-2 py-1 text-xs capitalize transition-colors cursor-pointer",
                  overrides.effort === level
                    ? "bg-accent-primary text-white"
                    : "bg-bg-hover text-text-secondary hover:text-text-primary",
                ].join(" ")}
              >
                {level}
              </button>
            ))}
          </div>
        </div>

        {/* Output Style */}
        <div className="space-y-1">
          <label className="text-xs text-text-secondary">Output Style</label>
          <div className="flex rounded-[var(--radius-sm)] border border-border-default overflow-hidden">
            {OUTPUT_OPTIONS.map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => update({ outputStyle: overrides.outputStyle === style ? undefined : style })}
                className={[
                  "flex-1 px-2 py-1 text-xs transition-colors cursor-pointer",
                  overrides.outputStyle === style
                    ? "bg-accent-primary text-white"
                    : "bg-bg-hover text-text-secondary hover:text-text-primary",
                ].join(" ")}
              >
                {style}
              </button>
            ))}
          </div>
        </div>

        {/* Permission Mode */}
        <div className="space-y-1">
          <label className="text-xs text-text-secondary">Permission Mode</label>
          <select
            value={overrides.permissionMode ?? ""}
            onChange={(e) => update({ permissionMode: e.target.value || undefined })}
            className={[
              "w-full px-2 py-1 text-xs bg-bg-hover text-text-primary border rounded-[var(--radius-sm)] focus:outline-none focus:ring-1 focus:ring-accent-primary",
              overrides.permissionMode ? "border-accent-primary" : "border-border-default",
            ].join(" ")}
          >
            {PERMISSION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-border-default flex items-center justify-between">
          <span className="text-xs text-text-tertiary">Requires session restart</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setOpen(false);
              onRestartSession();
            }}
          >
            <RotateCcw size={10} />
            Restart now
          </Button>
        </div>
      </div>
    </>
  );
}

export { AgentSettingsPopover };

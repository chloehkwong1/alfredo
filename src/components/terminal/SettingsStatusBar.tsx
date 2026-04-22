import { useState, useEffect, useCallback } from "react";
import { RotateCcw, Smartphone } from "lucide-react";
import { Button } from "../ui/Button";
import { SettingsChip } from "./SettingsChip";
import { getConfig, saveConfig, getAppConfig, setWorktreePort } from "../../api";
import { OpenInDropdown } from "../ui/OpenInDropdown";
import { useAppConfig } from "../../hooks/useAppConfig";
import { useOutputStyles } from "../../hooks/useOutputStyles";
import { resolveSettings } from "../../services/claudeSettingsResolver";
import { toggleRemoteControl } from "../../services/remoteControl";
import { useRemoteControlStore } from "../../stores/remoteControlStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
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

function displayLabel(options: { value: string; label: string }[], value: string | undefined, defaultValue: string): string {
  const effective = value || defaultValue;
  return options.find((o) => o.value === effective)?.label ?? effective;
}

interface SettingsStatusBarProps {
  branch: string;
  worktreePath: string;
  worktreeId: string;
  sessionKey?: string;
  onRestartSession?: () => void;
  showClaudeSettings?: boolean;
  assignedPort?: number | null;
}

function SettingsStatusBar({ branch, worktreePath, worktreeId, sessionKey = "", onRestartSession, showClaudeSettings = true, assignedPort }: SettingsStatusBarProps) {
  const { activeRepo: repoPath } = useAppConfig();
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [editingPort, setEditingPort] = useState(false);
  const [portValue, setPortValue] = useState("");
  const [portError, setPortError] = useState<string | null>(null);
  const outputOptions = useOutputStyles(repoPath);

  // Resolved settings (defaults merged with overrides)
  const [resolved, setResolved] = useState<{
    effort?: string;
    permissionMode?: string;
    outputStyle?: string;
  }>({});

  // Load resolved settings on mount and branch change
  useEffect(() => {
    if (!repoPath || !showClaudeSettings) return;
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
    onRestartSession?.();
  }, [onRestartSession]);

  const linearTicketUrl = useWorkspaceStore(
    useCallback((s) => s.worktrees.find((wt) => wt.id === worktreeId)?.linearTicketUrl, [worktreeId]),
  );

  const isRcActive = useRemoteControlStore(
    useCallback((s) => worktreeId in s.sessions, [worktreeId]),
  );

  const handleToggleRemote = useCallback(() => {
    toggleRemoteControl(worktreeId, sessionKey);
  }, [worktreeId, sessionKey]);

  const handlePortSave = useCallback(async (value: string) => {
    const port = parseInt(value, 10);
    if (isNaN(port) || port < 1024 || port > 65535) {
      setPortError("Invalid port (1024-65535)");
      return;
    }
    if (port === assignedPort) {
      setEditingPort(false);
      return;
    }
    if (!repoPath) return;
    try {
      await setWorktreePort(repoPath, worktreeId, port);
      setEditingPort(false);
      setPortError(null);
      setHasChanges(true);
      // Optimistically update the store so sidebar/toolbar reflect the new port immediately
      useWorkspaceStore.getState().updateWorktree(worktreeId, { assignedPort: port });
    } catch (e: unknown) {
      setPortError(e instanceof Error ? e.message : String(e));
    }
  }, [repoPath, worktreeId, assignedPort]);

  return (
    <div className="flex items-center justify-between px-2 py-1 border-t border-border-default flex-shrink-0">
      <div className="flex items-center gap-1.5">
        {showClaudeSettings && (
          <>
            <SettingsChip
              label={displayLabel(EFFORT_OPTIONS, resolved.effort, CLAUDE_DEFAULTS.effort)}
              prefix="Effort"
              options={EFFORT_OPTIONS}
              value={resolved.effort ?? ""}
              isOpen={openDropdown === "effort"}
              onToggle={() => toggleDropdown("effort")}
              onChange={(v) => handleChange("effort", v)}
            />
            <SettingsChip
              label={displayLabel(PERMISSION_OPTIONS, resolved.permissionMode, CLAUDE_DEFAULTS.permissionMode)}
              prefix="Permissions"
              options={PERMISSION_OPTIONS}
              value={resolved.permissionMode ?? ""}
              isOpen={openDropdown === "permissionMode"}
              onToggle={() => toggleDropdown("permissionMode")}
              onChange={(v) => handleChange("permissionMode", v)}
            />
            <SettingsChip
              label={displayLabel(outputOptions, resolved.outputStyle, CLAUDE_DEFAULTS.outputStyle)}
              prefix="Output Style"
              options={outputOptions}
              value={resolved.outputStyle ?? ""}
              isOpen={openDropdown === "outputStyle"}
              onToggle={() => toggleDropdown("outputStyle")}
              onChange={(v) => handleChange("outputStyle", v)}
            />
          </>
        )}
        {assignedPort != null && (
          <div className="relative">
            {editingPort ? (
              <input
                type="text"
                autoFocus
                value={portValue}
                onChange={(e) => { setPortValue(e.target.value); setPortError(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { handlePortSave(portValue); }
                  if (e.key === "Escape") { setEditingPort(false); setPortError(null); }
                }}
                onBlur={() => { handlePortSave(portValue); }}
                className="w-[72px] px-2 py-0.5 text-xs text-text-primary bg-bg-hover border border-accent-primary/50 rounded-[var(--radius-sm)] outline-none tabular-nums"
              />
            ) : (
              <button
                type="button"
                onClick={() => { setPortValue(String(assignedPort)); setEditingPort(true); setPortError(null); }}
                className="flex items-center gap-1 px-2 py-0.5 text-xs text-text-secondary bg-bg-hover border border-border-default rounded-[var(--radius-sm)] hover:text-text-primary hover:border-border-hover transition-colors cursor-pointer"
              >
                <span className="text-[10px] text-text-tertiary font-normal">Port</span>
                :{assignedPort}
              </button>
            )}
            {portError && (
              <div className="absolute bottom-full left-0 mb-1 px-2 py-1 text-[10px] text-status-error bg-bg-primary border border-status-error/30 rounded whitespace-nowrap z-50">
                {portError}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {showClaudeSettings && hasChanges && (
          <>
            <span className="text-xs text-text-tertiary">Settings changed</span>
            <Button size="sm" variant="secondary" onClick={handleRestart}>
              <RotateCcw size={10} />
              Restart
            </Button>
          </>
        )}
        {showClaudeSettings && (
          <button
            type="button"
            onClick={handleToggleRemote}
            className={[
              "flex items-center gap-1 text-xs transition-all cursor-pointer",
              isRcActive
                ? "text-accent-primary drop-shadow-[0_0_4px_var(--accent-primary)]"
                : "text-text-tertiary hover:text-text-secondary",
            ].join(" ")}
            title={isRcActive ? "Remote Control: On" : "Remote Control: Off"}
          >
            <Smartphone size={13} />
            Remote
          </button>
        )}
        <OpenInDropdown worktreePath={worktreePath} linearTicketUrl={linearTicketUrl} />
      </div>
    </div>
  );
}

export { SettingsStatusBar };

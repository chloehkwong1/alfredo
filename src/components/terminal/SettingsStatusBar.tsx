import { useState, useEffect, useCallback } from "react";
import { RotateCcw, Smartphone } from "lucide-react";
import { Button } from "../ui/Button";
import { SettingsChip } from "./SettingsChip";
import { getConfig, saveConfig } from "../../api";
import { OpenInDropdown } from "../ui/OpenInDropdown";
import { useAppConfig } from "../../hooks/useAppConfig";
import { useAppConfigStore } from "../../stores/appConfigStore";
import { useOutputStyles } from "../../hooks/useOutputStyles";
import { useEffortOptions, usePermissionModes } from "../../services/modelCatalog";
import { resolveSettings } from "../../services/claudeSettingsResolver";
import { toggleRemoteControl } from "../../services/remoteControl";
import { useRemoteControlStore } from "../../stores/remoteControlStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useTabStore } from "../../stores/tabStore";
import { useLayoutStore } from "../../stores/layoutStore";
import type { ClaudeOverrides } from "../../types";

const CLAUDE_DEFAULTS = {
  effort: "high",
  permissionMode: "default",
  outputStyle: "Default",
} as const;

function displayLabel(options: { value: string; label: string }[], value: string | undefined, defaultValue: string): string {
  const effective = value || defaultValue;
  return options.find((o) => o.value === effective)?.label ?? effective;
}

interface SettingsStatusBarProps {
  worktreeId: string;
}

function SettingsStatusBar({ worktreeId }: SettingsStatusBarProps) {
  const { activeRepo: repoPath } = useAppConfig();
  const worktree = useWorkspaceStore((s) => s.worktrees.find((wt) => wt.id === worktreeId));
  const branch = worktree?.branch ?? "";
  const worktreePath = worktree?.path ?? "";

  // Pick the Claude tab to target for Restart / Remote. Only mounted tabs
  // can respond to a restart event (TerminalView only mounts for the pane's
  // active tab) — so we look across panes for whichever has a Claude tab as
  // its active tab. Chips themselves are worktree-level (saved to
  // worktreeOverrides[branch]) but we still gate on a mounted target so the
  // chip-edit + Restart flow stays coherent.
  const tabs = useTabStore((s) => s.tabs[worktreeId] ?? []);
  const allPanes = useLayoutStore((s) => s.panes[worktreeId]);
  const claudeTargetTab = Object.values(allPanes ?? {})
    .map((p) => tabs.find((t) => t.id === p.activeTabId))
    .find((t) => t?.type === "claude");
  const showClaudeSettings = !!claudeTargetTab;
  const sessionKey = claudeTargetTab?.id ?? "";
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const outputOptions = useOutputStyles(repoPath);
  const effortOptions = useEffortOptions();
  const permissionOptions = usePermissionModes();

  // Resolved settings (defaults merged with overrides)
  const [resolved, setResolved] = useState<{
    effort?: string;
    permissionMode?: string;
    outputStyle?: string;
  }>({});

  // Load resolved settings on mount, branch change, and any global/repo
  // config save. Without the config-changed subscription, changing a global
  // default (e.g. permissionMode) via Global Settings leaves the chip stuck
  // on whatever was resolved at mount.
  const loadResolved = useCallback(() => {
    if (!repoPath || !showClaudeSettings) return;
    const appCfg = useAppConfigStore.getState().config;
    if (!appCfg) return; // store hasn't fetched yet; the subscription below re-fires once it has
    getConfig(repoPath).then((config) => {
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
  }, [repoPath, branch, showClaudeSettings]);

  useEffect(() => { loadResolved(); }, [loadResolved]);

  // Refresh resolved chips whenever the shared app config publishes a new
  // snapshot (covers global default changes from the Global Settings dialog).
  // Replaces a per-component `config-changed` listener that re-fetched the
  // app config independently.
  useEffect(() => {
    const unsubscribe = useAppConfigStore.subscribe((s, prev) => {
      if (s.config !== prev.config) loadResolved();
    });
    return unsubscribe;
  }, [loadResolved]);

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
    if (!claudeTargetTab) return;
    setHasChanges(false);
    window.dispatchEvent(
      new CustomEvent("restart-session", { detail: { tabId: claudeTargetTab.id } }),
    );
  }, [claudeTargetTab]);

  const linearTicketUrl = useWorkspaceStore(
    useCallback((s) => s.worktrees.find((wt) => wt.id === worktreeId)?.linearTicketUrl, [worktreeId]),
  );

  const isRcActive = useRemoteControlStore(
    useCallback((s) => sessionKey in s.sessions, [sessionKey]),
  );

  const handleToggleRemote = useCallback(() => {
    if (!sessionKey) return;
    toggleRemoteControl(sessionKey);
  }, [sessionKey]);

  return (
    <div className="flex items-center justify-between px-2 py-1 border-t border-border-default flex-shrink-0">
      <div className="flex items-center gap-1.5">
        {showClaudeSettings && (
          <>
            <SettingsChip
              label={displayLabel(effortOptions, resolved.effort, CLAUDE_DEFAULTS.effort)}
              prefix="Effort"
              options={effortOptions}
              value={resolved.effort ?? ""}
              isOpen={openDropdown === "effort"}
              onToggle={() => toggleDropdown("effort")}
              onChange={(v) => handleChange("effort", v)}
            />
            <SettingsChip
              label={displayLabel(permissionOptions, resolved.permissionMode, CLAUDE_DEFAULTS.permissionMode)}
              prefix="Permissions"
              options={permissionOptions}
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

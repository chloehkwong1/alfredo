import { useCallback, useEffect, useState } from "react";
import type { AppConfig, GlobalAppConfig } from "../../types";
import { getConfig, saveConfig, getAppConfig, saveAppConfig } from "../../api";
import { Button } from "../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/Dialog";
import { AgentSettings } from "./AgentSettings";
import { GithubSettings } from "./GithubSettings";
import { NotificationSettings } from "./NotificationSettings";
import { DEFAULT_NOTIFICATION_CONFIG } from "./notificationConfig";
import { TerminalSettings } from "./TerminalSettings";
import { ExternalToolsSettings } from "./ExternalToolsSettings";
import { ThemeSelector } from "./ThemeSelector";

type GlobalTab =
  | "appearance"
  | "terminal"
  | "agent"
  | "notifications"
  | "integrations"
  | "shortcuts"
  | "tools";

const TABS: { id: GlobalTab; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "terminal", label: "Terminal" },
  { id: "agent", label: "Agent" },
  { id: "notifications", label: "Notifications" },
  { id: "integrations", label: "Integrations" },
  { id: "tools", label: "External Tools" },
  { id: "shortcuts", label: "Shortcuts" },
];

interface GlobalSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function applyTheme(theme: string) {
  localStorage.setItem("alfredo-theme", theme);
  if (theme === "warm-dark") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

function GlobalSettingsDialog({ open, onOpenChange }: GlobalSettingsDialogProps) {
  const [tab, setTab] = useState<GlobalTab>("appearance");
  // Per-repo config — only used for GitHub token and Linear API key
  const [repoConfig, setRepoConfig] = useState<AppConfig | null>(null);
  // App-level config — theme and notifications
  const [appConfig, setAppConfig] = useState<GlobalAppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [currentTheme, setCurrentTheme] = useState(
    () => localStorage.getItem("alfredo-theme") || "warm-dark",
  );

  // Load config when dialog opens
  useEffect(() => {
    if (!open) return;
    getAppConfig()
      .then((c) => {
        setAppConfig(c);
        setDirty(false);
      })
      .catch(() => {
        setAppConfig({
          repos: [],
          activeRepo: null,
          theme: null,
          notifications: null,
          selectedRepos: [],
          displayName: null,
          repoColors: {},
          repoDisplayNames: {},
          preferredEditor: "vscode",
          customEditorPath: null,
          preferredTerminal: "iterm",
          customTerminalPath: null,
        });
      });
    getConfig(".")
      .then((c) => {
        setRepoConfig(c);
      })
      .catch(() => {
        setRepoConfig({
          repoPath: ".",
          setupScripts: [],
          githubToken: null,
          linearApiKey: null,
          branchMode: false,
        });
      });
    setCurrentTheme(localStorage.getItem("alfredo-theme") || "warm-dark");
  }, [open]);

  const updateAppConfig = useCallback((patch: Partial<GlobalAppConfig>) => {
    setAppConfig((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  }, []);

  const updateRepoConfig = useCallback((patch: Partial<AppConfig>) => {
    setRepoConfig((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  }, []);

  const handleThemeSelect = useCallback((theme: string) => {
    setCurrentTheme(theme);
    applyTheme(theme);
    updateAppConfig({ theme });
  }, [updateAppConfig]);

  const handleSave = useCallback(async () => {
    if (!appConfig || !repoConfig) return;
    setSaving(true);
    try {
      await Promise.all([
        saveAppConfig(appConfig),
        saveConfig(".", repoConfig),
      ]);
      setDirty(false);
      onOpenChange(false);
    } catch {
      // Backend not available — close anyway during dev
      setDirty(false);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }, [appConfig, repoConfig, onOpenChange]);

  if (!appConfig || !repoConfig) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[720px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        {/* Vertical tab layout */}
        <div className="flex gap-6 min-h-[320px]">
          {/* Tab rail */}
          <nav className="flex flex-col gap-1 w-36 flex-shrink-0 pr-6 pt-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={[
                  "px-3 py-2 text-sm rounded-[var(--radius-md)] text-left",
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
          <div className="flex-1 min-w-0 pr-2">
            {tab === "appearance" && (
              <div className="space-y-5">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-text-primary">
                    Theme
                  </label>
                  <ThemeSelector
                    currentTheme={currentTheme}
                    onSelect={handleThemeSelect}
                  />
                </div>
              </div>
            )}

            {tab === "terminal" && <TerminalSettings />}

            {tab === "agent" && (
              <AgentSettings
                settings={repoConfig.claudeDefaults ?? {}}
                onChange={(claudeDefaults) =>
                  updateRepoConfig({ claudeDefaults })
                }
              />
            )}

            {tab === "notifications" && (
              <NotificationSettings
                config={appConfig.notifications ?? DEFAULT_NOTIFICATION_CONFIG}
                onChange={(notifications) => updateAppConfig({ notifications })}
              />
            )}

            {tab === "integrations" && (
              <GithubSettings
                githubToken={repoConfig.githubToken ?? ""}
                linearApiKey={repoConfig.linearApiKey ?? ""}
                onGithubTokenChange={(v) =>
                  updateRepoConfig({ githubToken: v || null })
                }
                onLinearApiKeyChange={(v) =>
                  updateRepoConfig({ linearApiKey: v || null })
                }
              />
            )}

            {tab === "tools" && appConfig && (
              <ExternalToolsSettings
                config={appConfig}
                onChange={(patch) => {
                  setAppConfig((prev) => prev ? { ...prev, ...patch } : prev);
                  setDirty(true);
                }}
              />
            )}

            {tab === "shortcuts" && (
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-text-primary">
                  Keyboard Shortcuts
                </h3>

                {[
                  {
                    label: "Navigation",
                    shortcuts: [
                      { keys: "↑ / ↓", description: "Navigate between worktrees" },
                      { keys: "⌘ 1–9", description: "Jump to worktree by position" },
                    ],
                  },
                  {
                    label: "Tabs & Panes",
                    shortcuts: [
                      { keys: "⌘ N", description: "New worktree" },
                      { keys: "⌘ T", description: "New tab" },
                      { keys: "⌘ W", description: "Close tab" },
                      { keys: "⌘ \\", description: "Split pane right" },
                      { keys: "⌘ ⇧ \\", description: "Split pane down" },
                      { keys: "⌘ ⇧ C", description: "Switch to Changes tab" },
                      { keys: "⌘ ⇧ T", description: "Switch to terminal tab" },
                    ],
                  },
                  {
                    label: "Panels",
                    shortcuts: [
                      { keys: "⌘ B", description: "Toggle sidebar" },
                      { keys: "⌘ I", description: "Toggle PR panel" },
                    ],
                  },
                  {
                    label: "Search",
                    shortcuts: [
                      { keys: "⌘ F", description: "Search (terminal or file filter)" },
                    ],
                  },
                  {
                    label: "Changes View",
                    shortcuts: [
                      { keys: "] / n", description: "Next file" },
                      { keys: "[ / p", description: "Previous file" },
                      { keys: "x", description: "Toggle file collapse" },
                    ],
                  },
                ].map((group) => (
                  <div key={group.label}>
                    <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1.5">
                      {group.label}
                    </div>
                    <div className="space-y-1 mb-3">
                      {group.shortcuts.map((shortcut) => (
                        <div
                          key={shortcut.keys}
                          className="flex items-center justify-between gap-4 py-1.5"
                        >
                          <span className="text-sm text-text-secondary truncate min-w-0">
                            {shortcut.description}
                          </span>
                          <kbd className="px-2 py-0.5 text-xs font-mono bg-bg-hover text-text-primary rounded-[var(--radius-sm)] border border-border-default whitespace-nowrap flex-shrink-0">
                            {shortcut.keys}
                          </kbd>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
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

export { GlobalSettingsDialog };

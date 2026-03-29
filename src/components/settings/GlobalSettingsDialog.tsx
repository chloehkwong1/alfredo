import { useCallback, useEffect, useState } from "react";
import type { AppConfig, GlobalAppConfig } from "../../types";
import { getConfig, saveConfig, getAppConfig, saveAppConfig } from "../../api";
import { Button } from "../ui/Button";
import { Dialog, DialogContent, DialogFooter } from "../ui/Dialog";
import { AgentSettings } from "./AgentSettings";
import { GithubSettings } from "./GithubSettings";
import { NotificationSettings } from "./NotificationSettings";
import { DEFAULT_NOTIFICATION_CONFIG } from "./notificationConfig";
import { TerminalSettings } from "./TerminalSettings";
import { ThemeSelector } from "./ThemeSelector";

type GlobalTab = "general" | "terminal" | "agent" | "notifications" | "integrations";

const TABS: { id: GlobalTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "terminal", label: "Terminal" },
  { id: "agent", label: "Agent" },
  { id: "notifications", label: "Notifications" },
  { id: "integrations", label: "Integrations" },
];

const EDITOR_OPTIONS = [
  { value: "vscode", label: "VS Code" },
  { value: "cursor", label: "Cursor" },
  { value: "zed", label: "Zed" },
  { value: "vim", label: "Vim / Neovim" },
  { value: "custom", label: "Custom..." },
];

const TERMINAL_OPTIONS = [
  { value: "iterm", label: "iTerm2" },
  { value: "terminal", label: "Terminal.app" },
  { value: "warp", label: "Warp" },
  { value: "ghostty", label: "Ghostty" },
  { value: "custom", label: "Custom..." },
];

const selectClass = [
  "h-8 w-full px-3 text-sm font-normal",
  "bg-bg-primary text-text-primary",
  "border border-border-default rounded-[var(--radius-md)]",
  "hover:border-border-hover",
  "focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-accent-primary/50",
  "transition-all duration-[var(--transition-fast)]",
  "cursor-pointer",
].join(" ");

const inputClass = [
  "h-8 w-full px-3 text-sm",
  "bg-bg-primary text-text-primary",
  "border border-border-default rounded-[var(--radius-md)]",
  "placeholder:text-text-tertiary",
  "hover:border-border-hover",
  "focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-accent-primary/50",
  "transition-all duration-[var(--transition-fast)]",
].join(" ");

function SectionTitle({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <div
      className={[
        "text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-3",
        first ? "" : "mt-6",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="text-sm font-medium text-text-primary mb-1.5">{label}</div>
      {children}
      {hint && <p className="text-xs text-text-tertiary mt-1">{hint}</p>}
    </div>
  );
}

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
  const [tab, setTab] = useState<GlobalTab>("general");
  // Per-repo config — only used for GitHub token and Linear API key
  const [repoConfig, setRepoConfig] = useState<AppConfig | null>(null);
  // App-level config — theme, notifications, agent defaults, external tools
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
          model: null,
          effort: null,
          permissionMode: null,
          dangerouslySkipPermissions: null,
          outputStyle: null,
          verbose: null,
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

  const handleThemeSelect = useCallback(
    (theme: string) => {
      setCurrentTheme(theme);
      applyTheme(theme);
      updateAppConfig({ theme });
    },
    [updateAppConfig],
  );

  const handleSave = useCallback(async () => {
    if (!appConfig || !repoConfig) return;
    setSaving(true);
    try {
      await Promise.all([saveAppConfig(appConfig), saveConfig(".", repoConfig)]);
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
      <DialogContent className="w-[680px] p-0 overflow-hidden">
        <div className="flex min-h-[440px]">
          {/* Tab rail */}
          <nav className="flex flex-col gap-0.5 w-40 flex-shrink-0 p-5 pr-3 border-r border-border-default bg-bg-primary">
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
          <div className="flex-1 min-w-0 p-6 overflow-y-auto max-h-[480px]">
            {tab === "general" && (
              <>
                <SectionTitle first>Appearance</SectionTitle>
                <Field label="Theme">
                  <ThemeSelector currentTheme={currentTheme} onSelect={handleThemeSelect} />
                </Field>

                <SectionTitle>External Tools</SectionTitle>
                <Field label="Editor" hint="Used when opening worktrees in an external editor.">
                  <select
                    value={appConfig.preferredEditor ?? "vscode"}
                    onChange={(e) => updateAppConfig({ preferredEditor: e.target.value })}
                    className={selectClass}
                  >
                    {EDITOR_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {appConfig.preferredEditor === "custom" && (
                    <input
                      type="text"
                      placeholder="e.g. /usr/local/bin/subl"
                      value={appConfig.customEditorPath ?? ""}
                      onChange={(e) =>
                        updateAppConfig({ customEditorPath: e.target.value || null })
                      }
                      className={`${inputClass} mt-2`}
                    />
                  )}
                </Field>
                <Field label="Terminal" hint="Used when opening worktrees in an external terminal.">
                  <select
                    value={appConfig.preferredTerminal ?? "iterm"}
                    onChange={(e) => updateAppConfig({ preferredTerminal: e.target.value })}
                    className={selectClass}
                  >
                    {TERMINAL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {appConfig.preferredTerminal === "custom" && (
                    <input
                      type="text"
                      placeholder="e.g. /Applications/Alacritty.app"
                      value={appConfig.customTerminalPath ?? ""}
                      onChange={(e) =>
                        updateAppConfig({ customTerminalPath: e.target.value || null })
                      }
                      className={`${inputClass} mt-2`}
                    />
                  )}
                </Field>
              </>
            )}

            {tab === "terminal" && <TerminalSettings />}

            {tab === "agent" && (
              <AgentSettings
                settings={{
                  model: appConfig.model ?? undefined,
                  effort: appConfig.effort ?? undefined,
                  permissionMode: appConfig.permissionMode ?? undefined,
                  dangerouslySkipPermissions: appConfig.dangerouslySkipPermissions ?? undefined,
                  outputStyle: appConfig.outputStyle ?? undefined,
                  verbose: appConfig.verbose ?? undefined,
                }}
                onChange={(claudeDefaults) =>
                  updateAppConfig({
                    model: claudeDefaults.model ?? null,
                    effort: claudeDefaults.effort ?? null,
                    permissionMode: claudeDefaults.permissionMode ?? null,
                    dangerouslySkipPermissions: claudeDefaults.dangerouslySkipPermissions ?? null,
                    outputStyle: claudeDefaults.outputStyle ?? null,
                    verbose: claudeDefaults.verbose ?? null,
                  })
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
                onGithubTokenChange={(v) => updateRepoConfig({ githubToken: v || null })}
                onLinearApiKeyChange={(v) => updateRepoConfig({ linearApiKey: v || null })}
              />
            )}
          </div>
        </div>

        <DialogFooter className="px-6 py-3.5">
          {tab === "terminal" ? (
            <p className="text-xs text-text-tertiary mr-auto">Changes apply immediately</p>
          ) : null}
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            {dirty ? "Cancel" : "Close"}
          </Button>
          {tab !== "terminal" && (
            <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { GlobalSettingsDialog };

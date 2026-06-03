import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AppConfig, GlobalAppConfig, TabType } from "../../types";
import { normalizeDiffViewMode } from "../../types";
import { getConfig, saveConfig, getAppConfig, saveAppConfig } from "../../api";
import { Button } from "../ui/Button";
import { Dialog, DialogContent } from "../ui/Dialog";
import { Toggle } from "../ui/Toggle";
import { AgentSettings } from "./AgentSettings";
import { CommentChipsSettings } from "./CommentChipsSettings";
import { GithubSettings } from "./GithubSettings";
import { NotificationSettings } from "./NotificationSettings";
import { DEFAULT_NOTIFICATION_CONFIG } from "./notificationConfig";
import { TerminalSettings } from "./TerminalSettings";
import { ThemeSelector } from "./ThemeSelector";

type GlobalTab =
  | "general"
  | "terminal"
  | "agent"
  | "notifications"
  | "integrations"
  | "comment-chips";

const TABS: { id: GlobalTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "terminal", label: "Terminal" },
  { id: "agent", label: "Agent" },
  { id: "notifications", label: "Notifications" },
  { id: "integrations", label: "Integrations" },
  { id: "comment-chips", label: "Comment Chips" },
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
  "h-8 w-full px-3 text-[13px] font-normal",
  "bg-bg-primary text-text-primary",
  "border border-border-default rounded-[var(--radius-md)]",
  "hover:border-border-hover",
  "focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-accent-primary/50",
  "transition-all duration-[var(--transition-fast)]",
  "cursor-pointer",
].join(" ");

const inputClass = [
  "h-8 w-full px-3 text-[13px]",
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
        "text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary mb-3.5",
        first ? "" : "mt-8",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="text-[13px] font-medium text-text-primary mb-1.5">{label}</div>
      {children}
      {hint && <p className="text-xs text-text-tertiary mt-[5px]">{hint}</p>}
    </div>
  );
}

interface GlobalSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCheckForUpdates?: () => Promise<void>;
  checkingForUpdates?: boolean;
  upToDate?: boolean;
  initialSection?: GlobalTab | null;
  initialFocusIndex?: number | null;
  onDeepLinkConsumed?: () => void;
}

function CheckForUpdatesButton({ onCheck, checking, upToDate }: { onCheck?: () => Promise<void>; checking?: boolean; upToDate?: boolean }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <Button variant="secondary" size="sm" onClick={onCheck} disabled={checking || !onCheck}>
        {checking ? "Checking..." : "Check for updates"}
      </Button>
      {upToDate && !checking && (
        <span className="text-xs text-text-tertiary">You're up to date</span>
      )}
    </div>
  );
}

function applyTheme(theme: string) {
  localStorage.setItem("alfredo-theme", theme);
  if (theme === "warm-dark") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
  getCurrentWindow()
    .setTheme(theme === "light" ? "light" : "dark")
    .catch(() => {});
}

function GlobalSettingsDialog({
  open,
  onOpenChange,
  onCheckForUpdates,
  checkingForUpdates,
  upToDate,
  initialSection,
  initialFocusIndex,
  onDeepLinkConsumed,
}: GlobalSettingsDialogProps) {
  const [tab, setTab] = useState<GlobalTab>("general");
  const [chipFocusIndex, setChipFocusIndex] = useState<number | null>(null);
  const commentChipsSectionRef = useRef<HTMLDivElement | null>(null);

  // Deep-link: when dialog opens with an initialSection, switch tab + scroll + focus
  useEffect(() => {
    if (!open || !initialSection) return;
    setTab(initialSection);
    if (initialSection === "comment-chips") {
      requestAnimationFrame(() => {
        commentChipsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        if (typeof initialFocusIndex === "number") {
          setChipFocusIndex(initialFocusIndex);
        }
      });
    }
    onDeepLinkConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialSection, initialFocusIndex]);
  // Per-repo config — only used for GitHub token and Linear API key
  const [repoConfig, setRepoConfig] = useState<AppConfig | null>(null);
  // App-level config — theme, notifications, agent defaults, external tools
  const [appConfig, setAppConfig] = useState<GlobalAppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [currentTheme, setCurrentTheme] = useState(
    () => localStorage.getItem("alfredo-theme") || "warm-dark",
  );

  const effectiveRepoPath = useMemo(
    () => repoConfig?.repoPath || appConfig?.activeRepo || appConfig?.repos?.[0]?.path || "",
    [repoConfig?.repoPath, appConfig?.activeRepo, appConfig?.repos],
  );

  // Load config when dialog opens
  useEffect(() => {
    if (!open) return;
    getAppConfig()
      .then((c) => {
        setAppConfig(c);
        setDirty(false);

        // Load per-repo config using active repo path (not "." which is
        // read-only inside the signed app bundle on macOS release builds).
        const repoPath = c.activeRepo ?? c.repos?.[0]?.path;
        if (!repoPath) {
          setRepoConfig({
            repoPath: "",
            setupScripts: [],
            githubToken: null,
            linearApiKey: null,
            branchMode: false,
          });
          return;
        }
        getConfig(repoPath)
          .then((rc) => setRepoConfig(rc))
          .catch(() => {
            setRepoConfig({
              repoPath,
              setupScripts: [],
              githubToken: null,
              linearApiKey: null,
              branchMode: false,
            });
          });
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
          repoShortLabels: {},
          worktreeLabels: {},
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
    setSaveError(null);
    try {
      await Promise.all([
        saveAppConfig(appConfig),
        ...(effectiveRepoPath ? [saveConfig(effectiveRepoPath, repoConfig)] : []),
      ]);
      setDirty(false);
      // Notify useAppConfig consumers so their in-memory snapshot re-syncs
      // from disk. Without this, the next updateConfig() call elsewhere could
      // write stale cached fields over what we just saved.
      window.dispatchEvent(new Event("config-changed"));
      onOpenChange(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }, [appConfig, repoConfig, effectiveRepoPath, onOpenChange]);

  if (!appConfig || !repoConfig) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[680px] p-0 overflow-hidden">
        <form onSubmit={(e) => { e.preventDefault(); if (dirty && !saving) handleSave(); }}>
        <div className="flex h-[500px]">
          {/* Tab rail — spans full height */}
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

          {/* Right side: scrollable content body */}
          <div className="flex-1 min-w-0 min-h-0 p-6 overflow-y-auto">
            {tab === "general" && (
              <>
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

                <SectionTitle>Updates</SectionTitle>
                <CheckForUpdatesButton onCheck={onCheckForUpdates} checking={checkingForUpdates} upToDate={upToDate} />
                <div className="flex items-start justify-between gap-4 mt-4">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-text-primary">Receive beta updates</div>
                    <p className="text-xs text-text-tertiary mt-[5px]">
                      Get pre-release builds for testing. You will stay on beta until a stable release catches up — turning this off does not downgrade you. Takes effect on next app launch.
                    </p>
                  </div>
                  <div className="shrink-0 pt-0.5">
                    <Toggle
                      checked={appConfig.receiveBetaUpdates ?? false}
                      onChange={(v) => updateAppConfig({ receiveBetaUpdates: v })}
                    />
                  </div>
                </div>

                <SectionTitle>Tabs</SectionTitle>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-text-primary">Group tabs by category</div>
                    <p className="text-xs text-text-tertiary mt-[5px]">
                      Show only one tab category at a time (Agents, Terminals, Server, Files) with a switcher. Turn off to show every tab in one scrollable row.
                    </p>
                  </div>
                  <div className="shrink-0 pt-0.5">
                    <Toggle
                      checked={appConfig.groupedTabs ?? true}
                      onChange={(v) => updateAppConfig({ groupedTabs: v })}
                    />
                  </div>
                </div>

                <SectionTitle>Diff View</SectionTitle>
                <Field label="Default diff view" hint="Applied when a worktree has no explicit view mode set.">
                  <div className="flex border border-border-default rounded overflow-hidden w-fit">
                    <button
                      type="button"
                      className={`px-3 py-1.5 text-[13px] transition-colors ${
                        normalizeDiffViewMode(appConfig.defaultDiffViewMode) === "inline"
                          ? "bg-accent-primary/15 text-accent-primary font-medium"
                          : "text-text-tertiary hover:text-text-primary hover:bg-bg-hover"
                      }`}
                      onClick={() => updateAppConfig({ defaultDiffViewMode: "inline" })}
                    >
                      Unified
                    </button>
                    <button
                      type="button"
                      className={`px-3 py-1.5 text-[13px] border-l border-border-default transition-colors ${
                        normalizeDiffViewMode(appConfig.defaultDiffViewMode) === "side-by-side"
                          ? "bg-accent-primary/15 text-accent-primary font-medium"
                          : "text-text-tertiary hover:text-text-primary hover:bg-bg-hover"
                      }`}
                      onClick={() => updateAppConfig({ defaultDiffViewMode: "side-by-side" })}
                    >
                      Split
                    </button>
                  </div>
                </Field>

                <SectionTitle>Archive &amp; Cleanup</SectionTitle>
                <div className="flex items-center justify-between mb-4">
                  <div className="min-w-0 pr-4">
                    <div className="text-[13px] font-medium text-text-primary">
                      Auto-archive merged worktrees after
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="number"
                      min={0}
                      className={inputClass + " !w-16 text-center"}
                      value={appConfig.archiveAfterDays ?? 2}
                      onChange={(e) =>
                        updateAppConfig({
                          archiveAfterDays: Math.max(0, parseInt(e.target.value) || 0),
                        })
                      }
                    />
                    <span className="text-sm text-text-secondary w-10">days</span>
                  </div>
                </div>
                <div className="flex items-center justify-between mb-4">
                  <div className="min-w-0 pr-4">
                    <div className="text-[13px] font-medium text-text-primary">
                      Auto-delete archived worktrees after
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="number"
                      min={0}
                      className={inputClass + " !w-16 text-center"}
                      value={appConfig.deleteAfterDays ?? 0}
                      onChange={(e) =>
                        updateAppConfig({
                          deleteAfterDays: Math.max(0, parseInt(e.target.value) || 0),
                        })
                      }
                    />
                    <span className="text-sm text-text-secondary w-10">days</span>
                  </div>
                </div>
                <p className="text-xs text-text-tertiary mt-[5px]">Set to 0 to disable.</p>
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
                defaultAgent={(appConfig.defaultAgent as TabType) ?? "claude"}
                onDefaultAgentChange={(agent) => {
                  updateAppConfig({ defaultAgent: agent });
                  localStorage.setItem("alfredo-default-agent", agent);
                }}
              />
            )}

            {tab === "notifications" && (
              <NotificationSettings
                config={appConfig.notifications ?? DEFAULT_NOTIFICATION_CONFIG}
                onChange={(notifications) => updateAppConfig({ notifications })}
                debugMode={appConfig.debugMode ?? false}
                onDebugModeChange={(debugMode) => updateAppConfig({ debugMode })}
              />
            )}

            {tab === "comment-chips" && (
              <div ref={commentChipsSectionRef}>
                <CommentChipsSettings
                  focusIndex={chipFocusIndex}
                  onFocusConsumed={() => setChipFocusIndex(null)}
                />
              </div>
            )}

            {tab === "integrations" && (
              <GithubSettings
                repoPath={effectiveRepoPath}
                githubToken={repoConfig.githubToken ?? ""}
                linearApiKey={repoConfig.linearApiKey ?? ""}
                onGithubTokenChange={(v) => updateRepoConfig({ githubToken: v || null })}
                onLinearApiKeyChange={(v) => updateRepoConfig({ linearApiKey: v || null })}
              />
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-border-default">
          {tab === "terminal" || tab === "comment-chips" ? (
            <p className="text-xs text-text-tertiary mr-auto">Changes apply immediately</p>
          ) : null}
          {saveError && (
            <p className="text-xs text-red-400 mr-auto">{saveError}</p>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            {dirty ? "Cancel" : "Close"}
          </Button>
          {tab !== "terminal" && tab !== "comment-chips" && (
            <Button type="submit" size="sm" disabled={!dirty || saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          )}
        </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { GlobalSettingsDialog };

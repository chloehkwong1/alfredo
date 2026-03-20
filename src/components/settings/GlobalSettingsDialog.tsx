import { useCallback, useEffect, useState } from "react";
import type { AppConfig } from "../../types";
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
import { NotificationSettings, DEFAULT_NOTIFICATION_CONFIG } from "./NotificationSettings";
import { TerminalSettings } from "./TerminalSettings";
import { ThemeSelector } from "./ThemeSelector";

type GlobalTab =
  | "appearance"
  | "terminal"
  | "notifications"
  | "integrations"
  | "shortcuts";

const TABS: { id: GlobalTab; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "terminal", label: "Terminal" },
  { id: "notifications", label: "Notifications" },
  { id: "integrations", label: "Integrations" },
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
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [currentTheme, setCurrentTheme] = useState(
    () => localStorage.getItem("alfredo-theme") || "warm-dark",
  );

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
        });
      });
    setCurrentTheme(localStorage.getItem("alfredo-theme") || "warm-dark");
  }, [open]);

  const updateConfig = useCallback((patch: Partial<AppConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  }, []);

  const handleThemeSelect = useCallback((theme: string) => {
    setCurrentTheme(theme);
    applyTheme(theme);
    // Theme is applied instantly via localStorage + data-attribute,
    // also persist in config
    setConfig((prev) => (prev ? { ...prev, theme } : prev));
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        {/* Vertical tab layout */}
        <div className="flex gap-6 min-h-[320px]">
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
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-text-primary">
                    Font Size
                  </label>
                  <p className="text-xs text-text-tertiary">
                    Coming soon
                  </p>
                </div>
              </div>
            )}

            {tab === "terminal" && <TerminalSettings />}

            {tab === "notifications" && (
              <NotificationSettings
                config={config.notifications ?? DEFAULT_NOTIFICATION_CONFIG}
                onChange={(notifications) => updateConfig({ notifications })}
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

            {tab === "shortcuts" && (
              <div className="flex items-center justify-center h-full text-sm text-text-tertiary">
                Coming soon
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

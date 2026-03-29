# Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Global Settings dialog with unified visual styling, 5 consolidated tabs, global agent defaults, expanded notification sounds, and a keyboard shortcuts overlay.

**Architecture:** Restyle all settings tabs with consistent component patterns (one select style, one toggle, one section heading). Move agent defaults from per-repo AppConfig to GlobalAppConfig. Extract shortcuts into a standalone overlay triggered by Cmd+? and a sidebar icon. Expand notification sounds with fun synthesized effects.

**Tech Stack:** React, TypeScript, Tauri v2, Rust, Web Audio API

**Spec:** `docs/superpowers/specs/2026-03-29-settings-redesign-design.md`
**Mockup:** `designs/settings-redesign.html`

---

### Task 1: Extract shared Toggle component

**Files:**
- Create: `src/components/ui/Toggle.tsx`
- Modify: `src/components/settings/NotificationSettings.tsx:18-47` (remove inline Toggle)

- [ ] **Step 1: Create Toggle component**

Create `src/components/ui/Toggle.tsx`:

```tsx
interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-5 w-9 items-center rounded-full",
        "transition-colors duration-[var(--transition-fast)]",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        checked ? "bg-accent-primary" : "bg-bg-active",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-3.5 w-3.5 rounded-full bg-white",
          "transition-transform duration-[var(--transition-fast)]",
          checked ? "translate-x-[18px]" : "translate-x-[3px]",
        ].join(" ")}
      />
    </button>
  );
}

export { Toggle };
export type { ToggleProps };
```

- [ ] **Step 2: Remove inline Toggle from NotificationSettings**

In `src/components/settings/NotificationSettings.tsx`, delete the inline `Toggle` function (lines 18-47) and add an import at the top:

```tsx
import { Toggle } from "../ui/Toggle";
```

Update all `<Toggle checked={...} onToggle={...} />` usages to `<Toggle checked={...} onChange={...} />` — the prop name changes from `onToggle` to `onChange`, and it now receives `(checked: boolean)` instead of `() => void`. Update each call site:

Replace `onToggle={handleEnableToggle}` with `onChange={() => handleEnableToggle()}`.

Replace each `onToggle={() => update("notifyOnWaiting", !config.notifyOnWaiting)}` with `onChange={(v) => update("notifyOnWaiting", v)}`.

Same for `notifyOnIdle` and `notifyOnError`.

- [ ] **Step 3: Verify app compiles**

Run: `npm run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/Toggle.tsx src/components/settings/NotificationSettings.tsx
git commit -m "refactor: extract shared Toggle component from NotificationSettings"
```

---

### Task 2: Add agent defaults to GlobalAppConfig (Rust + TypeScript types)

**Files:**
- Modify: `src-tauri/src/types.rs:295-320`
- Modify: `src/types.ts:300-313`

- [ ] **Step 1: Add agent fields to Rust GlobalAppConfig**

In `src-tauri/src/types.rs`, add these fields to the `GlobalAppConfig` struct, before the closing `}` (after `custom_terminal_path`):

```rust
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(default)]
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub dangerously_skip_permissions: Option<bool>,
    #[serde(default)]
    pub output_style: Option<String>,
    #[serde(default)]
    pub verbose: Option<bool>,
```

- [ ] **Step 2: Add agent fields to TypeScript GlobalAppConfig**

In `src/types.ts`, add these fields to the `GlobalAppConfig` interface, before the closing `}` (after `customTerminalPath`):

```typescript
  model?: string | null;
  effort?: string | null;
  permissionMode?: string | null;
  dangerouslySkipPermissions?: boolean | null;
  outputStyle?: string | null;
  verbose?: boolean | null;
```

- [ ] **Step 3: Update the fallback GlobalAppConfig in GlobalSettingsDialog**

In `src/components/settings/GlobalSettingsDialog.tsx`, in the `.catch()` handler around line 74, add the new fields to the fallback object:

```typescript
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
```

- [ ] **Step 4: Verify compilation**

Run: `npm run build && cd src-tauri && cargo check`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/types.rs src/types.ts src/components/settings/GlobalSettingsDialog.tsx
git commit -m "feat: add agent default fields to GlobalAppConfig"
```

---

### Task 3: Update claudeSettingsResolver to read global config

**Files:**
- Modify: `src/services/claudeSettingsResolver.ts`
- Modify: `src/components/terminal/TerminalView.tsx:60-76`

- [ ] **Step 1: Add GlobalAppConfig overload to resolveSettings**

In `src/services/claudeSettingsResolver.ts`, update `resolveSettings` to accept a new optional first argument for global defaults:

```typescript
import type { ClaudeDefaults, ClaudeOverrides, GlobalAppConfig } from "../types";

export interface ResolvedClaudeSettings {
  model?: string;
  effort?: string;
  permissionMode?: string;
  dangerouslySkipPermissions?: boolean;
  outputStyle?: string;
  verbose?: boolean;
}

/**
 * Merge global app defaults → per-repo defaults → per-branch overrides.
 * Each layer overrides the previous; only defined fields are merged.
 */
export function resolveSettings(
  globalDefaults?: Pick<GlobalAppConfig, "model" | "effort" | "permissionMode" | "dangerouslySkipPermissions" | "outputStyle" | "verbose"> | null,
  repoDefaults?: ClaudeDefaults,
  overrides?: ClaudeOverrides,
): ResolvedClaudeSettings {
  return {
    model: overrides?.model ?? repoDefaults?.model ?? globalDefaults?.model ?? undefined,
    effort: overrides?.effort ?? repoDefaults?.effort ?? globalDefaults?.effort ?? undefined,
    permissionMode: overrides?.permissionMode ?? repoDefaults?.permissionMode ?? globalDefaults?.permissionMode ?? undefined,
    dangerouslySkipPermissions: repoDefaults?.dangerouslySkipPermissions ?? globalDefaults?.dangerouslySkipPermissions ?? undefined,
    outputStyle: overrides?.outputStyle ?? repoDefaults?.outputStyle ?? globalDefaults?.outputStyle ?? undefined,
    verbose: repoDefaults?.verbose ?? globalDefaults?.verbose ?? undefined,
  };
}
```

The `buildClaudeArgs` function stays unchanged.

- [ ] **Step 2: Update TerminalView to pass global config**

In `src/components/terminal/TerminalView.tsx`, update the settings resolution effect (around line 60) to also load global config:

```typescript
import { getConfig, getAppConfig } from "../../api";
```

Then replace the existing `useEffect` block:

```typescript
  useEffect(() => {
    if (mode !== "claude") {
      setResolvedArgs([]);
      return;
    }
    if (!repoPath) return;
    Promise.all([getAppConfig(), getConfig(repoPath)]).then(([appCfg, config]) => {
      const branch = worktree?.branch ?? "";
      const resolved = resolveSettings(
        appCfg,
        config.claudeDefaults,
        config.worktreeOverrides?.[branch],
      );
      setResolvedArgs(buildClaudeArgs(resolved));
    }).catch(() => {
      setResolvedArgs([]);
    });
  }, [repoPath, worktree?.branch, mode]);
```

- [ ] **Step 3: Update SettingsStatusBar to also read global config**

In `src/components/settings/SettingsStatusBar.tsx` (around line 56), update the effect that loads resolved settings:

```typescript
import { getConfig, getAppConfig } from "../../api";
```

Replace the existing effect:

```typescript
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
```

- [ ] **Step 4: Verify compilation**

Run: `npm run build`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/services/claudeSettingsResolver.ts src/components/terminal/TerminalView.tsx src/components/settings/SettingsStatusBar.tsx
git commit -m "feat: resolve agent settings from global config with repo/branch overrides"
```

---

### Task 4: Fix status bar to show actual default values

**Files:**
- Modify: `src/components/settings/SettingsStatusBar.tsx:10-35`

- [ ] **Step 1: Define Claude default values and update displayLabel**

In `src/components/settings/SettingsStatusBar.tsx`, update the constants and `displayLabel` function:

```typescript
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
```

Remove the empty-value `{ value: "", label: "Default" }` entries from EFFORT_OPTIONS and PERMISSION_OPTIONS (no longer needed — the `displayLabel` function handles fallbacks).

- [ ] **Step 2: Update chip calls to pass Claude defaults**

In the JSX around line 141, update the three `SettingsChip` calls:

```tsx
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
```

- [ ] **Step 3: Verify compilation**

Run: `npm run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/SettingsStatusBar.tsx
git commit -m "fix: show actual default values in settings status bar chips"
```

---

### Task 5: Expand notification sounds

**Files:**
- Modify: `src/hooks/useNotifications.ts:14-23`

- [ ] **Step 1: Extend SoundNote type**

In `src/hooks/useNotifications.ts`, replace the `SoundNote` type at line 14:

```typescript
type SoundNote = {
  frequency: number;
  duration: number;
  type?: OscillatorType;     // default: "sine"
  endFrequency?: number;     // for frequency sweeps
  gain?: number;             // override default 0.3
  delay?: number;            // gap after previous note (default: 0.04)
};
```

- [ ] **Step 2: Update playNotes to support new fields**

Replace the `playNotes` function (around line 45):

```typescript
function playNotes(notes: SoundNote[]) {
  if (notes.length === 0) return;
  const ctx = getAudioContext();
  let offset = ctx.currentTime;
  for (const note of notes) {
    if (note.frequency === 0 || note.duration === 0) continue;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.type = note.type ?? "sine";
    osc.frequency.setValueAtTime(note.frequency, offset);
    if (note.endFrequency) {
      osc.frequency.exponentialRampToValueAtTime(note.endFrequency, offset + note.duration);
    }
    const vol = note.gain ?? 0.3;
    gainNode.gain.setValueAtTime(vol, offset);
    gainNode.gain.exponentialRampToValueAtTime(0.001, offset + note.duration);
    osc.start(offset);
    osc.stop(offset + note.duration);
    offset += note.duration + (note.delay ?? 0.04);
  }
}
```

- [ ] **Step 3: Add new sounds to SOUNDS**

Replace the `SOUNDS` constant (line 16) with the expanded set:

```typescript
const SOUNDS: Record<string, SoundNote[]> = {
  // ── Classic ──
  none:      [],
  chime:     [{ frequency: 880, duration: 0.25 }, { frequency: 1108, duration: 0.35 }],
  pop:       [{ frequency: 440, duration: 0.12 }, { frequency: 554, duration: 0.18 }],
  ding:      [{ frequency: 1047, duration: 0.2 }, { frequency: 1318, duration: 0.3 }],
  ping:      [{ frequency: 1320, duration: 0.15 }, { frequency: 1568, duration: 0.2 }],
  woodblock: [{ frequency: 330, duration: 0.08, type: "triangle" }, { frequency: 440, duration: 0.12, type: "triangle" }],
  // ── Fun ──
  coin:      [{ frequency: 988, duration: 0.08, type: "square", gain: 0.2 }, { frequency: 1319, duration: 0.3, type: "square", gain: 0.2 }],
  r2d2:      [
    { frequency: 800, duration: 0.06, endFrequency: 2400 },
    { frequency: 2400, duration: 0.06, endFrequency: 1200, delay: 0.02 },
    { frequency: 1200, duration: 0.06, endFrequency: 1800, delay: 0.02 },
    { frequency: 1800, duration: 0.08, endFrequency: 600, delay: 0.02 },
  ],
  zelda:     [
    { frequency: 523, duration: 0.12, type: "triangle" },
    { frequency: 659, duration: 0.12, type: "triangle" },
    { frequency: 784, duration: 0.12, type: "triangle" },
    { frequency: 1047, duration: 0.4, type: "triangle" },
  ],
  quack:     [{ frequency: 600, duration: 0.12, type: "sawtooth", endFrequency: 200, gain: 0.15 }],
  laser:     [{ frequency: 1500, duration: 0.15, type: "sawtooth", endFrequency: 200, gain: 0.15 }],
  doorbell:  [
    { frequency: 659, duration: 0.3, type: "sine", gain: 0.25 },
    { frequency: 523, duration: 0.4, type: "sine", gain: 0.25 },
  ],
  bloop:     [{ frequency: 300, duration: 0.15, endFrequency: 800, gain: 0.25 }, { frequency: 800, duration: 0.1, endFrequency: 400, gain: 0.15 }],
  victory:   [
    { frequency: 523, duration: 0.15, type: "triangle", gain: 0.25 },
    { frequency: 659, duration: 0.15, type: "triangle", gain: 0.25 },
    { frequency: 784, duration: 0.15, type: "triangle", gain: 0.25 },
    { frequency: 1047, duration: 0.5, type: "triangle", gain: 0.25, delay: 0.01 },
  ],
  bonk:      [{ frequency: 200, duration: 0.06, type: "square", gain: 0.2 }, { frequency: 140, duration: 0.08, type: "square", gain: 0.15, delay: 0.01 }],
  sparkle:   [
    { frequency: 1568, duration: 0.06, gain: 0.2 },
    { frequency: 1760, duration: 0.06, gain: 0.2, delay: 0.02 },
    { frequency: 1976, duration: 0.06, gain: 0.2, delay: 0.02 },
    { frequency: 2093, duration: 0.06, gain: 0.2, delay: 0.02 },
    { frequency: 2349, duration: 0.2, gain: 0.2, delay: 0.02 },
  ],
  ufo:       [
    { frequency: 400, duration: 0.1, endFrequency: 800 },
    { frequency: 800, duration: 0.1, endFrequency: 400, delay: 0.0 },
    { frequency: 400, duration: 0.1, endFrequency: 800, delay: 0.0 },
    { frequency: 800, duration: 0.15, endFrequency: 300, delay: 0.0 },
  ],
};
```

- [ ] **Step 4: Also update the `playTone` function to support waveform type**

Update the `playTone` export (used by other callers) to accept an optional waveform:

```typescript
export function playTone(frequency: number, duration: number, type: OscillatorType = "sine") {
  if (frequency === 0 || duration === 0) return;
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = type;
  osc.frequency.value = frequency;
  gain.gain.value = 0.3;
  osc.start(ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.stop(ctx.currentTime + duration);
}
```

- [ ] **Step 5: Verify compilation**

Run: `npm run build`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useNotifications.ts
git commit -m "feat: expand notification sounds with fun synthesized effects"
```

---

### Task 6: Rewrite GlobalSettingsDialog (5 tabs, unified layout)

**Files:**
- Modify: `src/components/settings/GlobalSettingsDialog.tsx` (full rewrite)

- [ ] **Step 1: Rewrite GlobalSettingsDialog**

Replace the entire contents of `src/components/settings/GlobalSettingsDialog.tsx`. The new version has:
- 5 tabs: General, Terminal, Agent, Notifications, Integrations
- Vertical rail with `bg-bg-primary` for depth
- Agent settings read/write from `appConfig` (global) instead of `repoConfig`
- No shortcuts tab (moved to overlay in Task 8)
- 680px dialog width, no padding on DialogContent

```tsx
import { useCallback, useEffect, useState } from "react";
import type { AppConfig, GlobalAppConfig } from "../../types";
import { getConfig, saveConfig, getAppConfig, saveAppConfig } from "../../api";
import { Button } from "../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from "../ui/Dialog";
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

interface GlobalSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

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

function applyTheme(theme: string) {
  localStorage.setItem("alfredo-theme", theme);
  if (theme === "warm-dark") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

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

function GlobalSettingsDialog({ open, onOpenChange }: GlobalSettingsDialogProps) {
  const [tab, setTab] = useState<GlobalTab>("general");
  const [repoConfig, setRepoConfig] = useState<AppConfig | null>(null);
  const [appConfig, setAppConfig] = useState<GlobalAppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [currentTheme, setCurrentTheme] = useState(
    () => localStorage.getItem("alfredo-theme") || "warm-dark",
  );

  useEffect(() => {
    if (!open) return;
    getAppConfig()
      .then((c) => { setAppConfig(c); setDirty(false); })
      .catch(() => {
        setAppConfig({
          repos: [], activeRepo: null, theme: null, notifications: null,
          selectedRepos: [], displayName: null, repoColors: {}, repoDisplayNames: {},
          preferredEditor: "vscode", customEditorPath: null,
          preferredTerminal: "iterm", customTerminalPath: null,
          model: null, effort: null, permissionMode: null,
          dangerouslySkipPermissions: null, outputStyle: null, verbose: null,
        });
      });
    getConfig(".")
      .then((c) => setRepoConfig(c))
      .catch(() => {
        setRepoConfig({
          repoPath: ".", setupScripts: [], githubToken: null,
          linearApiKey: null, branchMode: false,
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
          {/* Rail */}
          <nav className="flex flex-col gap-0.5 w-40 flex-shrink-0 p-5 pr-3 border-r border-border-default bg-bg-primary">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={[
                  "px-3 py-[7px] text-sm rounded-[var(--radius-md)] text-left",
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

          {/* Content */}
          <div className="flex-1 min-w-0 p-6 overflow-y-auto max-h-[480px]">
            {/* ── General ── */}
            {tab === "general" && (
              <div>
                <SectionTitle first>Theme</SectionTitle>
                <ThemeSelector currentTheme={currentTheme} onSelect={handleThemeSelect} />

                <SectionTitle>External Tools</SectionTitle>
                <Field label="Editor">
                  <select
                    value={appConfig.preferredEditor ?? "vscode"}
                    onChange={(e) => updateAppConfig({ preferredEditor: e.target.value })}
                    className={selectClass}
                  >
                    {EDITOR_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  {appConfig.preferredEditor === "custom" && (
                    <input
                      type="text"
                      placeholder="e.g. /usr/local/bin/subl"
                      value={appConfig.customEditorPath ?? ""}
                      onChange={(e) => updateAppConfig({ customEditorPath: e.target.value || null })}
                      className={`${inputClass} mt-2`}
                    />
                  )}
                </Field>
                <Field label="Terminal" hint="Used when opening worktrees via context menu or status bar">
                  <select
                    value={appConfig.preferredTerminal ?? "iterm"}
                    onChange={(e) => updateAppConfig({ preferredTerminal: e.target.value })}
                    className={selectClass}
                  >
                    {TERMINAL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  {appConfig.preferredTerminal === "custom" && (
                    <input
                      type="text"
                      placeholder="e.g. /Applications/Alacritty.app"
                      value={appConfig.customTerminalPath ?? ""}
                      onChange={(e) => updateAppConfig({ customTerminalPath: e.target.value || null })}
                      className={`${inputClass} mt-2`}
                    />
                  )}
                </Field>
              </div>
            )}

            {/* ── Terminal ── */}
            {tab === "terminal" && <TerminalSettings />}

            {/* ── Agent ── */}
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

            {/* ── Notifications ── */}
            {tab === "notifications" && (
              <NotificationSettings
                config={appConfig.notifications ?? DEFAULT_NOTIFICATION_CONFIG}
                onChange={(notifications) => updateAppConfig({ notifications })}
              />
            )}

            {/* ── Integrations ── */}
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
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
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

/* ── Shared layout helpers ── */

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

export { GlobalSettingsDialog };
```

- [ ] **Step 2: Delete ExternalToolsSettings.tsx** (inlined into General tab)

```bash
rm src/components/settings/ExternalToolsSettings.tsx
```

- [ ] **Step 3: Update settings/index.ts if it re-exports ExternalToolsSettings**

Check `src/components/settings/index.ts` and remove any `ExternalToolsSettings` export.

- [ ] **Step 4: Verify compilation**

Run: `npm run build`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add -A src/components/settings/
git commit -m "feat: rewrite GlobalSettingsDialog with 5-tab layout and unified styles"
```

---

### Task 7: Restyle AgentSettings with unified patterns and fix permission hint bug

**Files:**
- Modify: `src/components/settings/AgentSettings.tsx` (full restyle)

- [ ] **Step 1: Rewrite AgentSettings with unified styles**

Replace the entire contents of `src/components/settings/AgentSettings.tsx`:

```tsx
import type { ClaudeDefaults } from "../../types";

const MODEL_OPTIONS = [
  { value: "", label: "Default" },
  { value: "claude-opus-4-6", label: "Opus 4.6 (1M context)" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6 (200K context)" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5 (200K context)" },
];

const EFFORT_OPTIONS = ["low", "medium", "high", "max"] as const;

const PERMISSION_OPTIONS = [
  { value: "default", label: "Default", hint: "Asks before edits and commands" },
  { value: "acceptEdits", label: "Accept Edits", hint: "Auto-accepts file edits, asks before commands" },
  { value: "plan", label: "Plan", hint: "Read-only exploration, no edits or commands" },
  { value: "auto", label: "Auto", hint: "AI decides which permissions to grant — may still ask" },
  { value: "dontAsk", label: "Don't Ask", hint: "Runs all tools without asking — use with caution" },
  { value: "bypassPermissions", label: "Bypass Permissions", hint: "No checks at all — sandboxed environments only" },
];

const OUTPUT_OPTIONS = ["Default", "Explanatory", "Learning"] as const;

const selectClass = [
  "h-8 w-full px-3 text-sm font-normal",
  "bg-bg-primary text-text-primary",
  "border border-border-default rounded-[var(--radius-md)]",
  "hover:border-border-hover",
  "focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-accent-primary/50",
  "transition-all duration-[var(--transition-fast)]",
  "cursor-pointer",
].join(" ");

interface AgentSettingsProps {
  settings: ClaudeDefaults;
  onChange: (settings: ClaudeDefaults) => void;
}

function AgentSettings({ settings, onChange }: AgentSettingsProps) {
  const update = (patch: Partial<ClaudeDefaults>) =>
    onChange({ ...settings, ...patch });

  // Track the select value directly for the hint — avoids stale state on render
  const permissionValue = settings.permissionMode ?? "default";

  return (
    <div>
      <p className="text-xs text-text-tertiary mb-5">
        Defaults for all new sessions. Override per worktree via the status bar.
      </p>

      {/* Model & Performance */}
      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-3">
        Model & Performance
      </div>

      <div className="mb-4">
        <div className="text-sm font-medium text-text-primary mb-1.5">Model</div>
        <select
          value={settings.model ?? ""}
          onChange={(e) => update({ model: e.target.value || undefined })}
          className={selectClass}
        >
          {MODEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="mb-4">
        <div className="text-sm font-medium text-text-primary mb-1.5">Effort</div>
        <div className="flex rounded-[var(--radius-md)] border border-border-default overflow-hidden">
          {EFFORT_OPTIONS.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => update({ effort: level })}
              className={[
                "flex-1 px-3 py-1.5 text-xs font-medium capitalize transition-colors cursor-pointer",
                settings.effort === level
                  ? "bg-accent-primary text-white"
                  : "bg-bg-primary text-text-secondary hover:text-text-primary",
              ].join(" ")}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      {/* Permissions */}
      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-3 mt-6">
        Permissions
      </div>

      <div className="mb-4">
        <div className="text-sm font-medium text-text-primary mb-1.5">Permission Mode</div>
        <select
          value={permissionValue}
          onChange={(e) => {
            const v = e.target.value;
            update({
              permissionMode: v === "default" ? undefined : v,
              dangerouslySkipPermissions: v === "bypassPermissions" ? true : undefined,
            });
          }}
          className={selectClass}
        >
          {PERMISSION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <p className="text-xs text-text-tertiary mt-1">
          {PERMISSION_OPTIONS.find((o) => o.value === permissionValue)?.hint}
        </p>
      </div>

      {/* Output */}
      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-3 mt-6">
        Output
      </div>

      <div className="mb-4">
        <div className="text-sm font-medium text-text-primary mb-1.5">Style</div>
        <div className="flex rounded-[var(--radius-md)] border border-border-default overflow-hidden">
          {OUTPUT_OPTIONS.map((style) => (
            <button
              key={style}
              type="button"
              onClick={() => update({ outputStyle: style })}
              className={[
                "flex-1 px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                (settings.outputStyle ?? "Default") === style
                  ? "bg-accent-primary text-white"
                  : "bg-bg-primary text-text-secondary hover:text-text-primary",
              ].join(" ")}
            >
              {style}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between py-1.5">
        <span className="text-sm text-text-secondary">Verbose output</span>
        <button
          type="button"
          role="switch"
          aria-checked={!!settings.verbose}
          onClick={() => update({ verbose: !settings.verbose })}
          className={[
            "relative inline-flex h-5 w-9 items-center rounded-full",
            "transition-colors duration-[var(--transition-fast)] cursor-pointer",
            settings.verbose ? "bg-accent-primary" : "bg-bg-active",
          ].join(" ")}
        >
          <span
            className={[
              "inline-block h-3.5 w-3.5 rounded-full bg-white",
              "transition-transform duration-[var(--transition-fast)]",
              settings.verbose ? "translate-x-[18px]" : "translate-x-[3px]",
            ].join(" ")}
          />
        </button>
      </div>

      <p className="text-xs text-text-tertiary pt-4 mt-4 border-t border-border-default">
        Applies to new sessions — existing sessions keep their settings.
      </p>
    </div>
  );
}

export { AgentSettings };
```

The key fix: `permissionValue` is derived directly from `settings.permissionMode ?? "default"` and used for both the select value AND the hint lookup — no stale state possible.

- [ ] **Step 2: Verify compilation**

Run: `npm run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/AgentSettings.tsx
git commit -m "feat: restyle AgentSettings with unified patterns, fix permission hint bug"
```

---

### Task 8: Restyle remaining settings tabs

**Files:**
- Modify: `src/components/settings/TerminalSettings.tsx`
- Modify: `src/components/settings/NotificationSettings.tsx`
- Modify: `src/components/settings/GithubSettings.tsx`

- [ ] **Step 1: Restyle TerminalSettings**

In `src/components/settings/TerminalSettings.tsx`, update to use unified patterns:

1. Replace all `bg-bg-secondary` on selects and buttons with `bg-bg-primary`
2. Add a hint at the top of the component: `<p className="text-xs text-text-tertiary mb-5">Terminal changes apply immediately to all sessions.</p>`
3. Replace section labels with the unified section title style:
   - Replace `<label className="text-sm font-medium text-text-primary">Font Family</label>` pattern with:
   ```tsx
   <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-3">Font</div>
   ```
   Use `Font` as first section (with font family, size, line height, letter spacing fields under it).
   Use `Cursor` as second section (with style buttons and blink toggle).
   Use `Preview` as third section.
4. Replace `text-sm font-medium text-text-primary` on individual field labels with `text-sm font-medium text-text-primary mb-1.5`
5. Replace the cursor style buttons' active state: change from `border-accent-primary bg-accent-muted text-text-primary` to the same (keep it — this is the outlined variant which is correct for terminal cursor buttons).
6. Ensure the select uses the unified class: `"h-8 w-full px-3 text-sm bg-bg-primary text-text-primary border border-border-default rounded-[var(--radius-md)] hover:border-border-hover focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-accent-primary/50 transition-all duration-[var(--transition-fast)] cursor-pointer"`

- [ ] **Step 2: Restyle NotificationSettings**

In `src/components/settings/NotificationSettings.tsx`:

1. Replace section labels "Notify When" and "Notification Sound" with unified section titles:
   ```tsx
   <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-3 mt-6">Notify When</div>
   ```
   and:
   ```tsx
   <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-3 mt-6">Sound</div>
   ```

2. Replace `bg-bg-secondary` on sound buttons with `bg-bg-primary`

3. Update toggle rows to use unified padding: `py-1.5` and text style `text-sm text-text-secondary`

- [ ] **Step 3: Restyle GithubSettings**

In `src/components/settings/GithubSettings.tsx`:

1. Replace `text-body` with `text-sm` and `text-caption` with `text-xs` throughout (these are custom typography tokens that should use standard Tailwind)

2. Add unified section titles:
   ```tsx
   <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-3">GitHub</div>
   ```
   and:
   ```tsx
   <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-3 mt-6">Linear</div>
   ```

3. Replace the existing `<label className="text-body font-medium text-text-primary">GitHub</label>` and `<label className="text-body font-medium text-text-primary">Linear API Key</label>` with the section titles above. The "API Key" label under Linear becomes a field label: `<div className="text-sm font-medium text-text-primary mb-1.5">API Key</div>`

4. Replace `bg-bg-secondary` on the connected row and info boxes with `bg-bg-primary`

- [ ] **Step 4: Verify compilation**

Run: `npm run build`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/TerminalSettings.tsx src/components/settings/NotificationSettings.tsx src/components/settings/GithubSettings.tsx
git commit -m "feat: restyle Terminal, Notifications, and Integrations tabs with unified patterns"
```

---

### Task 9: Create ShortcutsOverlay and wire up triggers

**Files:**
- Create: `src/components/settings/ShortcutsOverlay.tsx`
- Modify: `src/components/sidebar/Sidebar.tsx:156-166`
- Modify: `src/hooks/useKeyboardShortcuts.ts`
- Modify: `src/components/layout/AppShell.tsx:95`

- [ ] **Step 1: Create ShortcutsOverlay component**

Create `src/components/settings/ShortcutsOverlay.tsx`:

```tsx
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/Dialog";

const SHORTCUT_GROUPS = [
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
  {
    label: "Help",
    shortcuts: [
      { keys: "⌘ ?", description: "Show keyboard shortcuts" },
    ],
  },
];

interface ShortcutsOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ShortcutsOverlay({ open, onOpenChange }: ShortcutsOverlayProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[480px]">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-2">
                {group.label}
              </div>
              <div className="space-y-1">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.keys}
                    className="flex items-center justify-between gap-4 py-1.5"
                  >
                    <span className="text-sm text-text-secondary truncate min-w-0">
                      {shortcut.description}
                    </span>
                    <kbd className="px-2 py-0.5 text-xs font-mono bg-bg-primary text-text-primary rounded-[var(--radius-sm)] border border-border-default whitespace-nowrap flex-shrink-0">
                      {shortcut.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { ShortcutsOverlay };
```

- [ ] **Step 2: Add ? icon and ShortcutsOverlay to Sidebar**

In `src/components/sidebar/Sidebar.tsx`:

Add imports at top:

```tsx
import { HelpCircle, Settings } from "lucide-react";
import { ShortcutsOverlay } from "../settings/ShortcutsOverlay";
```

Add state (near line 134, next to `globalSettingsOpen`):

```tsx
const [shortcutsOpen, setShortcutsOpen] = useState(false);
```

In the header (around line 161), add the `?` icon before the gear:

```tsx
<div className="flex items-center gap-2">
  <IconButton size="sm" label="Keyboard shortcuts" className="rounded-[6px]" onClick={() => setShortcutsOpen(true)}>
    <HelpCircle />
  </IconButton>
  <IconButton size="sm" label="App settings" className="rounded-[6px]" onClick={() => setGlobalSettingsOpen(true)}>
    <Settings />
  </IconButton>
</div>
```

Add the overlay in the dialogs section (after the GlobalSettingsDialog):

```tsx
<ShortcutsOverlay open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
```

- [ ] **Step 3: Add Cmd+? keyboard shortcut**

In `src/hooks/useKeyboardShortcuts.ts`, update the function signature to accept a new callback:

```typescript
export function useKeyboardShortcuts(
  activeWorktreeId: string | null,
  activeTab: WorkspaceTab | undefined,
  tabs: WorkspaceTab[],
  onCreateDialog: () => void,
  onShortcutsOverlay?: () => void,
) {
```

Add a new handler inside `handleKeyDown`, before the Cmd+B handler (around line 105):

```typescript
      // Cmd+? (Cmd+Shift+/): show keyboard shortcuts overlay
      if (event.metaKey && event.shiftKey && event.key === "?") {
        event.preventDefault();
        onShortcutsOverlay?.();
        return;
      }
```

Update the dependency array at line 147:

```typescript
  }, [activeWorktreeId, activeTab, tabs, onCreateDialog, onShortcutsOverlay]);
```

- [ ] **Step 4: Wire up the callback from AppShell**

`useKeyboardShortcuts` is called in `src/components/layout/AppShell.tsx` at line 95:

```typescript
useKeyboardShortcuts(activeWorktreeId, activeTab, tabs, () => setCreateDialogOpen(true));
```

The shortcuts overlay state lives in Sidebar, but the keyboard hook lives in AppShell. Use a custom event to bridge them.

In `src/components/layout/AppShell.tsx` at line 95, update to:

```typescript
useKeyboardShortcuts(activeWorktreeId, activeTab, tabs, () => setCreateDialogOpen(true), () => {
  window.dispatchEvent(new CustomEvent("alfredo:shortcuts-overlay"));
});
```

In `src/components/sidebar/Sidebar.tsx`, add an effect to listen for the event:

```typescript
useEffect(() => {
  const handler = () => setShortcutsOpen(true);
  window.addEventListener("alfredo:shortcuts-overlay", handler);
  return () => window.removeEventListener("alfredo:shortcuts-overlay", handler);
}, []);
```

- [ ] **Step 5: Verify compilation**

Run: `npm run build`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/ShortcutsOverlay.tsx src/components/sidebar/Sidebar.tsx src/hooks/useKeyboardShortcuts.ts src/components/layout/AppShell.tsx
git commit -m "feat: add keyboard shortcuts overlay with Cmd+? and sidebar ? icon"
```

---

### Task 10: Update settings/index.ts exports and clean up

**Files:**
- Modify: `src/components/settings/index.ts`

- [ ] **Step 1: Update exports**

Read `src/components/settings/index.ts` and update to remove `ExternalToolsSettings` export (deleted in Task 6) and add `ShortcutsOverlay`:

```typescript
export { GlobalSettingsDialog } from "./GlobalSettingsDialog";
export { WorkspaceSettingsDialog } from "./WorkspaceSettingsDialog";
export { ShortcutsOverlay } from "./ShortcutsOverlay";
```

- [ ] **Step 2: Search for any remaining ExternalToolsSettings imports**

Run: `grep -r "ExternalToolsSettings" src/`

If any results appear (other than in deleted files), remove those imports.

- [ ] **Step 3: Verify full build**

Run: `npm run build && cd src-tauri && cargo clippy`
Expected: Both pass clean

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/index.ts
git commit -m "chore: update settings exports, remove ExternalToolsSettings"
```

---

### Task 11: Visual verification

- [ ] **Step 1: Start the app**

Run: `npm run tauri dev`

- [ ] **Step 2: Verify each tab in Global Settings**

Open Settings (gear icon in sidebar header). Check each tab:

1. **General**: Theme grid renders, selecting a theme changes it live. Editor/Terminal dropdowns work. Custom path input appears when "Custom..." is selected.
2. **Terminal**: Font family dropdown works. Sliders update preview. Cursor buttons toggle. Blink toggle works. Hint text "Terminal changes apply immediately" is visible.
3. **Agent**: Model dropdown works. Effort segmented control highlights correctly. Permission mode dropdown updates the hint text below when changed. Output style works. Verbose toggle works.
4. **Notifications**: Master toggle shows/hides trigger section. Sound grid shows all sounds including new fun ones (coin, r2d2, zelda, etc). Play buttons work. Test notification fires.
5. **Integrations**: GitHub shows connected status. Linear API key input works.

- [ ] **Step 3: Verify Save/Cancel**

- Change a setting, verify Save button enables
- Click Cancel — dialog closes, changes NOT persisted (re-open to verify)
- Change a setting, click Save — dialog closes, re-open to verify changes persisted

- [ ] **Step 4: Verify status bar shows actual values**

- With default settings, status bar should show "High | Default | Default" (not "Effort | Permissions | Output")
- Change effort to "Max" in settings, restart session — status bar should show "Max"

- [ ] **Step 5: Verify shortcuts overlay**

- Click `?` icon in sidebar header — overlay opens with grouped shortcuts
- Press `Cmd+?` — overlay opens
- Press Escape — overlay closes

- [ ] **Step 6: Verify agent settings are global**

- Set model to Sonnet in Global Settings, save
- Switch to a different repo
- Open Global Settings — Agent tab should still show Sonnet

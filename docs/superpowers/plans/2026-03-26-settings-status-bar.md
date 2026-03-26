# Settings Status Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hidden gear-icon popover with a visible row of clickable dropdown chips showing resolved Claude settings in the terminal status bar.

**Architecture:** New `SettingsChip` component handles a single dropdown. New `SettingsStatusBar` composes four chips, loads/saves config, and shows a restart prompt on changes. `AgentSettingsPopover` is deleted.

**Tech Stack:** React, Tailwind CSS, existing Tauri config API (`getConfig`/`saveConfig`), existing `claudeSettingsResolver` service.

**Spec:** `docs/superpowers/specs/2026-03-26-settings-status-bar-design.md`

---

### Task 1: Create SettingsChip component

**Files:**
- Create: `src/components/terminal/SettingsChip.tsx`

- [ ] **Step 1: Create `SettingsChip` component**

```tsx
// src/components/terminal/SettingsChip.tsx
import { useRef, useEffect } from "react";

interface SettingsChipProps {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  isOpen: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
}

function SettingsChip({ label, options, value, isOpen, onToggle, onChange }: SettingsChipProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onToggle();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen, onToggle]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onToggle();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onToggle]);

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 px-2 py-0.5 text-xs text-text-secondary bg-bg-hover border border-border-default rounded-[var(--radius-sm)] hover:text-text-primary hover:border-border-hover transition-colors cursor-pointer"
      >
        {label}
        <span className="text-[10px] opacity-60">▾</span>
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 min-w-[140px] bg-bg-primary border border-border-default rounded-[var(--radius-md)] shadow-lg overflow-hidden z-50">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                onToggle();
              }}
              className={[
                "w-full px-3 py-1.5 text-xs text-left transition-colors cursor-pointer",
                opt.value === value
                  ? "text-accent-primary bg-accent-primary/8"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-hover",
              ].join(" ")}
            >
              {opt.value === value && <span className="mr-1.5">✓</span>}
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export { SettingsChip };
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors related to `SettingsChip.tsx`

- [ ] **Step 3: Commit**

```bash
git add src/components/terminal/SettingsChip.tsx
git commit -m "feat(settings): add SettingsChip dropdown component"
```

---

### Task 2: Create SettingsStatusBar component

**Files:**
- Create: `src/components/terminal/SettingsStatusBar.tsx`

This component loads resolved settings and composes four `SettingsChip` instances.

- [ ] **Step 1: Define display-label mappings and component**

```tsx
// src/components/terminal/SettingsStatusBar.tsx
import { useState, useEffect, useCallback } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "../ui/Button";
import { SettingsChip } from "./SettingsChip";
import { getConfig, saveConfig } from "../../api";
import { useAppConfig } from "../../hooks/useAppConfig";
import { resolveSettings } from "../../services/claudeSettingsResolver";
import type { ClaudeOverrides } from "../../types";

const MODEL_OPTIONS = [
  { value: "claude-opus-4-6", label: "Opus 4.6" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5" },
];

const EFFORT_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
];

const PERMISSION_OPTIONS = [
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

function displayModel(value?: string): string {
  return MODEL_OPTIONS.find((o) => o.value === value)?.label ?? "Default";
}

function displayEffort(value?: string): string {
  return EFFORT_OPTIONS.find((o) => o.value === value)?.label ?? "Default";
}

function displayPermission(value?: string): string {
  return PERMISSION_OPTIONS.find((o) => o.value === value)?.label ?? "Default";
}

function displayOutput(value?: string): string {
  return OUTPUT_OPTIONS.find((o) => o.value === value)?.label ?? "Default";
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
    }).catch(() => {});
  }, [repoPath, branch]);

  const handleChange = useCallback(async (field: keyof ClaudeOverrides, value: string) => {
    if (!repoPath) return;

    // Update local state immediately
    setResolved((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);

    // Save to worktreeOverrides
    const config = await getConfig(repoPath);
    const allOverrides = { ...config.worktreeOverrides };
    const current = allOverrides[branch] ?? {};
    const next = { ...current, [field]: value };

    // Clean out values that match defaults (store only true overrides)
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
          label={displayModel(resolved.model)}
          options={MODEL_OPTIONS}
          value={resolved.model ?? ""}
          isOpen={openDropdown === "model"}
          onToggle={() => toggleDropdown("model")}
          onChange={(v) => handleChange("model", v)}
        />
        <SettingsChip
          label={displayEffort(resolved.effort)}
          options={EFFORT_OPTIONS}
          value={resolved.effort ?? ""}
          isOpen={openDropdown === "effort"}
          onToggle={() => toggleDropdown("effort")}
          onChange={(v) => handleChange("effort", v)}
        />
        <SettingsChip
          label={displayPermission(resolved.permissionMode)}
          options={PERMISSION_OPTIONS}
          value={resolved.permissionMode ?? ""}
          isOpen={openDropdown === "permissionMode"}
          onToggle={() => toggleDropdown("permissionMode")}
          onChange={(v) => handleChange("permissionMode", v)}
        />
        <SettingsChip
          label={displayOutput(resolved.outputStyle)}
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors related to `SettingsStatusBar.tsx`

- [ ] **Step 3: Commit**

```bash
git add src/components/terminal/SettingsStatusBar.tsx
git commit -m "feat(settings): add SettingsStatusBar with resolved values and inline dropdowns"
```

---

### Task 3: Wire SettingsStatusBar into TerminalView and delete AgentSettingsPopover

**Files:**
- Modify: `src/components/terminal/TerminalView.tsx`
- Delete: `src/components/terminal/AgentSettingsPopover.tsx`

- [ ] **Step 1: Update TerminalView imports**

In `src/components/terminal/TerminalView.tsx`, replace the `AgentSettingsPopover` import with `SettingsStatusBar`:

Replace:
```tsx
import { AgentSettingsPopover } from "./AgentSettingsPopover";
```
With:
```tsx
import { SettingsStatusBar } from "./SettingsStatusBar";
```

- [ ] **Step 2: Replace the status bar markup**

In `src/components/terminal/TerminalView.tsx`, replace lines 211-219 (the status bar section):

Replace:
```tsx
      {/* Status bar */}
      {mode === "claude" && worktree && (
        <div className="relative flex items-center justify-end px-2 py-1 border-t border-border-default flex-shrink-0">
          <AgentSettingsPopover
            branch={worktree.branch ?? ""}
            onRestartSession={handleRestartSession}
          />
        </div>
      )}
```
With:
```tsx
      {/* Status bar */}
      {mode === "claude" && worktree && (
        <SettingsStatusBar
          branch={worktree.branch ?? ""}
          onRestartSession={handleRestartSession}
        />
      )}
```

- [ ] **Step 3: Delete AgentSettingsPopover**

```bash
rm src/components/terminal/AgentSettingsPopover.tsx
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors. No remaining references to `AgentSettingsPopover` (it was only imported in `TerminalView.tsx`).

- [ ] **Step 5: Manual smoke test**

Run `npm run dev` (or `cargo tauri dev`) and verify:
1. Claude terminal shows the status bar with four chips: model, effort, permission mode, output style
2. Chips show resolved values (not "Default" if `claudeDefaults` are set)
3. Clicking a chip opens a dropdown above it with options
4. Selecting an option updates the chip label immediately
5. "Settings changed · Restart" appears on the right after any change
6. Clicking Restart restarts the session
7. Clicking outside a dropdown closes it

- [ ] **Step 6: Commit**

```bash
git add src/components/terminal/TerminalView.tsx
git add -u src/components/terminal/AgentSettingsPopover.tsx
git commit -m "feat(settings): replace AgentSettingsPopover with SettingsStatusBar in TerminalView"
```

---

### Task 4: Clean up unused references

**Files:**
- Check: `docs/superpowers/plans/2026-03-26-agent-settings-session-resume.md` (references `AgentSettingsPopover`)

- [ ] **Step 1: Search for remaining references to AgentSettingsPopover**

Run: `grep -r "AgentSettingsPopover" src/`
Expected: no results

- [ ] **Step 2: Check if any plan docs reference it and update if needed**

The file `docs/superpowers/plans/2026-03-26-agent-settings-session-resume.md` references `AgentSettingsPopover`. If this plan is already completed, no action needed — it's historical. If it references the component as something to build on, note that it's now `SettingsStatusBar`.

- [ ] **Step 3: Final compile and build check**

Run: `npx tsc --noEmit`
Expected: clean build, no errors

- [ ] **Step 4: Commit (if any changes)**

Only commit if plan docs were updated:
```bash
git add -A
git commit -m "docs: update references from AgentSettingsPopover to SettingsStatusBar"
```

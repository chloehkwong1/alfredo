# Settings Status Bar Redesign

## Problem

The current terminal settings UI is a hidden popover behind a gear icon. Three issues:

1. **No visibility** — you can't see what model/effort/permissions are active without clicking
2. **Shows overrides, not resolved values** — "Default" doesn't tell you what the default actually is
3. **No feedback on changes** — settings save silently with no confirmation

## Design

Replace the gear-icon-only status bar with a row of clickable dropdown chips showing the four resolved settings: **Model**, **Effort**, **Permission Mode**, and **Output Style**.

### Status Bar (Default State)

A horizontal row of chips at the bottom of each Claude terminal, below the terminal content and above nothing (it's the last element). Each chip shows the **resolved** value — the result of merging `claudeDefaults` with any `worktreeOverrides[branch]`.

```
┌──────────────────────────────────────────────────────────┐
│ [Opus 4.6 ▾]  [Medium ▾]  [Auto ▾]  [Explanatory ▾]    │
└──────────────────────────────────────────────────────────┘
```

- Chips are left-aligned
- Each chip has a dropdown caret (▾) indicating interactivity
- No override indicator — just show the resolved value, clean and simple
- No gear icon — the chips themselves are the controls

### Inline Dropdown (Click a Chip)

Clicking a chip opens a small dropdown menu **above** the chip (since the bar is at the bottom). Each dropdown is independent — only one open at a time.

```
         ┌─────────────┐
         │ ✓ Opus 4.6  │
         │   Sonnet 4.6 │
         │   Haiku 4.5  │
         └─────────────┘
[Opus 4.6 ▾]  [Medium ▾]  [Auto ▾]  [Explanatory ▾]
```

- Checkmark on the currently active value
- Clicking an option: updates the chip immediately, saves to `.alfredo.json` worktreeOverrides, closes dropdown
- Clicking outside or pressing Escape closes the dropdown
- Effort dropdown shows: low, medium, high, max
- Model dropdown shows: Opus 4.6, Sonnet 4.6, Haiku 4.5
- Permission Mode dropdown shows: Default, Accept Edits, Plan, Auto, Don't Ask, Bypass
- Output Style dropdown shows: Default, Explanatory, Learning

### Restart Prompt (After Change)

Since settings are applied as CLI args at session start, changes require a restart. After any setting changes:

```
[Sonnet 4.6 ▾]  [Medium ▾]  [Auto ▾]  [Explanatory ▾]     Settings changed  [↻ Restart]
```

- "Settings changed" text + restart button appear on the right side of the bar
- The restart prompt persists until the session is restarted or the setting is changed back
- Chip shows the new value immediately (what will apply after restart)

### Settings Resolution

The bar shows **resolved** values by merging `claudeDefaults` with `worktreeOverrides[branch]` via the existing `resolveSettings()` function in `claudeSettingsResolver.ts`. When a chip value is changed, it writes to `worktreeOverrides[branch]` in `.alfredo.json` (same as current behavior).

Display labels for resolved values:
- Model: `claude-opus-4-6` → "Opus 4.6", `claude-sonnet-4-6` → "Sonnet 4.6", `claude-haiku-4-5` → "Haiku 4.5", undefined → "Default"
- Effort: value as-is with capitalize, undefined → "Default"
- Permission Mode: camelCase → display name mapping (same as current `PERMISSION_OPTIONS`), undefined → "Default"
- Output Style: value as-is, undefined → "Default"

## Components

### New: `SettingsStatusBar`

Replaces the current status bar `div` + `AgentSettingsPopover` in `TerminalView.tsx`.

**Props:**
- `branch: string` — current worktree branch
- `onRestartSession: () => void` — callback to restart the Claude session

**State:**
- `resolvedSettings: ResolvedClaudeSettings` — merged defaults + overrides
- `openDropdown: string | null` — which dropdown is open (model/effort/permissionMode/outputStyle)
- `hasChanges: boolean` — whether any setting has been changed since last restart

**Behavior:**
- On mount and when branch changes: load config, resolve settings, display
- On dropdown select: update `worktreeOverrides[branch]` in `.alfredo.json`, update local state, set `hasChanges = true`
- On restart click: call `onRestartSession()`, reset `hasChanges`

### New: `SettingsChip`

A single clickable chip with dropdown.

**Props:**
- `label: string` — display value (e.g., "Opus 4.6")
- `options: { value: string; label: string }[]` — dropdown options
- `value: string` — current value
- `isOpen: boolean`
- `onToggle: () => void`
- `onChange: (value: string) => void`

### Removed: `AgentSettingsPopover`

The entire component is replaced by `SettingsStatusBar`. The popover pattern is gone.

## Files Changed

| File | Change |
|------|--------|
| `src/components/terminal/SettingsStatusBar.tsx` | New — main component |
| `src/components/terminal/SettingsChip.tsx` | New — reusable chip + dropdown |
| `src/components/terminal/TerminalView.tsx` | Replace `AgentSettingsPopover` with `SettingsStatusBar` |
| `src/components/terminal/AgentSettingsPopover.tsx` | Delete |

## Out of Scope

- Changing how `claudeDefaults` or `worktreeOverrides` are stored (`.alfredo.json` structure stays the same)
- Global settings dialog changes (the `AgentSettings` tab in `GlobalSettingsDialog` is unrelated)
- Terminal preferences (font, cursor — those stay in the global settings dialog)
- Tab-level settings persistence (existing `WorkspaceTab.claudeSettings` is unchanged)

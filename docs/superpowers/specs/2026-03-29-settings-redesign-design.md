# Settings Redesign — Design Spec

## Overview

Full redesign of the Global Settings dialog to match Alfredo's visual polish, fix functional issues, and consolidate tabs. Also includes a keyboard shortcuts overlay, a `?` icon for discoverability, status bar improvements, and a fun expanded notification sound pack.

**Mockup:** `designs/settings-redesign.html` (interactive, click tabs)

---

## 1. Tab Restructure (7 → 5)

### New Tabs

| Tab | Contents | Source |
|-----|----------|--------|
| **General** | Theme grid + External Tools (editor/terminal dropdowns) | Merges Appearance + External Tools |
| **Terminal** | Font family, size, line height, letter spacing, cursor style/blink, preview | Unchanged functionally |
| **Agent** | Model, effort, permissions, output style, verbose | Moved from per-repo to global |
| **Notifications** | Master toggle, trigger toggles, sound picker, test button | Unchanged functionally |
| **Integrations** | GitHub CLI status + Linear API key | Unchanged functionally |

### Removed: Shortcuts Tab

Shortcuts are reference info, not configuration. They move to a dedicated overlay triggered by:
- **`Cmd+?`** keyboard shortcut (new)
- **`?` icon** in sidebar header, next to the gear icon

The overlay is a centered modal showing grouped shortcuts in the same format as the current Shortcuts tab content.

---

## 2. Visual Consistency

### Unified Component Styles

Every settings tab must use these exact patterns — no per-tab variations.

**Select dropdowns:**
- `bg-bg-primary` background (not `bg-hover` or `bg-secondary`)
- `border border-border-default rounded-[var(--radius-md)]`
- Custom chevron SVG via `background-image`
- Hover: `border-border-hover`
- Focus: `border-border-focus` + `ring-1 ring-accent-primary/50`

**Toggle switches:**
- Extract a shared `Toggle` component (NotificationSettings already has one — promote it)
- Dimensions: `w-9 h-5 rounded-full`
- On: `bg-accent-primary`, knob at `translate-x-[18px]`
- Off: `bg-bg-active`, knob at `translate-x-[3px]`
- Knob: `h-3.5 w-3.5 rounded-full bg-white`

**Toggle rows:**
- `flex items-center justify-between py-1.5`
- Label: `text-sm text-text-secondary`

**Section headings:**
- `text-[11px] font-semibold uppercase tracking-wider text-text-tertiary`
- Matches sidebar status group header style
- `mb-3`, with `mt-6` when not first child

**Field labels:**
- `text-sm font-medium text-text-primary mb-1.5`

**Hint text:**
- `text-xs text-text-tertiary mt-1`

**Segmented controls** (effort, output style):
- Container: `rounded-[var(--radius-md)] border border-border-default overflow-hidden`
- Items: `flex-1 px-3 py-1.5 text-xs font-medium`
- Active: `bg-accent-primary text-white`
- Inactive: `bg-bg-primary text-text-secondary hover:text-text-primary`

**Cursor style buttons** (terminal):
- Same as segmented but using `border-accent-primary bg-accent-muted text-text-primary` for active state (outlined, not filled)

### Dialog Layout

- **Width:** 680px (down from 720px)
- **No padding** on `DialogContent` — rail and body handle their own
- **Rail:** `w-40 bg-bg-primary border-r border-border-default` with `p-5 pr-3`
- **Body:** `flex-1 p-6 overflow-y-auto max-h-[480px]`
- **Footer:** `px-6 py-3.5 border-t border-border-default` with right-aligned Cancel + Save
- **Rail tabs:** `px-3 py-[7px] text-sm rounded-[var(--radius-md)]`
  - Active: `bg-accent-muted text-text-primary font-medium`
  - Inactive: `text-text-tertiary hover:text-text-secondary hover:bg-bg-hover`

---

## 3. Functional Fixes

### 3a. Agent Settings → Global

**Problem:** `claudeDefaults` lives in `AppConfig` (per-repo) but is shown in Global Settings. Setting model/effort in one repo doesn't apply to others.

**Fix:** Move `claudeDefaults` fields into `GlobalAppConfig`:

```
// Rust: GlobalAppConfig gains these fields
pub model: Option<String>,
pub effort: Option<String>,
pub permission_mode: Option<String>,
pub dangerously_skip_permissions: Option<bool>,
pub output_style: Option<String>,
pub verbose: Option<bool>,
```

**Migration:** On first load, if `GlobalAppConfig` has no agent fields but the active repo's `AppConfig` has `claudeDefaults`, seed the global config from the active repo's values. If multiple repos have different `claudeDefaults`, only the active repo is used — the others are ignored (per-worktree overrides still apply). The old `claudeDefaults` field on `AppConfig` is left in place but no longer read by the settings dialog.

**Frontend changes:**
- `GlobalSettingsDialog`: Agent tab reads/writes `appConfig` instead of `repoConfig`
- `claudeSettingsResolver.ts`: `resolveSettings` reads global config as the base, then applies per-worktree overrides from `worktreeOverrides`
- `TerminalView`: pass global config to `resolveSettings` instead of `config.claudeDefaults`

### 3b. Permission Mode Hint Bug

**Problem:** When selecting a permission mode, the hint text below the dropdown doesn't update to match.

**Fix:** The hint lookup uses `settings.permissionMode ?? "default"` but the rendered select uses `value={settings.permissionMode ?? "default"}`. These should always be in sync. Verify the `update()` call correctly sets `permissionMode` for all options including "bypassPermissions" (currently it does, but the hint should also be derived from the select's current value, not from state that may lag by a render).

Simplest fix: derive the hint from a local `selectedMode` that tracks the select value directly.

### 3c. Status Bar — Show Actual Values

**Problem:** When using defaults, the status bar chips show generic labels ("Effort", "Permissions", "Output") instead of the actual effective values.

**Fix:** Define Claude's actual defaults and use them as fallbacks:

```typescript
const CLAUDE_DEFAULTS = {
  effort: "high",
  permissionMode: "default",
  outputStyle: "Default",
};
```

Update `displayLabel` in `SettingsStatusBar.tsx`:
```typescript
function displayLabel(options, value, defaultValue): string {
  const effective = value || defaultValue;
  return options.find((o) => o.value === effective)?.label ?? defaultValue;
}
```

Chips always show the actual resolved value: "High", "Default", "Default".

### 3d. Terminal Settings Hint

**Problem:** Terminal settings save immediately (bypassing the Save button), which is good UX but could surprise users who expect Cancel to revert.

**Fix:** Add a subtle hint at the top of the Terminal tab:
```
"Terminal changes apply immediately to all sessions."
```
Style: `text-xs text-text-tertiary` — same as the Agent tab's existing hint pattern.

---

## 4. Keyboard Shortcuts Overlay

### Trigger
- `Cmd+?` (new keyboard shortcut)
- `?` icon button in sidebar header (next to gear icon)

### Implementation
- New component: `ShortcutsOverlay.tsx`
- Uses `Dialog` component, centered, ~480px wide
- Content: grouped shortcuts in the same format as the current Shortcuts tab
- Groups: Navigation, Tabs & Panes, Panels, Search, Changes View
- Each row: description (left) + kbd badge (right)
- No Save/Cancel footer — just a close button

### Sidebar Icon
- Add `HelpCircle` (lucide) `IconButton` to sidebar header, before the Settings gear
- `size="sm"` to match existing gear button
- Opens the shortcuts overlay

### Keyboard Registration
- Add `Cmd+?` (which is `Cmd+Shift+/`) to `useKeyboardShortcuts.ts`
- Needs a callback to open the overlay — pass via props or a lightweight store/event

---

## 5. Notification Sounds Expansion

### Current State
5 sounds (chime, pop, ding, ping, woodblock) + none — all plain sine wave oscillator pairs.

### New Sound Pack
Expand to ~12 sounds using richer synthesis: multiple waveforms (triangle, sawtooth, square), frequency sweeps, multi-note melodies, and layered chords. All still Web Audio API synthesized — no audio files needed.

**New sounds to add:**

| ID | Name | Description | Technique |
|----|------|-------------|-----------|
| `coin` | Coin | Mario-style ascending two-tone | Square wave, fast B5→E6 |
| `r2d2` | R2-D2 | Chirpy droid beep sequence | Rapid sine sweep 800→2400→1200Hz |
| `zelda` | Treasure | Zelda chest opening — ascending arpeggio | Triangle wave, 4-note climb |
| `quack` | Quack | Rubber duck descending honk | Sawtooth, quick 600→200Hz drop |
| `ufo` | UFO | Theremin-style warbling | Sine with vibrato (LFO modulation) |
| `laser` | Laser | Sci-fi pew pew | Sawtooth sweep 1500→200Hz, fast decay |
| `doorbell` | Doorbell | Classic two-tone ding-dong | Sine, E5 then C5, longer sustain |
| `bloop` | Bloop | Underwater bubble pop | Sine sweep 300→800Hz with fast attack |
| `victory` | Victory | Triumphant 3-note fanfare | Triangle wave chord: C-E-G |
| `whoosh` | Whoosh | Filtered noise sweep | White noise through bandpass filter sweep |
| `bonk` | Bonk | Comedy bonk sound | Square wave, very short 200Hz blip |
| `sparkle` | Sparkle | Magical ascending twinkle | High sine, rapid 5-note chromatic run |

### Synthesis Approach

Extend `playNotes` or add new synthesis functions:
- **Waveform per note:** Add optional `type: OscillatorType` to `SoundNote` (default: "sine")
- **Frequency sweeps:** Add optional `endFrequency` to `SoundNote` — use `exponentialRampToValueAtTime` on the oscillator frequency
- **LFO modulation:** For UFO/warble effects, connect a low-frequency oscillator to the main oscillator's frequency
- **Noise:** For whoosh, create a noise buffer source with a bandpass filter

Updated `SoundNote` type:
```typescript
type SoundNote = {
  frequency: number;
  duration: number;
  type?: OscillatorType;        // "sine" | "square" | "sawtooth" | "triangle"
  endFrequency?: number;        // for frequency sweeps
  gain?: number;                // override default 0.3
  delay?: number;               // offset from previous note end (default: 0.04)
};
```

### UI Changes
- Sound grid expands from 3-column to accommodate more options
- Keep 3-column grid but it'll scroll naturally with more rows
- Group: "Classic" (existing 5) and "Fun" (new 12) with a subtle separator, or just one flat grid sorted alphabetically

---

## 6. Scope Summary

| Area | Changes |
|------|---------|
| `GlobalSettingsDialog.tsx` | Rewrite — 5 tabs, new layout, unified styles |
| `AgentSettings.tsx` | Restyle + fix permission hint + read from global config |
| `TerminalSettings.tsx` | Restyle to match unified patterns, add hint |
| `NotificationSettings.tsx` | Restyle, expand sound grid |
| `ExternalToolsSettings.tsx` | Merge into General tab (may inline or keep as sub-component) |
| `ThemeSelector.tsx` | Restyle to match unified card pattern |
| `GithubSettings.tsx` | Restyle to match unified patterns |
| `useNotifications.ts` | Expand SOUNDS with new synthesized sounds, extend SoundNote type |
| `notificationConfig.ts` | No changes |
| New: `Toggle.tsx` | Shared toggle component extracted from NotificationSettings |
| New: `ShortcutsOverlay.tsx` | Keyboard shortcuts modal |
| `Sidebar.tsx` | Add `?` icon button in header |
| `useKeyboardShortcuts.ts` | Add `Cmd+?` binding |
| `SettingsStatusBar.tsx` | Show actual default values instead of generic labels |
| `claudeSettingsResolver.ts` | Read agent defaults from GlobalAppConfig |
| Rust: `types.rs` | Add agent fields to `GlobalAppConfig` |
| Rust: `config.rs` or similar | Migration logic for agent settings |
| `TerminalView.tsx` | Pass global config to `resolveSettings` |

---

## 7. Out of Scope

- Workspace Settings dialog (separate redesign if needed)
- Command palette (`Cmd+K` — separate feature)
- Custom keybinding configuration (shortcuts overlay is read-only)
- Audio file-based sounds (staying with Web Audio synthesis)

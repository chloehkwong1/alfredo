# UI Polish & Hierarchy Overhaul — Design Spec

**Date:** 2026-03-25
**Approach:** Hierarchy overhaul + design personality (Approach B)
**Personality:** Warm & Grounded — earthy tones, subtle warmth, professional but characterful

## Overview

Address four core issues with the current UI:
1. **Flat visual hierarchy** — sidebar, tabs, and status bar all use the same background; nothing recedes or pops
2. **Narrow typography scale** — text ranges 10–14px with no larger sizes outside onboarding
3. **Inconsistent spacing rhythm** — ad-hoc mix of values (mt-0.5, gap-2.5, py-2) with no predictable beat
4. **Generic personality** — well-made but unremarkable; missing a distinctive feel

Additionally: all content-dense areas (agent items, tab bar, status bar, status group headers, sidebar header, onboarding, create dialog) feel cramped and need more breathing room.

## 1. Design Tokens

### 1.1 Spacing Scale (4px base grid)

| Token       | Value | Use                                          |
|-------------|-------|----------------------------------------------|
| `space-xs`  | 4px   | Icon-to-text gaps, tight internal spacing     |
| `space-sm`  | 8px   | Related items within a group, inline gaps     |
| `space-md`  | 12px  | Component internal padding                    |
| `space-lg`  | 16px  | Section padding, component outer margins      |
| `space-xl`  | 24px  | Major section separators                      |

All spacing in the app must use one of these values. No arbitrary values (e.g., `mt-0.5`, `gap-2.5`, `py-2.5`).

### 1.2 Typography Scale

| Token      | Size  | Weight          | Use                                          |
|------------|-------|-----------------|----------------------------------------------|
| `text-2xs` | 10px  | medium (500)    | Diff stats, PR numbers, overflow counts       |
| `text-xs`  | 11px  | medium (500)    | Status text, PR titles, metadata              |
| `text-sm`  | 13px  | medium/semibold | Branch names, tab labels, body text           |
| `text-base`| 15px  | semibold (600)  | Dialog titles, section headings               |
| `text-lg`  | 20px  | semibold (600)  | Onboarding headings (step 2)                  |
| `text-xl`  | 26px  | semibold (600)  | Welcome screen headline                       |

Letter spacing: -0.5px on `text-xl`, -0.3px on `text-lg`, -0.2px on `text-base`.

### 1.3 Shared Heights

| Element                          | Height |
|----------------------------------|--------|
| Sidebar header + Tab bar         | 40px   |
| Status bar                       | 32px   |
| Sidebar expanded width           | 260px  |
| Sidebar collapsed width          | 48px   |

**Critical:** The sidebar header and tab bar bottom borders must align as one continuous horizontal line across the full app width. Both are 40px tall.

The same principle applies to the bottom: the sidebar footer border and the status bar border should align.

## 2. Visual Hierarchy

### 2.1 Background Zones

The sidebar is **darker** than the content area. The content area is slightly lighter. This creates clear visual separation without relying on heavy borders.

| Zone            | Token / Value                                  |
|-----------------|------------------------------------------------|
| Sidebar         | Darkest tone (~`#151413`)                      |
| Tab bar         | Mid tone, slightly lighter than sidebar (~`#1e1d1c`) |
| Content area    | Primary background (`--bg-primary` / `#1a1918`) |
| Status bar      | Same as tab bar (~`#1e1d1c`)                   |

Update `--bg-secondary` or introduce a `--bg-sidebar` token for the sidebar's darker background.

### 2.2 Border Reduction

Replace border-heavy separation with background contrast where possible. Borders should be subtle (`rgba(255,255,255,0.05–0.06)`) rather than the current `--border-default` (`#3d3a37`) which is too visible.

Keep borders for:
- Sidebar header bottom / tab bar bottom (aligned horizontal line)
- Sidebar footer top / status bar top (aligned horizontal line)
- Sidebar right edge (single vertical separator)

Remove or soften borders between:
- Status groups (use spacing instead)
- Agent items (use spacing and hover states instead)

## 3. Component Changes

### 3.1 Agent Items (sidebar rows)

**Current:** `px-4 py-2.5`, 2px line gaps (`mt-0.5`), 6px status dot, flat with border-left selection
**Proposed:**

- Padding: `12px` vertical, `12px` horizontal
- Inset from sidebar edge with `8px` horizontal margin + `8px` border-radius (light card style)
- Internal line gaps: `4px` between rows (branch → PR title → status line)
- Status dot: `7px` diameter
- Gap between dot and branch name: `8px`
- **Selected state:** subtle background (`rgba(147,51,234,0.08)`) + `2px` left border in accent color. The border sits on the left edge of the card (inside the 8px margin). Only the selected item gets a visible surface.
- **Unselected state:** flat (no background, no border, but same 2px transparent left border to prevent layout shift). Background appears on hover (`rgba(255,255,255,0.03)`).
- **Vertical gap between items:** `2px` margin

### 3.2 Status Group Headers

**Current:** `px-4 py-2`, 11px uppercase text
**Proposed:**

- Padding: `10px 16px 8px`
- Add `8px` top margin between groups (separates groups more clearly)
- Keep 11px uppercase semibold with 1.5px letter spacing
- Color: `#57534e` (slightly dimmer than current to recede more)

### 3.3 Tab Bar

**Current:** `h-9` (36px), 13px icons, `px-3` tab padding
**Proposed:**

- Height: `40px` (aligned with sidebar header)
- Horizontal padding: `16px` for the bar, `12px` per tab
- Tab gap: `4px`
- Icon size: `14px` (standardised, was 13px)
- Tab text: `13px` medium
- Active tab underline: `2px` accent color, inset `8px` from tab edges
- Background: `#1e1d1c` (mid tone, lighter than sidebar)

### 3.4 Status Bar

**Current:** `h-7` (28px), 10px external link icon
**Proposed:**

- Height: `32px`
- Horizontal padding: `16px`
- Font size: `11px` for all content
- External link icon: `12px`
- Branch name: `font-weight: 500`, slightly brighter color (`#a8a29e`)
- Background: `#1e1d1c` (same as tab bar)

### 3.5 Sidebar Header

**Current:** `h-12` (48px), icon button gap `4px`
**Proposed:**

- Height: `40px` (aligned with tab bar)
- Logo: `22px` with `6px` border-radius, gradient fill (`linear-gradient(135deg, #9333ea, #7e22ce)`)
- App name: `14px` semibold with `-0.3px` letter-spacing
- Icon button gap: `8px`
- Icon button size: `28px` with `6px` border-radius
- Background: same as sidebar body (darkest tone)

### 3.6 Sidebar Footer

- Padding: `16px` all sides
- Border top aligns with status bar border top
- "New worktree" button: unchanged styling, just more padding around it
- Remove "Workspace settings" text link (accessible via sidebar header settings icon)

### 3.7 Dialogs (Create Worktree)

**Current:** `p-6`, tab pills `p-1.5`, form labels `text-xs`, `mb-2.5` gap
**Proposed:**

- Dialog padding: `28px`
- Title: `text-base` (15px semibold) — use the defined scale token
- Description: `13px` color `#78716c`
- Tab pill container: `4px` padding, `8px` border-radius, background `#151413`
- Tab pills: `8px 14px` padding, `13px` text, `6px` border-radius
- Active pill: elevated background (`#2a2928`) with subtle border and shadow
- Form labels: `13px` medium, `8px` gap to input
- Form inputs: `10px 14px` padding, `8px` border-radius, `14px` font
- Form group spacing: `20px` between groups
- Footer: `28px` top margin, `20px` top padding
- Close button: `28px` square, `6px` border-radius

## 4. Onboarding Flow

### 4.1 Step 1: Welcome (repo selection)

No structural changes, just spacing updates:

- Logo: `64px` in a subtle container (`16px` border-radius, gradient purple tint)
- Logo to heading: `32px` gap
- Heading: `26px` semibold, `-0.5px` letter-spacing
- Heading to description: `12px` gap
- Description: `15px`, color `#a8a29e`, `line-height: 1.6`
- Description to CTA: `32px` gap
- CTA button: `12px 24px` padding, `14px` text
- Drag hint: `13px`, color `#57534e`, `20px` above

### 4.2 Step 2: Configure Workspace (NEW)

After a repo is selected, instead of immediately prompting worktree creation, show a configuration page. This replaces the current "Create your first worktree" onboarding step.

**Layout:** Centered column, `max-width: 480px`, `40px` top padding

**Header:**
- Repo confirmation: `13px`, shows repo name with checkmark + "Change" link
- `28px` gap below

**Title:** "Set up your workspace" — `text-lg` (20px) semibold
**Subtitle:** "Configure integrations and scripts. You can always change these later in settings." — `14px`, color `#78716c`
- `36px` gap below subtitle

**Config sections** (each in a soft card: `20px` padding, subtle border using `--border-default`, `10px` border-radius):

All colors in config sections use existing theme tokens — no hardcoded hex values. Map: titles use `--text-primary`, subtitles use `--text-tertiary`, helper text uses `--text-tertiary`, card backgrounds use `rgba(var(--text-primary-rgb), 0.02)`, icons use `rgba(var(--text-primary-rgb), 0.04)`.

1. **Connect GitHub**
   - Icon: `32px` square, `8px` border-radius, subtle background
   - Title: `text-sm` (13px) semibold, `--text-primary`
   - Subtitle: "Enables PR status, check runs, and branch management" — `text-2xs` (10px), `--text-tertiary`
   - Input: GitHub token field
   - Helper text: "Optional — you can add this later in settings" — `text-xs` (11px), `--text-tertiary`
   - `28px` gap below section

2. **Setup scripts**
   - Same card layout as above
   - Title: "Setup scripts"
   - Subtitle: "Run automatically when creating new worktrees"
   - Input: single command field (monospace), placeholder "npm install"
   - No "add another" — users can chain commands or configure later in settings
   - `28px` gap below section

3. **Worktree location**
   - Same card layout as above
   - Title: "Worktree location"
   - Subtitle: "Where new worktrees are created on disk"
   - Input: path field, pre-filled with default (parent directory of repo)
   - Helper text: "Default: sibling directories of the repository"
   - `36px` gap below section

**CTA:** Full-width primary button — "Create your first worktree"
- Opens the existing Create Worktree dialog
- Hint below: "This will open the worktree creation dialog" — `12px`, `--text-tertiary`

**All sections are optional.** User can skip everything and go straight to the CTA.

**State management:** The onboarding config inputs should write directly to the existing settings store (same store used by GlobalSettingsDialog / WorkspaceSettingsDialog). No separate onboarding state — the inputs are just a different UI surface for the same underlying config.

## 5. Responsive Behaviour

### 5.1 Window Resize

| Breakpoint   | Behaviour                                         |
|--------------|---------------------------------------------------|
| < 700px      | Sidebar auto-collapses to 48px                    |
| < 900px      | Use `space-sm` where `space-md` is default (tighter padding) |
| ≥ 900px      | Default spacing scale                             |
| ≥ 1440px     | Use `space-lg` where `space-md` is default (more generous) |

### 5.2 Implementation

Use a `ResizeObserver` on the app shell to detect window width and apply a `data-density` attribute (`compact`, `default`, `comfortable`) to the root element. This approach is preferred over CSS media queries because it gives us JS-level awareness of the current density (useful for components that need to adapt behaviour, not just styling) and could later be extended to a user-togglable density setting. Spacing tokens reference this attribute:

```css
:root { --space-component: 12px; } /* default */
:root[data-density="compact"] { --space-component: 8px; }
:root[data-density="comfortable"] { --space-component: 16px; }
```

This keeps the responsive logic in CSS custom properties rather than scattered across component classNames.

### 5.3 Display Density

On large monitors (≥ 1440px), the extra space should feel intentional, not empty. The `comfortable` density adds more padding inside components and between sections without changing the layout structure.

On small laptop screens (< 900px), the `compact` density tightens padding to avoid scrolling and cramping. The sidebar auto-collapses at 700px to give content area priority.

## 6. Theme Integration

All new tokens and colour changes must work across all 8 existing themes. The hierarchy changes (sidebar darker than content) should be expressed as relative adjustments to each theme's base palette, not hardcoded hex values.

For example, the sidebar background should be defined as a token (`--bg-sidebar`) that each theme sets relative to its own `--bg-primary`.

## 7. Files Affected

**Token changes:**
- `src/styles/theme.css` — add spacing tokens, typography tokens, `--bg-sidebar`
- `src/styles/themes.css` — add `--bg-sidebar` for each theme
- `src/styles/globals.css` — add density-responsive token overrides, update Tailwind `@theme` block

**Component changes:**
- `src/components/layout/AppShell.tsx` — aligned heights, density observer
- `src/components/layout/StatusBar.tsx` — height, padding, font sizes
- `src/components/sidebar/Sidebar.tsx` — header height, background, footer padding
- `src/components/sidebar/AgentItem.tsx` — padding, gaps, dot size, card style
- `src/components/sidebar/StatusGroup.tsx` — header padding, group spacing
- `src/components/terminal/TerminalView.tsx` — minor padding adjustment
- `src/components/kanban/CreateWorktreeDialog.tsx` — dialog spacing, tab pills, form fields
- `src/components/ui/Dialog.tsx` — padding, title size, footer spacing
- `src/components/ui/Button.tsx` — review padding against spacing scale
- `src/components/ui/Input.tsx` — review padding against spacing scale

**New/modified screens:**
- `src/components/onboarding/OnboardingScreen.tsx` — spacing updates + new Step 2 config page

**New infrastructure:**
- Density observer hook (e.g., `src/hooks/useDensity.ts`) — ResizeObserver that sets `data-density` on root

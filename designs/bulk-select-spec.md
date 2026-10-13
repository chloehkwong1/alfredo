# Bulk select — surfacing spec

**Status:** design approved by Chloe 2026-09-29 (she picked the ghost hover checkbox). **Not implemented.**
**Visual reference:** `designs/bulk-select.html` (open in browser — gitignored, local only).
**Feature it modifies:** bulk worktree multi-select, on main since 2026-09-24 (`dd316384..6ac81290` + review wave `af9843a2`). See `[[alfredo_bulk_actions_in_flight]]` memory.

## Problem

Multi-select shipped with **zero persistent pixels**. Both cues live in `StatusGroup.tsx:169-180` behind
`opacity-0 group-hover/grp:opacity-100` on the **column header** — an element whose only other job is collapse. Discovery
path is: hover a header you have no reason to hover → spot a 14px lightbulb → hover *that* → read a tooltip. Two hover
gates and a tooltip before you learn the feature exists.

Separately, `SelectionHint`'s button has `onClick={(e) => e.stopPropagation()}` — it does nothing when clicked. Anyone who
finds it clicks it and gets silence (cf. `[[feedback_no_unexplained_action_buttons]]`).

## Evidence that settled it

- **Modifier-only selection can't be the only door.** Lane, Napier, Peres & Sándor (2005), 251 experienced Word users:
  shortcut use under **10%** of command invocations, and time in the app had little relationship to proficiency —
  *exposure does not teach gestures*. Cockburn et al., ACM CSUR 2014: satisficing plus a transition performance dip
  blocks adoption.
- **Hiding an affordance has a measured cost.** NN/g hidden-vs-visible navigation: discoverability down >20%, desktop
  users ≥39% slower, hidden menus used in 27% of cases vs 48–50% visible.
- **The lightbulb tooltip is the one approach actively ruled out.** NN/g on instructional overlays: users can't read
  hints and use the app at once, memory fades in ~20s, and people shown tutorials rated ease-of-use **4.92 vs 5.49** for
  skippers — teaching made the app feel *harder*.
- **Hover can't carry it alone.** GitHub Primer: essential meaning "must not depend on hover, icon-only controls, or
  pointer precision". WCAG 1.4.13 exists because motor-impaired users can't hold a pointer steady; keyboard-only users
  never trigger hover at all.
- **Comparative survey (12 apps).** Most dense desktop panels show *nothing* until modifier-click (Finder, Figma, VS Code,
  Arc, Things, Todoist, Superhuman, macOS Mail). **Linear** — closest analogue, dense rows, list *and* board — uses a
  hover-revealed checkbox at the row's left edge + ⇧-click + ⌘-A + a bulk-action bar. **No desktop app ships a "Select"
  mode toggle** (only iOS Mail, labelled "Edit"). **No app teaches the modifier with an inline hint.**

## Design

1. **Make "Select all" persistent** — drop the opacity gating at `StatusGroup.tsx:172`. One always-visible labelled door.
   Satisfies Nielsen #6, Primer and WCAG. **Keep it even after the checkbox lands**: hover cannot be the only door.
2. **Delete `SelectionHint`** (`src/components/sidebar/SelectionHint.tsx`) — dead click handler, and the one pattern the
   evidence rules out. Move the gesture hint into `SelectionBar` as quiet trailing text (`⇧-click to extend · ⌘-click to
   add one`), so it teaches at the moment of use.
3. **Ghost checkbox on row hover**, taking the status dot's slot — zero width cost, zero layout shift. Rows get hovered
   constantly, unlike headers.
4. **In selection mode, checkbox on every row in the column**, same slot. Material 1's rule: hover is the entry point,
   but once selection begins the affordance becomes persistent. This is the part the current build lacks entirely.

### Two corrections made during design — do not regress these

- **The status dot is *not* the attention signal.** The first spec claimed it was, and rejected the dot swap on that
  basis. Wrong: `getBorderClass` (`AgentItem.tsx`) gives attention states a 3px solid left border via `.border-attn`
  (`src/styles/globals.css:355`), errors `.border-error`, unread the dashed variants. Attention/error survive the dot's
  removal. What the dot uniquely carries is **busy vs idle vs notRunning** — rarely what you select on. So the swap is
  cheap and is now the recommendation.
- **The checkbox does not need the row to become a `<div>`.** The first spec said it did, because the row is a
  `<button>` carrying dnd-kit `useSortable` listeners that is also the `ContextMenuTrigger` (nested control = invalid
  HTML + fights the drag listeners). But `AgentItem.tsx:1279` already wraps everything in
  `<div ref={rowContainerRef} className="relative">`, outside the `ContextMenu`. See implementation below.

## Implementation path

Render the checkbox as an **absolutely-positioned sibling** of `<ContextMenu>` inside the existing `rowContainerRef`
wrapper (`AgentItem.tsx:1279`), over the dot's coordinates. Nothing nests inside the button: no invalid HTML, no
propagation stops, no element swap, no remount near the React `#185` crash surface (`[[alfredo_sidebar_crashes_root_caused]]`).

Two requirements:
- Add a **named group** to that wrapper (`group/row`) — `group-hover` only reaches descendants, and the existing `group`
  is on the row button itself. Precedent: `group/grp` in `StatusGroup`.
- **Hide it while `isDragging`** — the wrapper does not carry dnd-kit's transform, so the checkbox would sit still while
  the row slides.

Row geometry: row is `px-3 py-2`, leading dot is `h-2 w-2` with `mt-1`, so the checkbox (14px) centres at roughly
`left: 9px; top: 7px`. Confirm against the running app.

`.check` is a **new component**: neither `src/components/ui/` nor `designs/kit.css` has a checkbox, and there is no
Radix checkbox dependency (only context-menu, dialog, dropdown-menu, tooltip). Add the class to `kit.css` when built, so
the kit keeps mirroring the real library.

### Ship order

1. Persistent "Select all" + delete `SelectionHint` + hint into `SelectionBar`. Small, no new component, carries most of
   the discoverability win.
2. Checkbox overlay (hover ghost → persistent once ≥1 selected).

## Rejected, with reasons

| Option | Why not |
|---|---|
| Explicit "Select" mode toggle | No desktop app ships one; adds a mode and a click. Only iOS Mail ("Edit"). |
| Persistent checkboxes on all rows | ~22px of every row permanently; reads as a form; competes with status and pins. |
| Marquee / rubber-band drag | Collides with dnd-kit row dragging; no keyboard equivalent. |
| Keep the lightbulb tooltip | Tooltip-as-teaching is the documented failure above; nobody else does it. |
| Checkbox *beside* the dot | Alternative, not wrong: ~22px + a shift on entering selection mode. Only worth it if telling busy from idle mid-selection matters. |

## Open questions

- Exact overlay offset needs checking against the running app (numbers above are derived from classes, not measured).
- Does the ghost checkbox want a hit area larger than 14px? Gmail uses a 40px circular hit target around a small box.
- `⌘-A` for select-all-in-column is not implemented and wasn't part of this design. Linear has it; worth considering.
- Keyboard path to the checkbox: it's outside the row button, so tab order needs deciding (likely skip it and rely on
  "Select all" + the existing `X`-style row focus, but this is undesigned).

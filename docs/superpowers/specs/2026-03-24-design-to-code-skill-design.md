# Design Spec: design-to-code Skill

**Date:** 2026-03-24
**Author:** Chloe + Claude

## Problem

When implementing frontend UI from visual references (brainstorming mockups, Figma screenshots), the output frequently drifts from the design. The two main offenders:

1. **Spacing/layout drift** — padding, margins, gaps, and proportions don't match the design
2. **Visual details dropped** — animations, hover states, shadows, and border radii get simplified or skipped

Existing skills don't address this:
- `frontend-design` handles creative direction for new UI, not faithful reproduction of an existing design
- `review-ui` catches issues post-implementation but doesn't prevent them

The user often "just knows it's off" but finds it hard to articulate exactly what's wrong — which points to a systemic fidelity problem rather than isolated mistakes.

## Solution

A three-phase skill called `design-to-code` that enforces **Extract → Implement → Verify** when implementing UI from a visual reference.

### Skill Identity

- **Name:** `design-to-code`
- **Description:** "Use when implementing UI from a visual reference (mockup, Figma screenshot, design image) — ensures implementation matches the design through visual spec extraction and agent-browser verification"
- **Location:** `~/.claude/skills/design-to-code/SKILL.md`
- **Type:** Discipline-enforcing (rigid — follow exactly)

### Trigger Conditions

- User provides an image/mockup and asks to implement it
- A brainstorming session produced visual mockups that now need implementing
- User says "make it look like this" with a visual reference
- A plan section references a design/mockup to implement

### Non-Triggers

- No visual reference exists (verbal description only → use `frontend-design`)
- Trivial changes (label text, toggling a prop)
- Non-UI work (backend, Rust/Tauri, data logic)
- Review-only without a design reference (→ use `review-ui`)

## Three Phases

### Phase 1: Extract

Before writing any code, analyze the design reference and produce a **visual spec** — a numbered checklist of every visual property that must be implemented.

**What gets extracted:**

| Category | What to capture |
|----------|----------------|
| Layout | Overall structure (flex/grid, columns, alignment), element ordering, spatial hierarchy |
| Spacing | Gaps between elements, padding within containers, margins. Estimated in px or relative terms |
| Typography | Relative sizes (heading vs body), weights, distinctive type treatments |
| Colors | Mapped to project design tokens where possible, flagging colors not in the theme |
| Shadows & depth | Which elements are elevated, shadow intensity |
| Border radius | Which elements are rounded, how much |
| Animations & transitions | Any motion visible or implied (hover states, entrances, micro-interactions) |
| Interactive states | Hover, focus, active, disabled appearances |
| Decorative details | Gradients, overlays, dividers, icons, visual flourishes |

**Output format:** A numbered checklist written into the conversation:

```
Visual Spec — [Component Name]
1. Layout: two-column, sidebar left (200px), content right
2. Spacing: 24px padding inside dialog, 16px gap between form fields
3. Header: text-lg font-semibold, --text-primary
4. Cards: --bg-elevated, --radius-md, --shadow-sm
5. Hover: cards lift with --shadow-md on hover
...
```

This checklist is the contract for Phase 2.

### Phase 2: Implement

Implement the UI using the visual spec checklist as a guide. Rules:

- **Reference the checklist explicitly** — tick off each item while coding. If skipping something, explicitly note why
- **Use the project's design system** — map extracted values to existing design tokens and the custom component library. Don't hardcode values that exist as tokens
- **Spacing precision** — the #1 offender. When the spec says "24px padding," use `p-6` not `p-4`. Get proportions right
- **Don't simplify visual details** — if the spec lists a shadow, implement it. If it lists a hover state, implement it. No "I'll add that later" unless explicitly agreed

No new coding rules — just accountability to the Phase 1 spec.

### Phase 3: Verify

After implementation, visually verify using agent-browser before declaring done.

1. **Screenshot the implementation** — open the running app, navigate to the implemented UI, screenshot it
2. **Side-by-side comparison** — compare against the original design reference, going through the spec checklist item by item
3. **Score each item:**
   - **Match** — looks correct
   - **Drift** — noticeable difference, needs fixing
   - **Missing** — not implemented
4. **Fix drift/missing items** — address issues, re-screenshot and re-check those items
5. **Final confirmation** — only after all items are Match or explicitly deferred with user agreement can implementation be declared complete

**Key rules:**
- **No self-certification** — "looks good to me" without a screenshot is not allowed. Screenshot is mandatory evidence
- **Check interactive states** — hover over elements, click things, verify transitions work. Don't just check static state
- **Check at the right viewport** — use the actual app window size, not an arbitrary browser width
- **Attempt limit** — if after 2 fix attempts a visual detail still doesn't match, report back with what's off and what was tried (per CLAUDE.md test-fixing protocol)

## Relationship to Other Skills

```
frontend-design  →  Creative direction (what should it look like?)
design-to-code   →  Implementation fidelity (does code match the design?)
review-ui        →  Post-hoc quality review (is the UI good regardless of reference?)
```

These complement each other:
- `frontend-design` or brainstorming produces the design
- `design-to-code` ensures the implementation matches
- `review-ui` catches broader UX issues

## Skill Type

**Discipline-enforcing (rigid).** All three phases are mandatory when the skill triggers. The extract and verify phases are the whole point — skipping either one defeats the purpose.

## Success Criteria

- Implementations match designs on first review significantly more often
- Spacing and proportions are correct without needing manual correction
- Visual details (shadows, hover states, animations) are present in the first implementation
- The user no longer has the "I just know it's off" feeling

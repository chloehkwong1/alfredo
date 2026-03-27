---
name: mockup
description: Produce high-fidelity HTML mockups using the Alfredo design kit. Usable standalone or from brainstorming.
---

# High-Fidelity Mockup

Create HTML mockups that visually match the real Alfredo app by using the design kit (`designs/kit.css`).

## When to use

- Standalone: `/mockup` — when you need a quick visual prototype of a UI idea
- From brainstorming: when the brainstorming skill reaches a visual question, delegate mockup creation here
- Before implementation: to get sign-off on exactly what will be built

## Rules

1. **Always link the design kit.** Every mockup must include: `<link rel="stylesheet" href="/PATH/TO/designs/kit.css">`
   - For visual companion fragments: use a relative path or inline the kit's `@import`
   - For standalone files in `designs/`: use `<link rel="stylesheet" href="kit.css">`
2. **Use kit classes, never inline styles for things the kit covers.** If the kit has a class for it, use it. Only use inline styles for layout-specific or one-off positioning.
3. **Use the component reference below** — these classes produce the same visual output as the React components.
4. **Save mockups to `designs/`** with descriptive names (e.g., `designs/pr-flow-sidebar.html`).
5. **Mockups must be complete HTML documents** (not fragments) so they can be opened directly in a browser.

## Mockup HTML Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mockup — DESCRIPTION</title>
  <link rel="stylesheet" href="kit.css">
  <style>
    /* Mockup-specific overrides only — layout positioning, etc. */
  </style>
</head>
<body>
  <!-- Use kit classes for all components -->
</body>
</html>
```

## Component Reference

These classes map 1:1 to `src/components/ui/` React components. Use them exactly as shown.

### Button
```html
<!-- Variants: btn-primary (default), btn-secondary, btn-ghost, btn-danger -->
<!-- Sizes: default (md), btn-sm, btn-lg -->
<button class="btn btn-primary">Save</button>
<button class="btn btn-secondary btn-sm">Cancel</button>
<button class="btn btn-ghost">Skip</button>
<button class="btn btn-danger">Delete</button>
```

### Icon Button
```html
<!-- Sizes: default (md), icon-btn-sm, icon-btn-lg -->
<button class="icon-btn">
  <svg>...</svg>
</button>
```

### Card
```html
<div class="card p-lg">
  Card content
</div>
<div class="card card-hoverable p-lg">
  Hoverable card
</div>
```

### Badge (with status dot)
```html
<!-- Variants: badge-idle, badge-busy, badge-waiting, badge-error, or none for default -->
<span class="badge badge-idle">Running</span>
<span class="badge badge-busy">Working</span>
<span class="badge badge-error">Failed</span>
<span class="badge">Default</span>
```

### Input
```html
<input class="input" placeholder="Search agents..." />
```

### Dialog
```html
<div class="dialog-overlay">
  <div class="dialog-content">
    <button class="dialog-close">✕</button>
    <div class="dialog-header">
      <div class="dialog-title">Dialog Title</div>
      <div class="dialog-description">Description text here.</div>
    </div>
    <!-- body content -->
    <div class="dialog-footer">
      <button class="btn btn-secondary">Cancel</button>
      <button class="btn btn-primary">Confirm</button>
    </div>
  </div>
</div>
```

### Dropdown Menu
```html
<div class="dropdown-content">
  <div class="dropdown-label">Section</div>
  <button class="dropdown-item">Option one</button>
  <button class="dropdown-item">Option two</button>
  <div class="dropdown-separator"></div>
  <button class="dropdown-item text-error">Delete</button>
</div>
```

### Tooltip
```html
<div class="tooltip">Tooltip text</div>
```

## Layout Reference

The app uses a sidebar + main content layout:

```html
<div class="app-layout">
  <div class="sidebar">
    <div class="sidebar-section-label">Agents</div>
    <div class="sidebar-item active">
      <span class="status-dot status-dot-busy"></span>
      Agent Name
    </div>
    <div class="sidebar-item">
      <span class="status-dot status-dot-idle"></span>
      Another Agent
    </div>
  </div>
  <div class="main-content">
    <div class="bar">
      <span class="font-semibold">Title</span>
    </div>
    <div class="panel">
      <!-- page content -->
    </div>
  </div>
</div>
```

## Status Dots
```html
<span class="status-dot status-dot-idle"></span>    <!-- green -->
<span class="status-dot status-dot-busy"></span>    <!-- amber, animated pulse -->
<span class="status-dot status-dot-waiting"></span> <!-- blue -->
<span class="status-dot status-dot-error"></span>   <!-- red -->
```

## Utility Classes Available

| Category | Classes |
|----------|---------|
| **Text size** | `text-2xs`, `text-xs`, `text-sm`, `text-base`, `text-lg` |
| **Text weight** | `font-medium`, `font-semibold` |
| **Text color** | `text-primary`, `text-secondary`, `text-tertiary` |
| **Status text** | `text-idle`, `text-busy`, `text-waiting`, `text-error` |
| **Flex** | `flex`, `flex-col`, `items-center`, `justify-between`, `justify-end`, `flex-1`, `shrink-0` |
| **Gap** | `gap-xs` (4px), `gap-sm` (8px), `gap-md` (12px), `gap-lg` (16px), `gap-xl` (24px) |
| **Padding** | `p-sm`, `p-md`, `p-lg`, `p-xl`, `px-sm`, `px-lg` |
| **Margin** | `mt-sm`, `mt-md`, `mt-lg`, `mb-sm`, `mb-md` |
| **Layout** | `w-full`, `truncate`, `hidden` |

## When used from brainstorming

When the brainstorming skill needs a visual mockup:
1. Brainstorming delegates to this skill for the HTML creation
2. Create the mockup as a standalone HTML file in `designs/`
3. The mockup should show the specific UI being discussed — not the whole app unless relevant
4. Return to the brainstorming flow after the mockup is saved

## Keeping the kit in sync

If you add a new component to `src/components/ui/`, add a corresponding CSS class to `designs/kit.css` and update the component reference in this skill. The kit must always mirror the real component library.

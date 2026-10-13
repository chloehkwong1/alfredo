import { Check, Minus } from "lucide-react";

interface CheckboxProps {
  checked: boolean;
  /** "Some, not all" — the bulk-bar state. Renders filled with a dash and
   *  reports `aria-checked="mixed"`. Clicking reports `checked: true`, the
   *  conventional "complete the selection" direction (Gmail, PatternFly). */
  indeterminate?: boolean;
  /** The originating event comes through so callers can read modifier keys —
   *  a shift-click on a list checkbox conventionally extends a range. */
  onChange: (checked: boolean, e: React.MouseEvent) => void;
  disabled?: boolean;
  /** Required: a checkbox in a dense list has no adjacent text to name it. */
  label: string;
  /** Faded until hovered or otherwise made relevant by the parent. Kept as a
   *  prop rather than a CSS group-hover so a list can ink every box at once. */
  dimmed?: boolean;
  className?: string;
}

/** A small square checkbox for selecting rows in a list.
 *
 *  Distinct from `Toggle`, which is a `role="switch"` for settings: this
 *  answers "is this row part of my selection", not "is this feature on".
 *
 *  Deliberately a `<span>`, not a `<button>`: every sidebar row is itself a
 *  `<button>`, and a nested button is invalid HTML — React rejects it outright
 *  ("<button> cannot be a descendant of <button>"). `role="checkbox"` plus
 *  `tabIndex` keeps it operable by keyboard, with Space and Enter bound the way
 *  a native checkbox binds them.
 *
 *  It also stops pointer, mouse, click and its own Space/Enter key events from
 *  reaching the parent. Sidebar rows are dnd-kit drag handles and context-menu
 *  triggers, so an unguarded nested control starts a drag or opens the
 *  worktree instead of ticking. */
function Checkbox({ checked, indeterminate, onChange, disabled, label, dimmed, className }: CheckboxProps) {
  const filled = checked || indeterminate;
  const toggle = (e: React.MouseEvent) => {
    if (disabled) return;
    e.stopPropagation();
    onChange(indeterminate ? true : !checked, e);
  };
  return (
    <span
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={toggle}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Only Space and Enter belong to the box: they tick it, and they must
        // not reach the row behind, whose dnd-kit keyboard sensor would start
        // a drag on the same keys. Every other key passes through, so the
        // window-level handlers (Escape clears the selection, ⌘1-9 switches
        // worktrees) still fire while a checkbox holds focus — which is the
        // normal state right after clicking one.
        if (e.key !== " " && e.key !== "Enter") return;
        e.stopPropagation();
        if (disabled) return;
        e.preventDefault();
        onChange(indeterminate ? true : !checked, e as unknown as React.MouseEvent);
      }}
      className={[
        "inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-[3px] border",
        "transition-all duration-[var(--transition-fast)]",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary",
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
        filled
          ? "bg-accent-primary border-accent-primary"
          : "border-border-hover bg-transparent hover:border-text-tertiary",
        // Zero ink at rest: the row reserves the gutter, but an unchecked box
        // only appears once it is relevant. A filled box always shows.
        !filled && dimmed ? "opacity-0" : "opacity-100",
        className ?? "",
      ].join(" ")}
    >
      {indeterminate ? (
        <Minus className="h-2.5 w-2.5 text-text-on-accent" strokeWidth={3.5} />
      ) : (
        checked && <Check className="h-2.5 w-2.5 text-text-on-accent" strokeWidth={3.5} />
      )}
    </span>
  );
}

export { Checkbox };
export type { CheckboxProps };

export type TourTargetId =
  | "create-worktree"
  | "setup-script"
  | "agent-terminal"
  | "open-in-ide";

export type TourTargetState =
  | { kind: "visible"; element: HTMLElement }
  | { kind: "hidden-sidebar" }
  | { kind: "missing" };

function find(id: TourTargetId): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour-id="${id}"]`);
}

export function resolveTarget(id: TourTargetId): TourTargetState {
  const el = find(id);
  if (!el) return { kind: "missing" };
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return { kind: "hidden-sidebar" };
  return { kind: "visible", element: el };
}

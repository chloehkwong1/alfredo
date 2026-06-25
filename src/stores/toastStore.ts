import { create } from "zustand";
import type { ReactNode } from "react";

export interface Toast {
  id: string;
  message: ReactNode;
  /** Optional inline action (e.g. Undo). Clicking it does NOT auto-dismiss —
   *  the action handler is responsible for whatever UI follows. */
  action?: { label: string; onClick: () => void };
  /** Auto-dismiss timeout in ms. Defaults to 6000. Pass 0 to keep the toast
   *  until manually dismissed (rare — used for blocking errors). */
  durationMs?: number;
  /** "progress" renders a prominent, spinner-led toast centered at the top —
   *  for in-flight actions that would otherwise read as "nothing happened".
   *  Defaults to the standard bottom-right notification. */
  variant?: "default" | "progress";
}

interface ToastState {
  toasts: Toast[];
  show: (toast: Omit<Toast, "id">) => string;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  show: (t) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set({ toasts: [...get().toasts, { ...t, id }] });
    const duration = t.durationMs ?? 6000;
    if (duration > 0) {
      setTimeout(() => get().dismiss(id), duration);
    }
    return id;
  },

  dismiss: (id) => {
    set({ toasts: get().toasts.filter((x) => x.id !== id) });
  },
}));

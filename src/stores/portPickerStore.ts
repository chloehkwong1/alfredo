import { create } from "zustand";

/** A request from `useServer` to open the port picker for a specific
 *  worktree because the silent auto-assign hit `rangeFull`. The split-button
 *  for that worktree watches this store and auto-opens its dropdown when the
 *  request matches its own worktreeId.
 *
 *  Caret-click opens of the picker bypass this store entirely — they're pure
 *  local state inside the split-button. The store exists only to bridge the
 *  one cross-component case (useServer can't reach into PaneTabBar). */
interface OpenForStartRequest {
  repoPath: string;
  worktreeId: string;
  /** Monotonic id so the consumer can detect a fresh request even when the
   *  worktreeId hasn't changed (rare but possible). */
  token: number;
  resolve: (port: number) => void;
  reject: (err: Error) => void;
}

interface PortPickerState {
  pendingForStart: OpenForStartRequest | null;

  /** useServer calls this when its silent auto-assign returns `rangeFull`.
   *  Returns a promise that resolves with the chosen port (after the take
   *  succeeds), or rejects on cancel. Supersedes any previous in-flight
   *  request — the old promise is rejected with "superseded". */
  openForStart: (args: { repoPath: string; worktreeId: string }) => Promise<number>;

  /** Called by the split-button after the user picks a port and the take
   *  succeeds. Resolves the pending start promise so useServer continues. */
  resolveStart: (token: number, port: number) => void;

  /** Called when the user dismisses the picker without choosing. */
  cancelStart: (token: number) => void;
}

export const usePortPickerStore = create<PortPickerState>((set, get) => ({
  pendingForStart: null,

  openForStart: ({ repoPath, worktreeId }) =>
    new Promise<number>((resolve, reject) => {
      const previous = get().pendingForStart;
      if (previous) {
        previous.reject(new Error("Port-picker request superseded"));
      }
      const token = (previous?.token ?? 0) + 1;
      set({
        pendingForStart: { repoPath, worktreeId, token, resolve, reject },
      });
    }),

  resolveStart: (token, port) => {
    const current = get().pendingForStart;
    if (!current || current.token !== token) return;
    current.resolve(port);
    set({ pendingForStart: null });
  },

  cancelStart: (token) => {
    const current = get().pendingForStart;
    if (!current || current.token !== token) return;
    current.reject(new Error("Port-picker dismissed"));
    set({ pendingForStart: null });
  },
}));

import { create } from "zustand";
import type { PortHolder } from "../types";

/** Public shape passed by the caller to open the exhaustion dialog. The
 *  internal `Exhaustion` state adds the promise resolvers and a nonce token.
 *  Splitting this out keeps the external API obvious without leaning on
 *  `Omit<...>` to hide internals. */
export interface ExhaustionRequest {
  repoPath: string;
  /** Worktree id (== name) that's trying to claim a port. */
  worktreeId: string;
  /** Branch name for display — the PTY spawn flow doesn't pass the worktree
   *  object in, so the caller resolves it from the store and hands it over. */
  targetBranch: string;
  rangeStart: number;
  rangeEnd: number;
  holders: PortHolder[];
}

/** Exhaustion context held while the dialog is open. The token is a nonce
 *  incremented on every new `showExhaustion`; any operation capturing the
 *  token at entry can compare it later to detect that the flow was superseded
 *  or cancelled mid-await, preventing stale closures from resolving the wrong
 *  promise (see code review C4). */
interface Exhaustion extends ExhaustionRequest {
  token: number;
  resolve: (port: number) => void;
  reject: (err: Error) => void;
  /** Non-null when the most recent release or retry attempt failed. The
   *  dialog renders this inline so the user has visible feedback. Cleared
   *  when the user clicks Release again. */
  error: string | null;
}

interface PortClaimState {
  exhaustion: Exhaustion | null;

  /** Open the exhaustion dialog and return a promise that resolves with the
   *  claimed port once the user has freed a slot, or rejects when they cancel.
   *  If an exhaustion is already in-flight (e.g. a second spawn hits the same
   *  wall), the existing promise is rejected with "superseded" before the new
   *  one takes its place. */
  showExhaustion: (req: ExhaustionRequest) => Promise<number>;

  /** Replace the holders list in-place (used after a release+retry round
   *  still returned rangeFull — likely a race with another claim). */
  updateHolders: (token: number, holders: PortHolder[]) => void;

  /** Set or clear the inline error message for the current flow. */
  setError: (token: number, error: string | null) => void;

  /** Finish the flow. No-op if the token doesn't match the current
   *  exhaustion (e.g. the user already cancelled, or the flow was superseded). */
  resolveWithPort: (token: number, port: number) => void;
  cancel: () => void;
}

export const usePortClaimStore = create<PortClaimState>((set, get) => ({
  exhaustion: null,

  showExhaustion: (req) =>
    new Promise<number>((resolve, reject) => {
      const previous = get().exhaustion;
      if (previous) {
        // Don't leak the old promise — reject it explicitly so the caller's
        // awaiting spawn path sees a clear failure instead of hanging.
        previous.reject(new Error("Port claim superseded by a newer request"));
      }
      const token = (previous?.token ?? 0) + 1;
      set({
        exhaustion: {
          ...req,
          token,
          resolve,
          reject,
          error: null,
        },
      });
    }),

  updateHolders: (token, holders) => {
    const current = get().exhaustion;
    if (!current || current.token !== token) return;
    set({ exhaustion: { ...current, holders } });
  },

  setError: (token, error) => {
    const current = get().exhaustion;
    if (!current || current.token !== token) return;
    set({ exhaustion: { ...current, error } });
  },

  resolveWithPort: (token, port) => {
    const current = get().exhaustion;
    if (!current || current.token !== token) return;
    current.resolve(port);
    set({ exhaustion: null });
  },

  cancel: () => {
    const current = get().exhaustion;
    if (!current) return;
    current.reject(new Error("Port claim cancelled by user"));
    set({ exhaustion: null });
  },
}));

import { create } from "zustand";
import type { AgentState } from "../types";

interface SessionStatusState {
  /** Per-session agent state, keyed by sessionKey (tab.id). */
  statuses: Record<string, AgentState>;
  setSessionStatus: (sessionKey: string, state: AgentState) => void;
  clearSessionStatus: (sessionKey: string) => void;
}

export const useSessionStatusStore = create<SessionStatusState>((set) => ({
  statuses: {},
  setSessionStatus: (sessionKey, state) =>
    set((s) =>
      s.statuses[sessionKey] === state
        ? s
        : { statuses: { ...s.statuses, [sessionKey]: state } },
    ),
  clearSessionStatus: (sessionKey) =>
    set((s) => {
      if (!(sessionKey in s.statuses)) return s;
      const { [sessionKey]: _, ...rest } = s.statuses;
      return { statuses: rest };
    }),
}));

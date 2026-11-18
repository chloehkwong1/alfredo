import { create } from "zustand";
import type { AgentQuestion, AgentState } from "../types";

interface SessionStatusState {
  /** Per-session agent state, keyed by sessionKey (tab.id). */
  statuses: Record<string, AgentState>;
  /** Per-session open question, keyed by sessionKey. Memory only. */
  questions: Record<string, AgentQuestion>;
  setSessionStatus: (sessionKey: string, state: AgentState) => void;
  clearSessionStatus: (sessionKey: string) => void;
  setSessionQuestion: (sessionKey: string, question: AgentQuestion) => void;
  clearSessionQuestion: (sessionKey: string) => void;
}

export const useSessionStatusStore = create<SessionStatusState>((set) => ({
  statuses: {},
  questions: {},
  setSessionStatus: (sessionKey, state) =>
    set((s) =>
      s.statuses[sessionKey] === state
        ? s
        : { statuses: { ...s.statuses, [sessionKey]: state } },
    ),
  clearSessionStatus: (sessionKey) =>
    set((s) => {
      const hasStatus = sessionKey in s.statuses;
      const hasQuestion = sessionKey in s.questions;
      if (!hasStatus && !hasQuestion) return s;
      const { [sessionKey]: _status, ...statuses } = s.statuses;
      const { [sessionKey]: _question, ...questions } = s.questions;
      return { statuses, questions };
    }),
  setSessionQuestion: (sessionKey, question) =>
    set((s) => {
      const prev = s.questions[sessionKey];
      return prev && prev.text === question.text && prev.header === question.header
        ? s
        : { questions: { ...s.questions, [sessionKey]: question } };
    }),
  clearSessionQuestion: (sessionKey) =>
    set((s) => {
      if (!(sessionKey in s.questions)) return s;
      const { [sessionKey]: _, ...rest } = s.questions;
      return { questions: rest };
    }),
}));

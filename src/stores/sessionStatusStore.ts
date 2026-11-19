import { create } from "zustand";
import type { AgentQuestion, AgentState, WorkedFrom } from "../types";
import { endAgentWork, type SessionLinks } from "../services/orchestrations";
import { rekeyRecord } from "./rekeyWorktreeId";

interface SessionStatusState {
  /** Per-session agent state, keyed by sessionKey (tab.id). */
  statuses: Record<string, AgentState>;
  /** Per-session open question, keyed by sessionKey. Memory only. */
  questions: Record<string, AgentQuestion>;
  /** Per-session links to other worktrees, keyed by sessionKey. Memory only. */
  links: Record<string, SessionLinks>;
  /** Work by sessions Alfredo did not start, keyed by worktree id. Memory only. */
  external: Record<string, WorkedFrom>;
  setSessionStatus: (sessionKey: string, state: AgentState) => void;
  clearSessionStatus: (sessionKey: string) => void;
  setSessionQuestion: (sessionKey: string, question: AgentQuestion) => void;
  clearSessionQuestion: (sessionKey: string) => void;
  setSessionLinks: (sessionKey: string, links: SessionLinks) => void;
  /** Replace the external work. A record equal to the stored one changes nothing. */
  setExternalWork: (next: Record<string, WorkedFrom>) => void;
  /** Move a worktree's links and external work to its new id after a branch
   *  checkout re-ids it, and rename it in the external work it is the source
   *  of. Changes nothing when nothing names `oldId`. */
  rekeyWorktree: (oldId: string, newId: string) => void;
}

export const useSessionStatusStore = create<SessionStatusState>((set) => ({
  statuses: {},
  questions: {},
  links: {},
  external: {},
  setSessionStatus: (sessionKey, state) =>
    set((s) => {
      // A session that stops has no sub-agent at work: this heals a lost SubagentStop.
      const prevLinks = s.links[sessionKey];
      const nextLinks =
        prevLinks && (state === "idle" || state === "notRunning") ? endAgentWork(prevLinks) : prevLinks;
      if (s.statuses[sessionKey] === state && nextLinks === prevLinks) return s;
      return {
        statuses: s.statuses[sessionKey] === state ? s.statuses : { ...s.statuses, [sessionKey]: state },
        links: nextLinks === prevLinks ? s.links : { ...s.links, [sessionKey]: nextLinks },
      };
    }),
  clearSessionStatus: (sessionKey) =>
    set((s) => {
      const hasStatus = sessionKey in s.statuses;
      const hasQuestion = sessionKey in s.questions;
      const hasLinks = sessionKey in s.links;
      if (!hasStatus && !hasQuestion && !hasLinks) return s;
      const { [sessionKey]: _status, ...statuses } = s.statuses;
      const { [sessionKey]: _question, ...questions } = s.questions;
      const { [sessionKey]: _links, ...links } = s.links;
      return { statuses, questions, links };
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
  setSessionLinks: (sessionKey, links) =>
    set((s) => (s.links[sessionKey] === links ? s : { links: { ...s.links, [sessionKey]: links } })),
  setExternalWork: (next) =>
    set((s) => {
      const ids = Object.keys(next);
      const same =
        ids.length === Object.keys(s.external).length &&
        ids.every((id) => {
          const prev = s.external[id];
          return prev !== undefined && prev.worktreeId === next[id].worktreeId && prev.running === next[id].running;
        });
      return same ? s : { external: next };
    }),
  rekeyWorktree: (oldId, newId) =>
    set((s) => {
      let links = s.links;
      for (const [sessionKey, sessionLinks] of Object.entries(s.links)) {
        const moved = rekeyRecord(sessionLinks, oldId, newId);
        if (moved === sessionLinks) continue;
        if (links === s.links) links = { ...s.links };
        links[sessionKey] = moved;
      }
      let external = rekeyRecord(s.external, oldId, newId);
      // An entry also names the worktree it is worked from: that id moves too,
      // or the worktree leaves its orchestration until the next session list.
      for (const [id, entry] of Object.entries(external)) {
        if (entry.worktreeId !== oldId) continue;
        if (external === s.external) external = { ...s.external };
        external[id] = { ...entry, worktreeId: newId };
      }
      return links === s.links && external === s.external ? s : { links, external };
    }),
}));

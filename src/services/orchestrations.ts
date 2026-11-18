import type { OrchestrationRule, Worktree } from "../types";
import { worktreeEffectiveStatus, worktreeNeedsYou } from "./dockBadge";

export interface OrchestrationItem {
  worktreeId: string;
  title: string;
}

export interface Orchestration {
  repoPath: string;
  name: string;
  items: OrchestrationItem[];
}

export type YourTurnKind = "answer" | "check";

export interface YourTurnRow {
  worktreeId: string;
  kind: YourTurnKind;
  text: string;
  fullText: string;
  orchestrationName: string;
  itemTitle: string;
  since: number;
}

/** In memory only; never persisted. */
export interface NeedsYouSince {
  kind: YourTurnKind;
  at: number;
}

export function orchestrationsFromRules(
  repoPath: string,
  rules: OrchestrationRule[],
  worktrees: Worktree[],
): Orchestration[] {
  const ofRepo = worktrees.filter((wt) => wt.repoPath === repoPath);
  return rules
    .filter((rule) => rule.name !== "" && rule.branchPrefix !== "")
    .map((rule) => {
      const items = ofRepo
        .filter((wt) => wt.branch.startsWith(rule.branchPrefix))
        .sort((a, b) => {
          const an = a.prStatus?.number;
          const bn = b.prStatus?.number;
          if (an !== undefined && bn !== undefined) return an - bn;
          if (an !== undefined) return -1;
          if (bn !== undefined) return 1;
          return a.branch < b.branch ? -1 : a.branch > b.branch ? 1 : 0;
        })
        .map((wt) => ({
          worktreeId: wt.id,
          title: wt.branch.slice(rule.branchPrefix.length) || wt.branch,
        }));
      return { repoPath, name: rule.name, items };
    });
}

function kindOf(status: string): YourTurnKind {
  return status === "waitingForInput" ? "answer" : "check";
}

function textFor(wt: Worktree, status: string): string {
  switch (status) {
    case "waitingForInput":
      return wt.question?.text || "Waiting for input";
    case "error":
      return "Error";
    case "ready":
      return "Ready to start";
    default:
      return "Finished";
  }
}

export function yourTurnRows(
  orchestrations: Orchestration[],
  worktrees: Worktree[],
  seen: Set<string>,
  unread: Set<string>,
  since: Record<string, NeedsYouSince>,
): YourTurnRow[] {
  const byId = new Map(worktrees.map((wt) => [wt.id, wt]));
  const claimed = new Set<string>();
  const rows: YourTurnRow[] = [];
  for (const orchestration of orchestrations) {
    for (const item of orchestration.items) {
      if (claimed.has(item.worktreeId)) continue;
      const wt = byId.get(item.worktreeId);
      if (!wt || !worktreeNeedsYou(wt, seen, unread)) continue;
      claimed.add(item.worktreeId);
      const status = worktreeEffectiveStatus(wt, seen, unread);
      const text = textFor(wt, status);
      rows.push({
        worktreeId: wt.id,
        kind: kindOf(status),
        text,
        fullText: text,
        orchestrationName: orchestration.name,
        itemTitle: item.title,
        // A worktree not yet tracked sorts last; as an age it reads "now".
        since: since[wt.id]?.at ?? Number.POSITIVE_INFINITY,
      });
    }
  }
  return rows.sort((a, b) => a.since - b.since);
}

export function nextNeedsYouSince(
  prev: Record<string, NeedsYouSince>,
  worktrees: Worktree[],
  seen: Set<string>,
  unread: Set<string>,
  now: number,
): Record<string, NeedsYouSince> {
  const next: Record<string, NeedsYouSince> = {};
  let changed = false;
  for (const wt of worktrees) {
    if (!worktreeNeedsYou(wt, seen, unread)) continue;
    const kind = kindOf(worktreeEffectiveStatus(wt, seen, unread));
    const existing = prev[wt.id];
    if (existing?.kind === kind) {
      next[wt.id] = existing;
      continue;
    }
    // answer -> check keeps the age; check -> answer (or a new entry) restarts it.
    next[wt.id] = { kind, at: existing && kind === "check" ? existing.at : now };
    changed = true;
  }
  if (!changed && Object.keys(prev).length === Object.keys(next).length) return prev;
  return next;
}

export function formatWaitingAge(since: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - since) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 120) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

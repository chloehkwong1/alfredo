import type { HookActivity, HookPhase, OrchestrationRule, Worktree, WorkedFrom } from "../types";
import { worktreeDisplayLabel } from "../lib/worktreeDisplayLabel";
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

/** Trim name and prefix; rows missing either are dropped, not saved half-filled. */
export function cleanOrchestrationRules(rules: OrchestrationRule[]): OrchestrationRule[] {
  return rules
    .map((rule) => ({ name: rule.name.trim(), branchPrefix: rule.branchPrefix.trim() }))
    .filter((rule) => rule.name !== "" && rule.branchPrefix !== "");
}

/** Worktrees of the repo (archived included) under the trimmed prefix; 0 for an empty prefix. */
export function countRuleMatches(repoPath: string, branchPrefix: string, worktrees: Worktree[]): number {
  const prefix = branchPrefix.trim();
  if (prefix === "") return 0;
  return worktrees.filter((wt) => wt.repoPath === repoPath && wt.branch.startsWith(prefix)).length;
}

/** Item order inside an orchestration: PR number ascending, then worktrees with no PR by branch. */
function byPrNumberThenBranch(a: Worktree, b: Worktree): number {
  const an = a.prStatus?.number;
  const bn = b.prStatus?.number;
  if (an !== undefined && bn !== undefined) return an - bn;
  if (an !== undefined) return -1;
  if (bn !== undefined) return 1;
  return a.branch < b.branch ? -1 : a.branch > b.branch ? 1 : 0;
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
        .sort(byPrNumberThenBranch)
        .map((wt) => ({
          worktreeId: wt.id,
          title: wt.branch.slice(rule.branchPrefix.length) || wt.branch,
        }));
      return { repoPath, name: rule.name, items };
    });
}

/** One orchestration per `orchestration` name in the repo's worktree notes
 *  (archived included), in the order the names first appear among the sorted
 *  worktrees. Needs no rule. */
export function orchestrationsFromNotes(repoPath: string, worktrees: Worktree[]): Orchestration[] {
  const itemsByName = new Map<string, OrchestrationItem[]>();
  const ofRepo = worktrees.filter((wt) => wt.repoPath === repoPath).sort(byPrNumberThenBranch);
  for (const wt of ofRepo) {
    const note = wt.note;
    if (!note?.orchestration) continue;
    const item = { worktreeId: wt.id, title: note.label ?? wt.branch };
    const items = itemsByName.get(note.orchestration);
    if (items) items.push(item);
    else itemsByName.set(note.orchestration, [item]);
  }
  return [...itemsByName].map(([name, items]) => ({ repoPath, name, items }));
}

/** Note orchestrations first, then rule orchestrations. A rule orchestration
 *  with the repo and name of a note orchestration joins it: its worktrees are
 *  added after the note's own, except those a note in that repo already puts
 *  in an orchestration. A noted worktree stays in its note's orchestration. */
export function mergeOrchestrations(
  fromNotes: Orchestration[],
  fromRules: Orchestration[],
): Orchestration[] {
  const isSame = (a: Orchestration, b: Orchestration) =>
    a.repoPath === b.repoPath && a.name === b.name;
  const merged = fromNotes.map((note) => {
    const items = [...note.items];
    const taken = new Set(
      fromNotes
        .filter((other) => other.repoPath === note.repoPath)
        .flatMap((other) => other.items.map((item) => item.worktreeId)),
    );
    for (const rule of fromRules) {
      if (!isSame(note, rule)) continue;
      for (const item of rule.items) {
        if (taken.has(item.worktreeId)) continue;
        taken.add(item.worktreeId);
        items.push(item);
      }
    }
    return { ...note, items };
  });
  return [...merged, ...fromRules.filter((rule) => !fromNotes.some((note) => isSame(note, rule)))];
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

/** One session's work in one other worktree. `agentIds`: its sub-agents working there now. */
export interface WorktreeLink {
  agentIds: string[];
  mainIn: boolean;
}

/** One session's links, keyed by the id of the worktree it works in. */
export type SessionLinks = Record<string, WorktreeLink>;

export interface LinkSource {
  worktreeId: string;
  active: boolean;
  links: SessionLinks;
}

/** The worktree whose path contains `path`: the longest match wins, and the
 *  session's own worktree wins a tie. */
export function worktreeForPath(
  path: string,
  worktrees: Pick<Worktree, "id" | "path">[],
  ownWorktreeId: string,
): string | undefined {
  let best: Pick<Worktree, "id" | "path"> | undefined;
  for (const wt of worktrees) {
    if (path !== wt.path && !path.startsWith(wt.path + "/")) continue;
    if (!best || wt.path.length > best.path.length) best = wt;
    else if (wt.path.length === best.path.length && wt.id === ownWorktreeId) best = wt;
  }
  return best?.id;
}

/** Fold one hook's activity into a session's links. Returns `prev` itself when
 *  nothing changes. A link is never deleted. */
export function applyActivityToLinks(
  prev: SessionLinks,
  ownWorktreeId: string,
  activity: HookActivity | undefined,
  phase: HookPhase,
  worktrees: Pick<Worktree, "id" | "path">[],
): SessionLinks {
  if (!activity) return prev;
  const { cwd, writePath, agentId } = activity;
  const cwdId = cwd === undefined ? undefined : worktreeForPath(cwd, worktrees, ownWorktreeId);
  const writeId = writePath === undefined ? undefined : worktreeForPath(writePath, worktrees, ownWorktreeId);
  const next: SessionLinks = { ...prev };
  let changed = false;

  if (agentId !== undefined && phase === "subagentEnd") {
    for (const [id, link] of Object.entries(prev)) {
      if (!link.agentIds.includes(agentId)) continue;
      next[id] = { ...link, agentIds: link.agentIds.filter((a) => a !== agentId) };
      changed = true;
    }
  } else if (agentId !== undefined) {
    for (const id of new Set([cwdId, writeId])) {
      if (id === undefined || id === ownWorktreeId) continue;
      const link = prev[id];
      if (link?.agentIds.includes(agentId)) continue;
      next[id] = { agentIds: [...(link?.agentIds ?? []), agentId], mainIn: link?.mainIn ?? false };
      changed = true;
    }
  } else {
    if (cwd !== undefined) {
      const target = cwdId === ownWorktreeId ? undefined : cwdId;
      if (target !== undefined && !prev[target]) {
        next[target] = { agentIds: [], mainIn: true };
        changed = true;
      }
      for (const [id, link] of Object.entries(prev)) {
        const mainIn = id === target;
        if (link.mainIn === mainIn) continue;
        next[id] = { ...link, mainIn };
        changed = true;
      }
    }
    if (writeId !== undefined && writeId !== ownWorktreeId && !next[writeId]) {
      next[writeId] = { agentIds: [], mainIn: false };
      changed = true;
    }
  }
  return changed ? next : prev;
}

/** Every session's sub-agents have stopped working: empty each `agentIds`, keep `mainIn`. */
export function endAgentWork(prev: SessionLinks): SessionLinks {
  if (Object.values(prev).every((link) => link.agentIds.length === 0)) return prev;
  const next: SessionLinks = {};
  for (const [id, link] of Object.entries(prev)) {
    next[id] = link.agentIds.length === 0 ? link : { ...link, agentIds: [] };
  }
  return next;
}

/** Which session works in each worktree. A running link wins, then running
 *  external work, then a link that is not running. */
export function workedFromByWorktree(
  sources: LinkSource[],
  external: Record<string, WorkedFrom>,
): Record<string, WorkedFrom> {
  const running: Record<string, WorkedFrom> = {};
  const quiet: Record<string, WorkedFrom> = {};
  for (const source of sources) {
    for (const [id, link] of Object.entries(source.links)) {
      const isRunning = source.active && (link.agentIds.length > 0 || link.mainIn);
      const into = isRunning ? running : quiet;
      into[id] ??= { worktreeId: source.worktreeId, running: isRunning };
    }
  }
  const result: Record<string, WorkedFrom> = { ...quiet };
  for (const [id, entry] of Object.entries(external)) {
    if (entry.running) result[id] = entry;
  }
  return Object.assign(result, running);
}

/** One orchestration per worktree of the repo that another worktree of the
 *  repo is worked from: the head first as `orchestrator`, then the worktrees
 *  worked from it. Ordered by head branch. */
export function orchestrationsFromLinks(
  repoPath: string,
  worktrees: Worktree[],
  labels: Record<string, string>,
): Orchestration[] {
  const ofRepo = worktrees.filter((wt) => wt.repoPath === repoPath);
  const heads = ofRepo
    .filter((head) => ofRepo.some((wt) => wt !== head && wt.workedFrom?.worktreeId === head.id))
    .sort((a, b) => (a.branch < b.branch ? -1 : a.branch > b.branch ? 1 : 0));
  return heads.map((head) => {
    const linked = ofRepo
      .filter((wt) => wt !== head && wt.workedFrom?.worktreeId === head.id)
      .sort(byPrNumberThenBranch)
      .map((wt) => ({ worktreeId: wt.id, title: worktreeDisplayLabel(wt, labels[wt.path]) }));
    return {
      repoPath,
      name: worktreeDisplayLabel(head, labels[head.path]),
      items: [{ worktreeId: head.id, title: "orchestrator" }, ...linked],
    };
  });
}

import { useTabStore } from "../stores/tabStore";
import { useSessionStatusStore } from "../stores/sessionStatusStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { isAgentTab } from "../types";
import type { AgentState, WorkedFrom } from "../types";
import { workedFromByWorktree, type LinkSource } from "./orchestrations";

// Single writer for `workspaceStore.worktrees[].agentStatus` and `.workedFrom`.
//
// Every PTY session writes its own state to `sessionStatusStore[sessionKey]`.
// This mirror watches tab+status stores, aggregates the states of ALL agent
// tabs per worktree by priority, and projects the winner onto the worktree.
// Phantom / stale sessions mutate their own unread sessionKey slot and are
// invisible here.
//
// `workedFrom` is projected the same way from each session's links: it says
// which other session works in the worktree, and never changes `agentStatus`.
//
// Removing direct `updateWorktree({ agentStatus })` calls elsewhere is what
// kills the two-writer race that caused "stuck idle" and "busy-but-idle"
// display bugs.

const PRIORITY: Record<AgentState, number> = {
  waitingForInput: 4,
  busy: 3,
  idle: 2,
  notRunning: 1,
};

let started = false;

export function startStatusMirror(): void {
  if (started) return;
  started = true;

  const sync = () => {
    const { tabs } = useTabStore.getState();
    const { statuses, questions, links, external } = useSessionStatusStore.getState();
    const { worktrees, updateWorktree } = useWorkspaceStore.getState();

    let workedFrom: Record<string, WorkedFrom> | undefined;
    if (
      Object.keys(links).length > 0 ||
      Object.keys(external).length > 0 ||
      worktrees.some((wt) => wt.workedFrom)
    ) {
      const sources: LinkSource[] = [];
      for (const [worktreeId, worktreeTabs] of Object.entries(tabs)) {
        for (const tab of worktreeTabs) {
          const tabLinks = isAgentTab(tab) ? links[tab.id] : undefined;
          if (!tabLinks) continue;
          const state = statuses[tab.id];
          sources.push({ worktreeId, active: state === "busy" || state === "waitingForInput", links: tabLinks });
        }
      }
      workedFrom = workedFromByWorktree(sources, external);
    }

    for (const wt of worktrees) {
      const agentTabs = (tabs[wt.id] ?? []).filter(isAgentTab);
      let projected: AgentState = "notRunning";
      const question = agentTabs.find((tab) => statuses[tab.id] === "waitingForInput" && questions[tab.id])
        ?.id;
      const projectedQuestion = question ? questions[question] : undefined;
      for (const tab of agentTabs) {
        const state = statuses[tab.id];
        if (!state) continue;
        if (PRIORITY[state] > PRIORITY[projected]) {
          projected = state;
        }
      }
      const questionChanged =
        wt.question?.text !== projectedQuestion?.text || wt.question?.header !== projectedQuestion?.header;
      // Compared by value: `workedFromByWorktree` builds fresh objects on every call.
      const projectedWorkedFrom = workedFrom?.[wt.id];
      const workedFromChanged =
        wt.workedFrom?.worktreeId !== projectedWorkedFrom?.worktreeId ||
        wt.workedFrom?.running !== projectedWorkedFrom?.running;
      if (wt.agentStatus !== projected || questionChanged || workedFromChanged) {
        updateWorktree(wt.id, {
          agentStatus: projected,
          question: projectedQuestion,
          ...(workedFromChanged && { workedFrom: projectedWorkedFrom }),
        });
        // That write ran `sync` again on the new worktrees (the mirror
        // subscribes to the workspace store), so every worktree is current by
        // now. This run's list is stale: going on would write the rest twice.
        return;
      }
    }
  };

  useTabStore.subscribe(sync);
  useSessionStatusStore.subscribe(sync);
  useWorkspaceStore.subscribe(sync);
  sync();
}

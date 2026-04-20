import { useTabStore } from "../stores/tabStore";
import { useSessionStatusStore } from "../stores/sessionStatusStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { isAgentTab } from "../types";
import type { AgentState } from "../types";

// Single writer for `workspaceStore.worktrees[].agentStatus`.
//
// Every PTY session writes its own state to `sessionStatusStore[sessionKey]`.
// This mirror watches tab+status stores, aggregates the states of ALL agent
// tabs per worktree by priority, and projects the winner onto the worktree.
// Phantom / stale sessions mutate their own unread sessionKey slot and are
// invisible here.
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
    const { statuses } = useSessionStatusStore.getState();
    const { worktrees, updateWorktree } = useWorkspaceStore.getState();

    for (const wt of worktrees) {
      const agentTabs = (tabs[wt.id] ?? []).filter(isAgentTab);
      let projected: AgentState = "notRunning";
      for (const tab of agentTabs) {
        const state = statuses[tab.id];
        if (!state) continue;
        if (PRIORITY[state] > PRIORITY[projected]) {
          projected = state;
        }
      }
      if (wt.agentStatus !== projected) {
        updateWorktree(wt.id, { agentStatus: projected });
      }
    }
  };

  useTabStore.subscribe(sync);
  useSessionStatusStore.subscribe(sync);
  useWorkspaceStore.subscribe(sync);
  sync();
}

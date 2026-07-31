import { releasePortFor, listSessions, closePty } from "../api";
import { sessionManager } from "./sessionManager";
import { useTabStore } from "../stores/tabStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import type { Session } from "../types";

/**
 * Kill a worktree's dev-server PTY and clear the state that tracks it.
 *
 * `stopSession` rather than `closeSession`: the tab and its scrollback survive,
 * so the logs stay readable and Start can re-run in place.
 *
 * Note this resolves once SIGTERM has been *sent*, not once the process has
 * exited — `PtyManager::close` escalates to SIGKILL and reaps on a detached
 * thread (src-tauri/src/pty_manager.rs:883-887). Callers must not treat it as
 * proof the OS port is free.
 */
export async function stopDevServer(worktreeId: string, tabId: string): Promise<void> {
  await sessionManager.stopSession(tabId);
  useTabStore.getState().updateTab(worktreeId, tabId, { command: undefined });
  // Only disown the entry if it still points at the tab we stopped — a
  // concurrent Start can register a new server during the await above. Same
  // guard as reconcileServerFromSession (src/hooks/useServer.ts:93).
  const current = useWorkspaceStore.getState().runningServers[worktreeId];
  if (!current || current.tabId === tabId) {
    useWorkspaceStore.getState().setRunningServer(worktreeId, null);
  }
}

/**
 * Hand back everything a finished worktree is holding: kill its dev-server PTY,
 * then drop its port assignment.
 *
 * Releasing the assignment on its own only frees Alfredo's bookkeeping — the
 * server process keeps the OS port bound, so the next worktree handed that port
 * fails to bind.
 *
 * The set of servers to stop comes from Rust, not from the `runningServers`
 * store map. That map is best-effort: the stale-server sweep clears entries
 * without confirming the process died (src/hooks/useServer.ts:124-134), so
 * trusting it can skip a live server and free a port that is still bound.
 *
 * If anything fails to stop, the assignment is deliberately KEPT. Releasing it
 * would strand a bound port with no way back — the picker builds its held slots
 * purely from the assignments map (src/components/terminal/StartServerControl.tsx),
 * so a released port renders as free and can never be reclaimed from the UI.
 *
 * A worktree in Done can still be reopened and its server restarted; the normal
 * Start path claims a fresh port because the assignment is gone.
 */
export async function stopServerAndReleasePort(
  wt: { repoPath: string; id: string },
  context: string,
): Promise<void> {
  // Snapshot up front. Taking it before any await also bounds what we may kill:
  // a server the user starts while we're stopping must not be swept.
  let targets: Session[];
  try {
    targets = (await listSessions()).filter(
      (s) => s.worktreeId === wt.id && s.sessionType === "server" && s.status === "running",
    );
  } catch (e) {
    console.warn(`[${context}] Could not list sessions — keeping port assignment:`, wt.id, e);
    return;
  }

  let stoppedCleanly = true;

  // The tracked server goes through stopDevServer so the tab and ManagedSession
  // state are reset too; getSession gives the Rust id it owns, so the sweep
  // below doesn't try to close it twice.
  const running = useWorkspaceStore.getState().runningServers[wt.id];
  const trackedSessionId = running
    ? sessionManager.getSession(running.tabId)?.sessionId
    : undefined;
  if (running) {
    try {
      await stopDevServer(wt.id, running.tabId);
    } catch (e) {
      stoppedCleanly = false;
      console.warn(`[${context}] Failed to stop dev server:`, wt.id, e);
    }
  }

  // Anything left in the snapshot is a live PTY the store had lost track of.
  for (const srv of targets) {
    if (trackedSessionId && srv.id === trackedSessionId) continue;
    try {
      await closePty(srv.id);
    } catch (e) {
      stoppedCleanly = false;
      console.warn(`[${context}] Failed to close orphaned server session ${srv.id}:`, wt.id, e);
    }
  }

  if (!stoppedCleanly) {
    console.warn(
      `[${context}] Keeping port assignment — a dev server did not stop cleanly:`,
      wt.id,
    );
    return;
  }

  // A Start that landed while we were tearing down owns the assignment now
  // (handleToggleServer claims the port before registering the entry), so
  // releasing here would delete a port the new server is already bound to.
  const afterRunning = useWorkspaceStore.getState().runningServers[wt.id];
  if (afterRunning && afterRunning.tabId !== running?.tabId) {
    console.warn(
      `[${context}] Skipping port release — a dev server started during teardown:`,
      wt.id,
    );
    return;
  }

  await releasePortFor(wt).catch((e) =>
    console.warn(`[${context}] Failed to release port:`, wt.id, e),
  );
}

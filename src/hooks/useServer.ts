import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useAppConfigStore } from "../stores/appConfigStore";
import { useTabStore } from "../stores/tabStore";

/**
 * Per-worktree mutex to prevent overlapping revive attempts. Cleanup intervals
 * fire every 3 s and each awaits listSessions + reattach, so without this guard
 * two ticks could both revive the same worktree and thrash the store.
 */
const revivingServers = new Set<string>();
import { getConfig, listSessions, claimWorktreePort, listWorktrees } from "../api";
import { usePortPickerStore } from "../stores/portPickerStore";
import { sessionManager } from "../services/sessionManager";
import { stopDevServer } from "../services/portReclaim";
import { lifecycleManager } from "../services/lifecycleManager";
import type { RunScript, Session } from "../types";

/** Extract port number from a URL string (e.g. "http://localhost:3000" → 3000). */
function extractPort(url: string): number | undefined {
  try {
    const parsed = new URL(url);
    return parsed.port ? Number(parsed.port) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Detect port from terminal output. Matches common dev server patterns:
 * - "localhost:3000", "127.0.0.1:8080", "0.0.0.0:5173"
 * - "port 3000", "Port 8081", "PORT: 3000"
 * - "http://localhost:3000"
 * Returns the last match (most likely the actual listening port).
 */
function detectPortFromOutput(text: string): number | undefined {
  const patterns = [
    /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/gi,
    /\bport\s*[:=]?\s*(\d{2,5})/gi,
  ];
  let lastPort: number | undefined;
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const p = Number(m[1]);
      if (p >= 80 && p <= 65535) lastPort = p;
    }
  }
  return lastPort;
}

const SERVER_GRACE_PERIOD_MS = 5_000;
const SERVER_HEARTBEAT_STALE_MS = 10_000;
const SERVER_POLL_INTERVAL_MS = 3_000;

type SetRunningServer = (wtId: string, entry: {
  sessionId: string;
  tabId: string;
  port?: number;
  createdAt?: number;
} | null) => void;

/**
 * Reattach to a surviving Rust-side PTY for a server session and re-populate
 * the store entry. Reuses an existing tab when provided (cleanup path) and
 * creates a fresh one otherwise (mount-time reconciliation path).
 */
async function reconcileServerFromSession(
  srv: Session,
  setRunningServer: SetRunningServer,
  existingTabId?: string,
): Promise<boolean> {
  const wtId = srv.worktreeId;
  const tabId = existingTabId ?? lifecycleManager.addTab(wtId, "server");
  if (!tabId) return false;

  try {
    await sessionManager.reattachToSession(tabId, srv.id, wtId);
  } catch (err) {
    console.error(`[server-reconcile] reattach failed for ${srv.id}:`, err);
    if (!existingTabId) {
      try {
        await lifecycleManager.removeTab(wtId, tabId);
      } catch (cleanupErr) {
        console.error(`[server-reconcile] failed to clean up orphaned tab:`, cleanupErr);
      }
    }
    return false;
  }

  // Revive path only: if the user cleared the entry (hit Stop) while we were
  // awaiting listSessions/reattach, honor their intent — don't resurrect it.
  // Tear down the orphaned reattached session so it doesn't linger.
  if (existingTabId && !useWorkspaceStore.getState().runningServers[wtId]) {
    console.log(`[server-reconcile] skip revive for ${wtId} — entry was cleared during await`);
    try {
      await sessionManager.closeSession(tabId);
    } catch (e) {
      console.warn(`[server-reconcile] failed to close orphaned session:`, e);
    }
    return false;
  }

  setRunningServer(wtId, {
    sessionId: srv.id,
    tabId,
    createdAt: Date.now(),
  });
  console.log(`[server-reconcile] reattached server for worktree ${wtId}`);
  return true;
}

/**
 * Before clearing a stale entry, ask Rust if the server session is still
 * alive. If it is, reattach and keep the badge on; only clear when Rust
 * confirms the process is gone. Returns true when the entry was revived.
 */
async function tryReviveBeforeClear(
  wtId: string,
  existingTabId: string,
  setRunningServer: SetRunningServer,
): Promise<boolean> {
  if (revivingServers.has(wtId)) return false;

  // Guard: if the tab UI is gone from tabStore, reviving would re-register
  // a ManagedSession under a tabId with no tab row — orphaned state that
  // nothing reads. Let the clear proceed so the real process (if any) can
  // be rediscovered by normal reconciliation on next mount.
  const tabExists = (useTabStore.getState().tabs[wtId] ?? []).some(
    (t) => t.id === existingTabId,
  );
  if (!tabExists) {
    console.log(`[server-reconcile] skip revive for ${wtId} — tab ${existingTabId} missing from tabStore`);
    return false;
  }

  revivingServers.add(wtId);
  try {
    console.log(`[server-reconcile] attempting revive for ${wtId} (tab ${existingTabId})`);
    const sessions = await listSessions();
    const srv = sessions.find(
      (s) => s.sessionType === "server" && s.status === "running" && s.worktreeId === wtId,
    );
    if (!srv) {
      console.log(`[server-reconcile] revive skipped for ${wtId} — Rust confirmed no running server session`);
      return false;
    }
    return await reconcileServerFromSession(srv, setRunningServer, existingTabId);
  } catch (err) {
    console.error("[server-reconcile] listSessions failed during revive:", err);
    return false;
  } finally {
    revivingServers.delete(wtId);
  }
}

/**
 * Polls heartbeats for ALL running servers (not just the active worktree).
 * Cleans up stale entries when a server process dies while its worktree is inactive.
 * Should be called once at the app level.
 */
export function useStaleServerCleanup() {
  const hasRunningServers = useWorkspaceStore(
    (s) => Object.keys(s.runningServers).length > 0,
  );
  const setRunningServer = useWorkspaceStore((s) => s.setRunningServer);

  useEffect(() => {
    if (!hasRunningServers) return;

    const interval = setInterval(async () => {
      const now = Date.now();
      for (const [wtId, server] of Object.entries(
        useWorkspaceStore.getState().runningServers,
      )) {
        // Skip servers still within the grace period (session may not be registered yet)
        if (server.createdAt && now - server.createdAt < SERVER_GRACE_PERIOD_MS) continue;

        const session = sessionManager.getSession(server.tabId);
        const shouldClear =
          !session ||
          (session.lastHeartbeat > 0 && now - session.lastHeartbeat > SERVER_HEARTBEAT_STALE_MS);
        if (!shouldClear) continue;

        const revived = await tryReviveBeforeClear(wtId, server.tabId, setRunningServer);
        if (!revived) setRunningServer(wtId, null);
      }
    }, SERVER_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [hasRunningServers, setRunningServer]);
}

/**
 * On mount, queries the Rust backend for running server sessions.
 * If any are found that aren't tracked in the store, reattaches and
 * re-creates the tab + store entries.
 *
 * Call once at the app level (e.g. alongside useStaleServerCleanup).
 */
export function useServerReconciliation() {
  const setRunningServer = useWorkspaceStore((s) => s.setRunningServer);
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;
    let cancelled = false;

    async function reconcile() {
      let sessions: Session[];
      try {
        sessions = await listSessions();
      } catch (err) {
        console.error("[server-reconcile] failed to list sessions:", err);
        return;
      }
      if (cancelled) return;

      const serverSessions = sessions.filter(
        (s) => s.sessionType === "server" && s.status === "running",
      );

      if (serverSessions.length === 0) return;

      const store = useWorkspaceStore.getState();

      for (const srv of serverSessions) {
        if (store.runningServers[srv.worktreeId]) continue;
        await reconcileServerFromSession(srv, setRunningServer);
        if (cancelled) return;
      }
    }

    reconcile();
    return () => { cancelled = true; };
  }, [setRunningServer]);
}

/**
 * Manages the dev server lifecycle: loading run script config,
 * toggling the server on/off, and detecting process exit via heartbeat.
 */
export function useServer(activeWorktreeId: string | null) {
  const runningServer = useWorkspaceStore((s) =>
    activeWorktreeId ? s.runningServers[activeWorktreeId] ?? null : null,
  );
  const setRunningServer = useWorkspaceStore((s) => s.setRunningServer);
  const [runScript, setRunScript] = useState<RunScript | null>(null);

  // Derive repo path from the active worktree so we load the correct repo's config
  const worktreeRepoPath = useWorkspaceStore((s) =>
    s.worktrees.find((wt) => wt.id === activeWorktreeId)?.repoPath ?? null,
  );

  // Load run script config (and refresh when settings are saved).
  // We subscribe to the shared app-config store rather than the legacy
  // `config-changed` window event: when any save dispatches the event, the
  // App-root listener calls `refetch()` and the store publishes a new
  // snapshot — every store subscriber wakes up exactly once. This avoids
  // each useServer instance making its own redundant config IPC.
  const [configVersion, setConfigVersion] = useState(0);
  useEffect(() => {
    const unsubscribe = useAppConfigStore.subscribe((s, prev) => {
      if (s.config !== prev.config) setConfigVersion((v) => v + 1);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!worktreeRepoPath) return;
    getConfig(worktreeRepoPath).then((config) => {
      setRunScript(config.runScript ?? null);
    }).catch((err) => console.error("Failed to load run script config:", err));
  }, [worktreeRepoPath, configVersion]);

  const isServerRunningHere = runningServer !== null;

  const handleToggleServer = useCallback(async () => {
    if (!activeWorktreeId || !runScript || !worktreeRepoPath) return;

    const wt = useWorkspaceStore.getState().worktrees.find((w) => w.id === activeWorktreeId);
    if (!wt) return;

    try {
      if (isServerRunningHere) {
        await stopDevServer(activeWorktreeId, runningServer!.tabId);
        return;
      }

      // An empty/whitespace run command would spawn a bare shell with no server
      // (the resolve-args path falls back to []), leaving a dead tab. Don't start.
      const runCommand = runScript.command.replace(/\s+/g, " ").trim();
      if (!runCommand) {
        console.warn("[handleToggleServer] run command is empty — not starting server");
        return;
      }

      // Port claim happens here, on the explicit Start-server path, rather than
      // eagerly at session spawn — opening a worktree must never trigger the
      // picker. If a port is already persisted we skip; if the range is full
      // we ask the active pane's split-button to open its picker and await
      // the user's choice. Cancel aborts the start.
      const repoConfig = await getConfig(worktreeRepoPath);
      if (repoConfig.autoAssignPorts && wt.assignedPort == null) {
        const result = await claimWorktreePort(worktreeRepoPath, activeWorktreeId);
        if (result.kind === "rangeFull") {
          try {
            await usePortPickerStore.getState().openForStart({
              repoPath: worktreeRepoPath,
              worktreeId: activeWorktreeId,
            });
          } catch (e) {
            // openForStart rejects on user cancel and on supersede; both mean
            // "abort this start". Logged so a future unexpected throw doesn't
            // masquerade as a quiet cancel.
            console.log("[handleToggleServer] port-picker aborted:", e);
            return;
          }
        }
        // Refresh worktrees so the sidebar's port chip shows the new
        // assignment immediately. Silent on failure — sessionManager reads
        // the port directly from the backend on spawn either way.
        try {
          const fresh = await listWorktrees(worktreeRepoPath);
          useWorkspaceStore.getState().setWorktreesForRepo(worktreeRepoPath, fresh);
        } catch (e) {
          console.warn("[handleToggleServer] post-claim refresh failed", e);
        }
      }

      const existingTabs = useTabStore.getState().tabs[activeWorktreeId] ?? [];
      const oldServerTab = existingTabs.find((t) => t.type === "server");
      if (oldServerTab) {
        await lifecycleManager.removeTab(activeWorktreeId, oldServerTab.id);
      }

      const tabId = lifecycleManager.addTab(activeWorktreeId, "server");
      if (tabId) {
        // Store the raw run command. TerminalView spawns the server PTY directly
        // as `$SHELL -i -c <command>` (see its resolve-args effect) rather than
        // typing the command into an interactive shell — keystroke injection
        // raced the shell's line-editor startup and intermittently dropped the
        // leading character. `-i` still sources the user's rc file (PATH/nvm/etc.),
        // so the command runs with the same environment as a normal terminal tab,
        // and when it exits the PTY closes so the stale-server cleanup fires.
        useTabStore.getState().updateTab(activeWorktreeId, tabId, {
          command: runCommand,
        });
      }

      // Prefer the freshly-claimed assignedPort so the sidebar pill is
      // correct between server start and the first port-bearing log line.
      // Fall back to the run script's URL template port, then to undefined
      // (auto-detect-from-output effect will fill it in once the server logs).
      const freshWt = useWorkspaceStore.getState().worktrees.find((w) => w.id === activeWorktreeId);
      const port =
        freshWt?.assignedPort ??
        (runScript.url ? extractPort(runScript.url) : undefined);

      setRunningServer(activeWorktreeId, {
        sessionId: "",
        tabId: tabId ?? "",
        port,
        createdAt: Date.now(),
      });
    } catch (err) {
      console.error("[handleToggleServer] failed:", err);
    }
  }, [activeWorktreeId, runScript, worktreeRepoPath, isServerRunningHere, runningServer, setRunningServer]);

  // Detect server process exit via heartbeat timeout
  useEffect(() => {
    if (!activeWorktreeId || !runningServer) return;

    const startTime = Date.now();
    const wtId = activeWorktreeId;

    const tabId = runningServer.tabId;
    const interval = setInterval(async () => {
      if (Date.now() - startTime < SERVER_GRACE_PERIOD_MS) return;

      const session = sessionManager.getSession(tabId);
      // Only clear when heartbeat is stale (PTY process actually exited).
      // Don't check !session.sessionId — it's "" during normal PTY spawn
      // and would race with slow shell startup (e.g. shell_path() on first call).
      const shouldClear =
        !session ||
        (session.lastHeartbeat > 0 && Date.now() - session.lastHeartbeat > SERVER_HEARTBEAT_STALE_MS);
      if (!shouldClear) return;

      const revived = await tryReviveBeforeClear(wtId, tabId, setRunningServer);
      if (!revived) setRunningServer(wtId, null);
    }, SERVER_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [activeWorktreeId, runningServer, setRunningServer]);

  // Auto-detect port from terminal output (separate effect to avoid restarting heartbeat)
  useEffect(() => {
    if (!activeWorktreeId || !runningServer || runningServer.port) return;

    const wtId = activeWorktreeId;
    const tabId = runningServer.tabId;

    const interval = setInterval(() => {
      const bytes = sessionManager.getBufferedOutput(tabId);
      if (bytes.length === 0) return;

      const text = new TextDecoder().decode(bytes);
      const detected = detectPortFromOutput(text);
      if (detected) {
        setRunningServer(wtId, { ...runningServer, port: detected });
      }
    }, SERVER_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [activeWorktreeId, runningServer, setRunningServer]);

  // Derive effective URL: prefer explicit config, fall back to auto-detected port
  const effectiveRunScript = useMemo(() => {
    if (!runScript) return runScript;
    const effectiveUrl = runScript.url
      ?? (runningServer?.port ? `http://localhost:${runningServer.port}` : undefined);
    return effectiveUrl !== runScript.url
      ? { ...runScript, url: effectiveUrl }
      : runScript;
  }, [runScript, runningServer?.port]);

  return { runScript: effectiveRunScript, isServerRunningHere, handleToggleServer };
}

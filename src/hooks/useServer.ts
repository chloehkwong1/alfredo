import { useState, useEffect, useCallback, useMemo } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { getConfig, listSessions } from "../api";
import { sessionManager } from "../services/sessionManager";
import { lifecycleManager } from "../services/lifecycleManager";
import type { RunScript, Session } from "../types";

/** Single-quote a string for safe use in `sh -c '…'`. */
function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

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

    const interval = setInterval(() => {
      const now = Date.now();
      for (const [wtId, server] of Object.entries(
        useWorkspaceStore.getState().runningServers,
      )) {
        // Skip servers still within the grace period (session may not be registered yet)
        if (server.createdAt && now - server.createdAt < SERVER_GRACE_PERIOD_MS) continue;

        const session = sessionManager.getSession(server.tabId);
        if (!session) {
          setRunningServer(wtId, null);
          continue;
        }
        if (
          session.lastHeartbeat > 0 &&
          now - session.lastHeartbeat > SERVER_HEARTBEAT_STALE_MS
        ) {
          setRunningServer(wtId, null);
        }
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

  useEffect(() => {
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
        const wtId = srv.worktreeId;

        // Already tracked — skip
        if (store.runningServers[wtId]) continue;

        // Re-create a server tab for this session
        const tabId = lifecycleManager.addTab(wtId, "server");
        if (!tabId) continue;

        // Reattach the sessionManager to the surviving PTY
        try {
          await sessionManager.reattachToSession(tabId, srv.id, wtId);
        } catch (err) {
          console.error(`[server-reconcile] reattach failed for ${srv.id}:`, err);
          continue;
        }
        if (cancelled) return;

        // Re-populate the store entry
        setRunningServer(wtId, {
          sessionId: srv.id,
          tabId,
          createdAt: Date.now(),
        });

        console.log(`[server-reconcile] reattached server for worktree ${wtId}`);
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

  // Load run script config (and refresh when settings are saved)
  const [configVersion, setConfigVersion] = useState(0);
  useEffect(() => {
    const handler = () => setConfigVersion((v) => v + 1);
    window.addEventListener("config-changed", handler);
    return () => window.removeEventListener("config-changed", handler);
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
        await sessionManager.stopSession(runningServer!.tabId);
        useTabStore.getState().updateTab(
          activeWorktreeId, runningServer!.tabId, { command: undefined },
        );
        setRunningServer(activeWorktreeId, null);
        return;
      }

      const existingTabs = useTabStore.getState().tabs[activeWorktreeId] ?? [];
      const oldServerTab = existingTabs.find((t) => t.type === "server");
      if (oldServerTab) {
        await lifecycleManager.removeTab(activeWorktreeId, oldServerTab.id);
      }

      const tabId = lifecycleManager.addTab(activeWorktreeId, "server");
      if (tabId) {
        // Prefix with `exec` so the shell is replaced by the server process.
        // Without this, the shell stays alive after the server exits and
        // heartbeats keep flowing — the stale-server cleanup never triggers.
        useTabStore.getState().updateTab(activeWorktreeId, tabId, {
          command: `exec sh -c ${shellQuote(runScript.command)}`,
        });
      }

      // Extract port from run script URL if available
      const port = runScript.url ? extractPort(runScript.url) : undefined;

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

    const interval = setInterval(() => {
      if (Date.now() - startTime < SERVER_GRACE_PERIOD_MS) return;

      const session = sessionManager.getSession(runningServer.tabId);
      if (!session) {
        setRunningServer(wtId, null);
        return;
      }
      // Only clear when heartbeat is stale (PTY process actually exited).
      // Don't check !session.sessionId — it's "" during normal PTY spawn
      // and would race with slow shell startup (e.g. shell_path() on first call).
      if (session.lastHeartbeat > 0 && Date.now() - session.lastHeartbeat > SERVER_HEARTBEAT_STALE_MS) {
        setRunningServer(wtId, null);
      }
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

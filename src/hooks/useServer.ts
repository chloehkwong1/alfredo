import { useState, useEffect, useCallback } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { getConfig } from "../api";
import { sessionManager } from "../services/sessionManager";
import { lifecycleManager } from "../services/lifecycleManager";
import type { RunScript } from "../types";

const SERVER_GRACE_PERIOD_MS = 5_000;
const SERVER_HEARTBEAT_STALE_MS = 10_000;
const SERVER_POLL_INTERVAL_MS = 3_000;

/**
 * Manages the dev server lifecycle: loading run script config,
 * toggling the server on/off, and detecting process exit via heartbeat.
 */
export function useServer(activeWorktreeId: string | null, repoPath: string | null) {
  const runningServer = useWorkspaceStore((s) => s.runningServer);
  const setRunningServer = useWorkspaceStore((s) => s.setRunningServer);
  const [runScript, setRunScript] = useState<RunScript | null>(null);

  // Load run script config (and refresh when settings are saved)
  const [configVersion, setConfigVersion] = useState(0);
  useEffect(() => {
    const handler = () => setConfigVersion((v) => v + 1);
    window.addEventListener("config-changed", handler);
    return () => window.removeEventListener("config-changed", handler);
  }, []);

  useEffect(() => {
    if (!repoPath) return;
    getConfig(repoPath).then((config) => {
      setRunScript(config.runScript ?? null);
    }).catch((err) => console.error("Failed to load run script config:", err));
  }, [repoPath, configVersion]);

  const isServerRunningHere = runningServer?.worktreeId === activeWorktreeId;

  const handleToggleServer = useCallback(async () => {
    if (!activeWorktreeId || !runScript || !repoPath) return;

    const wt = useWorkspaceStore.getState().worktrees.find((w) => w.id === activeWorktreeId);
    if (!wt) return;

    try {
      if (isServerRunningHere) {
        await sessionManager.stopSession(runningServer!.tabId);
        useTabStore.getState().updateTab(
          runningServer!.worktreeId, runningServer!.tabId, { command: undefined },
        );
        setRunningServer(null);
        return;
      }

      if (runningServer) {
        await sessionManager.stopSession(runningServer.tabId);
        useTabStore.getState().updateTab(
          runningServer.worktreeId, runningServer.tabId, { command: undefined },
        );
        setRunningServer(null);
      }

      const existingTabs = useTabStore.getState().tabs[activeWorktreeId] ?? [];
      const oldServerTab = existingTabs.find((t) => t.type === "server");
      if (oldServerTab) {
        await lifecycleManager.removeTab(activeWorktreeId, oldServerTab.id);
      }

      const tabId = lifecycleManager.addTab(activeWorktreeId, "server");
      if (tabId) {
        useTabStore.getState().updateTab(activeWorktreeId, tabId, {
          command: runScript.command,
        });
      }

      setRunningServer({
        worktreeId: activeWorktreeId,
        sessionId: "",
        tabId: tabId ?? "",
      });
    } catch (err) {
      console.error("[handleToggleServer] failed:", err);
    }
  }, [activeWorktreeId, runScript, repoPath, isServerRunningHere, runningServer, setRunningServer]);

  // Detect server process exit via heartbeat timeout
  useEffect(() => {
    if (!runningServer) return;

    const startTime = Date.now();

    const interval = setInterval(() => {
      if (Date.now() - startTime < SERVER_GRACE_PERIOD_MS) return;

      const session = sessionManager.getSession(runningServer.tabId);
      if (!session || !session.sessionId) {
        setRunningServer(null);
        return;
      }
      if (session.lastHeartbeat > 0 && Date.now() - session.lastHeartbeat > SERVER_HEARTBEAT_STALE_MS) {
        setRunningServer(null);
      }
    }, SERVER_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [runningServer, setRunningServer]);

  return { runScript, isServerRunningHere, handleToggleServer };
}

import { useState, useEffect, useCallback, useRef } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type UpdateStatus = "idle" | "available" | "downloading" | "ready";

export interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  progress: number; // 0–100
  checking: boolean;
  upToDate: boolean;
  error: string | null;
  update: () => void;
  restart: () => void;
  dismiss: () => void;
  openReleaseNotes: () => void;
  checkNow: () => Promise<void>;
}

interface UpdateInfo {
  version: string;
  currentVersion: string;
  body: string | null;
}

interface ProgressPayload {
  chunkLength: number;
  contentLength: number | null;
}

export function useUpdater(): UpdateState {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<{ version: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [upToDate, setUpToDate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checkingRef = useRef(false);
  const upToDateTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const checkForUpdate = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    try {
      const result = await invoke<UpdateInfo | null>("check_for_update_filtered");
      if (!result) {
        setUpToDate(true);
        clearTimeout(upToDateTimer.current);
        upToDateTimer.current = setTimeout(() => setUpToDate(false), 4000);
        return;
      }
      setPendingUpdate({ version: result.version });
      setVersion(result.version);
      setStatus("available");
      setDismissed(false);
    } catch (e) {
      console.error("[updater] check failed:", e);
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    // Don't re-check while downloading or ready to restart
    if (status === "downloading" || status === "ready") return;
    checkForUpdate();
    const interval = setInterval(checkForUpdate, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [checkForUpdate, status]);

  const update = useCallback(async () => {
    if (!pendingUpdate) return;
    setStatus("downloading");
    setProgress(0);
    setError(null);

    let totalBytes: number | undefined;
    let downloaded = 0;
    let installed = false;
    const unlisteners: UnlistenFn[] = [];

    try {
      const [unlistenProgress, unlistenFinished] = await Promise.all([
        listen<ProgressPayload>("updater://progress", (event) => {
          const { chunkLength, contentLength } = event.payload;
          if (totalBytes === undefined && contentLength != null) {
            totalBytes = contentLength;
          }
          downloaded += chunkLength;
          if (totalBytes) {
            setProgress(Math.min(Math.round((downloaded / totalBytes) * 100), 100));
          }
        }),
        listen("updater://finished", () => {
          setProgress(100);
        }),
      ]);
      unlisteners.push(unlistenProgress, unlistenFinished);

      await invoke("install_pending_update");
      installed = true;

      unlisteners.forEach((fn) => fn());
      setStatus("ready");
      await relaunch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[updater] update/relaunch failed:", msg);
      unlisteners.forEach((fn) => fn());
      setError(msg);
      // If download succeeded but relaunch failed, stay on "ready" so user can retry restart
      if (installed) {
        setStatus("ready");
        return;
      }
      // Download failed — fall back to "available" for retry
      setStatus("available");
      setProgress(0);
    }
  }, [pendingUpdate]);

  const restart = useCallback(async () => {
    try {
      setError(null);
      await relaunch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[updater] relaunch failed:", msg);
      setError(msg);
    }
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  const openReleaseNotes = useCallback(() => {
    if (!version) return;
    openUrl(`https://github.com/chloehkwong1/alfredo/releases/tag/v${version}`);
  }, [version]);

  return {
    status: dismissed ? "idle" : status,
    version,
    progress,
    checking,
    upToDate,
    error,
    update,
    restart,
    dismiss,
    openReleaseNotes,
    checkNow: checkForUpdate,
  };
}

import { useState, useEffect, useCallback, useRef } from "react";
import { check, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";

export type UpdateStatus = "idle" | "available" | "downloading" | "ready";

export interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  progress: number; // 0–100
  checking: boolean;
  upToDate: boolean;
  update: () => void;
  restart: () => void;
  dismiss: () => void;
  openReleaseNotes: () => void;
  checkNow: () => Promise<void>;
}

export function useUpdater(): UpdateState {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [updateObj, setUpdateObj] = useState<Update | null>(null);
  const [checking, setChecking] = useState(false);
  const [upToDate, setUpToDate] = useState(false);
  const checkingRef = useRef(false);
  const upToDateTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const checkForUpdate = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    try {
      const result = await check();
      if (!result) {
        setUpToDate(true);
        clearTimeout(upToDateTimer.current);
        upToDateTimer.current = setTimeout(() => setUpToDate(false), 4000);
        return;
      }
      setUpdateObj(result);
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
    if (!updateObj) return;
    setStatus("downloading");
    setProgress(0);

    let totalBytes: number | undefined;
    let downloaded = 0;

    try {
      await updateObj.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (totalBytes) {
            setProgress(Math.min(Math.round((downloaded / totalBytes) * 100), 100));
          }
        } else if (event.event === "Finished") {
          setProgress(100);
        }
      });
      setStatus("ready");
      await relaunch();
    } catch (e) {
      console.error("[updater] update/relaunch failed:", e);
      // If download succeeded but relaunch failed, stay on "ready" so user can retry restart
      // If download failed, fall back to "available" for retry
      if (status === "ready") return;
      setStatus("available");
      setProgress(0);
    }
  }, [updateObj]);

  const restart = useCallback(async () => {
    try {
      await relaunch();
    } catch (e) {
      console.error("[updater] relaunch failed:", e);
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
    update,
    restart,
    dismiss,
    openReleaseNotes,
    checkNow: checkForUpdate,
  };
}

import { useState, useEffect, useCallback } from "react";
import { check, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";

export type UpdateStatus = "idle" | "available" | "downloading" | "ready";

export interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  progress: number; // 0–100
  update: () => void;
  restart: () => void;
  dismiss: () => void;
  openReleaseNotes: () => void;
}

export function useUpdater(): UpdateState {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [updateObj, setUpdateObj] = useState<Update | null>(null);

  useEffect(() => {
    checkForUpdate();

    async function checkForUpdate() {
      try {
        const result = await check();
        if (!result) return;
        setUpdateObj(result);
        setVersion(result.version);
        setStatus("available");
      } catch (e) {
        console.error("[updater] check failed:", e);
      }
    }
  }, []);

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
    } catch (e) {
      console.error("[updater] download failed:", e);
      // Fall back to available state so user can retry
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
    update,
    restart,
    dismiss,
    openReleaseNotes,
  };
}

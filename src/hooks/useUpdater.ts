import { useEffect } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { ask } from "@tauri-apps/plugin-dialog";

export function useUpdater() {
  useEffect(() => {
    checkForUpdate();
  }, []);
}

async function checkForUpdate() {
  try {
    const update = await check();
    if (!update) return;

    const yes = await ask(
      `Alfredo ${update.version} is available. Would you like to update and restart?`,
      { title: "Update Available", kind: "info", okLabel: "Update", cancelLabel: "Later" }
    );

    if (yes) {
      await update.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    }
  } catch (e) {
    console.error("[updater]", e);
  }
}

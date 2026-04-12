import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { detectInstalledApps, type InstalledApp } from "../api";

let cachedApps: InstalledApp[] | null = null;

export function useInstalledApps(): InstalledApp[] {
  const [apps, setApps] = useState<InstalledApp[]>(cachedApps ?? []);

  useEffect(() => {
    let cancelled = false;

    const fetch = () => {
      detectInstalledApps()
        .then((result) => {
          if (!cancelled) {
            cachedApps = result;
            setApps(result);
          }
        })
        .catch((e) => console.error("Failed to detect installed apps:", e));
    };

    // Fetch on mount (skip if already cached)
    if (!cachedApps) fetch();

    // Re-fetch on window focus
    const unlisten = listen("tauri://focus", fetch);

    return () => {
      cancelled = true;
      unlisten.then((fn) => fn());
    };
  }, []);

  return apps;
}

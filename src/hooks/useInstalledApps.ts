import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { detectInstalledApps, type InstalledApp } from "../api";

let cachedApps: InstalledApp[] | null = null;
let fetchInFlight = false;
let focusListenerRegistered = false;
const subscribers = new Set<(apps: InstalledApp[]) => void>();

// One detection for every subscriber: the Rust command spawns about 20
// `open -Ra` processes per call, and every sidebar row uses this hook.
function refresh() {
  if (fetchInFlight) return;
  fetchInFlight = true;
  detectInstalledApps()
    .then((result) => {
      cachedApps = result;
      subscribers.forEach((notify) => notify(result));
    })
    .catch((e) => console.error("Failed to detect installed apps:", e))
    .finally(() => {
      fetchInFlight = false;
    });
}

export function useInstalledApps(): InstalledApp[] {
  const [apps, setApps] = useState<InstalledApp[]>(cachedApps ?? []);

  useEffect(() => {
    subscribers.add(setApps);
    // One listener for the app's lifetime, however many rows mount.
    if (!focusListenerRegistered) {
      focusListenerRegistered = true;
      listen("tauri://focus", refresh).catch((e) => {
        focusListenerRegistered = false;
        console.error("Failed to listen for window focus:", e);
      });
    }
    // A detection that finished between this component's render and this
    // effect notified nobody here: take its result now.
    if (cachedApps) setApps(cachedApps);
    else refresh();
    return () => {
      subscribers.delete(setApps);
    };
  }, []);

  return apps;
}

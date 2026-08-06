import { useEffect, useState } from "react";
import { readCurrentThemeMode } from "../lib/themeMeta";

/** Live light/dark mode of the current app theme. Updates on the
 *  `alfredo-theme-changed` event dispatched by applyTheme. */
export function useThemeMode(): "light" | "dark" {
  const [mode, setMode] = useState(readCurrentThemeMode);
  useEffect(() => {
    const handler = () => setMode(readCurrentThemeMode());
    window.addEventListener("alfredo-theme-changed", handler);
    return () => window.removeEventListener("alfredo-theme-changed", handler);
  }, []);
  return mode;
}

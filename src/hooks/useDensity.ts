import { useEffect } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";

type Density = "compact" | "default" | "comfortable";

function getDensity(width: number): Density {
  if (width < 900) return "compact";
  if (width >= 1440) return "comfortable";
  return "default";
}

export function useDensity() {
  const setSidebarCollapsed = useWorkspaceStore((s) => s.setSidebarCollapsed);

  useEffect(() => {
    const root = document.documentElement;

    function update() {
      const width = window.innerWidth;
      const density = getDensity(width);
      root.setAttribute("data-density", density);

      // Auto-collapse sidebar at narrow widths
      if (width < 700) {
        setSidebarCollapsed(true);
      }
    }

    update();

    const observer = new ResizeObserver(() => update());
    observer.observe(root);

    return () => observer.disconnect();
  }, [setSidebarCollapsed]);
}

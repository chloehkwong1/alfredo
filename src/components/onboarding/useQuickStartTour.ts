import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useAppConfig } from "../../hooks/useAppConfig";

const DISMISSED_KEY = "alfredo:quickStartDismissed";
const OPEN_EVENT = "alfredo:open-quickstart";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // localStorage unavailable — acceptable, panel will just auto-open again next launch
  }
}

export function useQuickStartTour() {
  const [open, setOpen] = useState(false);
  const autoOpenEvaluated = useRef(false);

  const { repos } = useAppConfig();
  const worktreeCount = useWorkspaceStore((s) => s.worktrees.length);

  useEffect(() => {
    if (autoOpenEvaluated.current) return;
    if (repos.length >= 1 && worktreeCount === 0 && !readDismissed()) {
      autoOpenEvaluated.current = true;
      setOpen(true);
    } else if (repos.length >= 1) {
      autoOpenEvaluated.current = true;
    }
  }, [repos.length, worktreeCount]);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, handler);
    return () => window.removeEventListener(OPEN_EVENT, handler);
  }, []);

  const dismiss = useCallback(() => {
    writeDismissed();
    setOpen(false);
  }, []);

  return { open, dismiss };
}

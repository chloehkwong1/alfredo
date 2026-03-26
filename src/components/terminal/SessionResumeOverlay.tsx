import { useCallback, useEffect } from "react";
import { RotateCcw, Plus } from "lucide-react";
import { Button } from "../ui/Button";

interface SessionResumeOverlayProps {
  settingsChangedText: string | null;
  onResume: () => void;
  onStartFresh: () => void;
  onDismiss: () => void;
}

function SessionResumeOverlay({
  settingsChangedText,
  onResume,
  onStartFresh,
  onDismiss,
}: SessionResumeOverlayProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        onResume();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    },
    [onResume, onDismiss],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-accent-primary/20 bg-bg-primary/95 backdrop-blur-sm px-4 py-3 flex items-center justify-between">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm text-text-secondary">
          Previous session ended
        </span>
        {settingsChangedText && (
          <span className="text-xs text-text-tertiary">
            Settings changed: {settingsChangedText}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" onClick={onResume}>
          <RotateCcw size={12} />
          Resume conversation
        </Button>
        <Button size="sm" variant="ghost" onClick={onStartFresh}>
          <Plus size={12} />
          Start fresh
        </Button>
      </div>
    </div>
  );
}

export { SessionResumeOverlay };

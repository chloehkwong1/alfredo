import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Bell, AlertCircle } from "lucide-react";
import { Button } from "../ui/Button";
import { parseLaunchFlags } from "../../services/launchCommand";

interface ClaudeLaunchOverlayProps {
  prefill: string;
  onLaunch: (flags: string) => void;
  onCancel: () => void;
}

function ClaudeLaunchOverlay({
  prefill,
  onLaunch,
  onCancel,
}: ClaudeLaunchOverlayProps) {
  const [value, setValue] = useState(prefill);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = parseLaunchFlags(value);
  const error = parsed.ok ? null : parsed.error;

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (error) return;
        onLaunch(value.trim());
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    },
    [error, value, onLaunch, onCancel],
  );

  return (
    <div
      role="dialog"
      aria-label="Launch command"
      className="absolute bottom-0 left-0 right-0 z-10 border-t border-accent-primary/20 bg-bg-primary/95 backdrop-blur-sm px-4 py-3 flex flex-col gap-2"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm text-text-secondary">
          <Sparkles size={12} />
          Launch command
        </span>
        <span className="text-xs text-text-tertiary">
          <kbd className="font-mono">Esc</kbd> to cancel
        </span>
      </div>
      <div
        className={`flex items-center gap-2 rounded border ${
          error ? "border-status-error" : "border-accent-primary/20"
        } bg-bg-secondary px-2 py-1.5`}
      >
        <span className="font-mono text-sm text-text-tertiary select-none">
          claude
        </span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-invalid={error != null}
          aria-describedby={error ? "claude-launch-error" : undefined}
          className="flex-1 bg-transparent font-mono text-sm text-text-primary outline-none placeholder:text-text-tertiary"
        />
      </div>
      <div className="flex items-center justify-between">
        {error ? (
          <span
            id="claude-launch-error"
            className="flex items-center gap-1.5 text-xs text-status-error"
          >
            <AlertCircle size={12} />
            {error}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-text-tertiary">
            <Bell size={12} />
            Runs in this tab — notifications stay linked.
          </span>
        )}
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={error != null}
            onClick={() => onLaunch(value.trim())}
          >
            Launch ⏎
          </Button>
        </div>
      </div>
    </div>
  );
}

export { ClaudeLaunchOverlay };

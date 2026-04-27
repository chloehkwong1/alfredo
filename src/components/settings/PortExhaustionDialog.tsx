import { useState } from "react";
import { Button } from "../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/Dialog";

/** Display-ready row passed in by the caller. The dialog itself doesn't know
 *  about the workspace/repo stores — the parent joins them in. */
export interface PortExhaustionHolder {
  worktreeName: string;
  branch: string;
  port: number;
  isServerRunning: boolean;
  chip: {
    label: string;
    bg: string;
    text: string;
  };
}

interface PortExhaustionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rangeStart: number;
  rangeEnd: number;
  /** Branch name of the worktree trying to claim a port — used in the description. */
  targetBranch: string;
  holders: PortExhaustionHolder[];
  /** Inline error from the last release or retry attempt, if any. */
  error?: string | null;
  /** Called when the user clicks Release on a row. Parent is responsible for
   *  calling release_worktree_port, refreshing workspace state, and retrying
   *  the original claim. If the retry succeeds, the parent closes this dialog. */
  onRelease: (worktreeName: string) => Promise<void>;
}

function PortExhaustionDialog({
  open,
  onOpenChange,
  rangeStart,
  rangeEnd,
  targetBranch,
  holders,
  error,
  onRelease,
}: PortExhaustionDialogProps) {
  // Tracks which row is mid-release so we can disable its button and show a
  // spinner. The parent fully controls when the dialog closes.
  const [releasing, setReleasing] = useState<string | null>(null);

  async function handleRelease(worktreeName: string) {
    if (releasing) return;
    setReleasing(worktreeName);
    try {
      await onRelease(worktreeName);
    } finally {
      setReleasing(null);
    }
  }

  const slotCount = rangeEnd - rangeStart + 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[460px]">
        <DialogHeader>
          <DialogTitle>Port range full</DialogTitle>
          <DialogDescription>
            All {slotCount} ports are in use. Release one to start a dev server in{" "}
            <span className="text-text-secondary">{targetBranch}</span>.
          </DialogDescription>
          <div className="inline-flex items-center gap-1.5 mt-1 px-2 py-0.5 rounded-[var(--radius-sm)] border border-border-subtle bg-bg-elevated font-mono text-[11px] text-text-secondary">
            <span>{rangeStart}–{rangeEnd}</span>
            <span className="text-text-tertiary">·</span>
            <span className="text-text-tertiary">{slotCount} in use</span>
          </div>
        </DialogHeader>

        <div className="rounded-[var(--radius-md)] border border-border-subtle bg-bg-primary overflow-hidden">
          {holders.map((h, i) => {
            const isReleasing = releasing === h.worktreeName;
            return (
              <div
                key={h.worktreeName}
                className={[
                  "flex items-center gap-3 px-3 py-2.5",
                  i < holders.length - 1 ? "border-b border-border-subtle" : "",
                  "hover:bg-bg-hover",
                ].join(" ")}
              >
                <span
                  className="text-[11px] font-semibold px-1.5 py-0.5 rounded-[4px] flex-shrink-0 tracking-wide"
                  style={{
                    background: h.chip.bg,
                    color: h.chip.text,
                  }}
                >
                  {h.chip.label}
                </span>
                <div className="flex-1 min-w-0 flex flex-col gap-[2px]">
                  <div
                    className="text-[13px] font-medium text-text-primary truncate"
                    title={h.branch}
                  >
                    {h.branch}
                  </div>
                  {h.isServerRunning && (
                    <div className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{
                          background: "var(--status-idle)",
                          boxShadow: "0 0 0 3px rgba(74, 222, 128, 0.15)",
                        }}
                      />
                      <span>Server running</span>
                    </div>
                  )}
                </div>
                <div className="font-mono text-[12px] text-text-secondary min-w-[48px] text-right">
                  :{h.port}
                </div>
                <button
                  type="button"
                  disabled={isReleasing}
                  onClick={() => handleRelease(h.worktreeName)}
                  className={[
                    "h-[26px] px-2.5 text-[12px] rounded-[var(--radius-sm)]",
                    "border border-border-default text-text-secondary bg-transparent",
                    "hover:text-text-primary hover:border-border-hover hover:bg-bg-hover",
                    "disabled:opacity-50 disabled:cursor-wait",
                    "transition-colors cursor-pointer",
                  ].join(" ")}
                >
                  {isReleasing ? "Releasing…" : "Release"}
                </button>
              </div>
            );
          })}
        </div>

        {error && (
          <div
            role="alert"
            className="mt-3.5 rounded-[var(--radius-sm)] border border-status-error/50 bg-status-error/10 px-3 py-2 text-[12px] text-status-error"
          >
            {error}
          </div>
        )}

        <p className="mt-3.5 text-xs text-text-tertiary leading-relaxed">
          Releasing a port frees the slot immediately. A dev server already
          running in that worktree keeps its current port until you stop it.
        </p>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { PortExhaustionDialog };

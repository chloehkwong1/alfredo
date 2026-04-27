import { useState } from "react";

/** A single slot in the picker. Free slots are clickable to claim; held
 *  slots are clickable to take from another worktree; self slots show a
 *  "Yours" badge and are inert. */
export type PickerSlot =
  | { kind: "free"; port: number }
  | { kind: "self"; port: number }
  | {
      kind: "held";
      port: number;
      worktreeName: string;
      branch: string;
      isRunning: boolean;
      chip: { label: string; bg: string; text: string };
    };

interface PortPickerProps {
  rangeStart: number;
  rangeEnd: number;
  /** Branch name of the worktree taking a port — used in the footer copy. */
  targetBranch: string;
  slots: PickerSlot[];
  /** Called when the user clicks a row. The handler is responsible for the
   *  take action, refreshing state, and any side-effects (toast, server-stop). */
  onTake: (slot: PickerSlot) => Promise<void>;
}

function PortPicker({
  rangeStart,
  rangeEnd,
  targetBranch,
  slots,
  onTake,
}: PortPickerProps) {
  const [busyPort, setBusyPort] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const slotCount = rangeEnd - rangeStart + 1;
  const heldCount = slots.filter((s) => s.kind === "held" || s.kind === "self").length;
  const freeCount = slots.filter((s) => s.kind === "free").length;

  async function handleSelect(slot: PickerSlot) {
    if (slot.kind === "self") return;
    if (busyPort !== null) return;
    setBusyPort(slot.port);
    setError(null);
    try {
      await onTake(slot);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusyPort(null);
    }
    // Successful take closes the popover via the parent — no need to clear
    // busyPort here; the component unmounts.
  }

  return (
    <div className="w-[320px] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border-subtle">
        <span className="text-[12px] font-semibold text-text-primary">Pick a port</span>
        <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 font-mono text-[10.5px] text-text-secondary bg-bg-secondary border border-border-subtle rounded-[var(--radius-sm)]">
          <span>{rangeStart}–{rangeEnd}</span>
          <span className="text-text-tertiary">·</span>
          <span>{heldCount} in use</span>
        </span>
      </div>

      {/* Rows */}
      <div className="max-h-[320px] overflow-y-auto">
        {slots.map((slot, i) => {
          const isBusy = busyPort === slot.port;
          const isInteractive = slot.kind !== "self";
          const focusedRunningSteal =
            slot.kind === "held" && slot.isRunning;

          return (
            <button
              key={slot.port}
              type="button"
              role="menuitem"
              tabIndex={isInteractive ? 0 : -1}
              disabled={!isInteractive || busyPort !== null}
              onClick={() => handleSelect(slot)}
              data-running-held={focusedRunningSteal ? "true" : undefined}
              className={[
                "group w-full flex items-center gap-2.5 px-3 py-2 text-left",
                i < slots.length - 1 ? "border-b border-border-subtle" : "",
                "transition-colors",
                isInteractive
                  ? "hover:bg-bg-hover cursor-pointer focus-visible:bg-accent-primary/10 focus-visible:outline-none"
                  : "cursor-default",
                isBusy ? "opacity-60" : "",
              ].join(" ")}
            >
              <span className="font-mono text-[12px] text-text-primary tabular-nums min-w-[50px]">
                :{slot.port}
              </span>

              {slot.kind === "free" && (
                <>
                  <span className="text-[10.5px] font-medium text-status-idle bg-status-idle/10 border border-status-idle/25 rounded-[var(--radius-sm)] px-1.5 py-[1px]">
                    Free
                  </span>
                  <span className="flex-1" />
                  <span className="text-[11px] text-text-tertiary opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
                    {isBusy ? "Taking…" : "Take"}
                  </span>
                </>
              )}

              {slot.kind === "self" && (
                <>
                  <span className="text-[10.5px] font-medium text-accent-primary bg-accent-primary/10 border border-accent-primary/25 rounded-[var(--radius-sm)] px-1.5 py-[1px]">
                    Yours
                  </span>
                  <span className="flex-1" />
                </>
              )}

              {slot.kind === "held" && (
                <>
                  <span
                    className="text-[10px] font-semibold tracking-wider px-1.5 py-[1px] rounded-[3px] flex-shrink-0"
                    style={{ background: slot.chip.bg, color: slot.chip.text }}
                  >
                    {slot.chip.label}
                  </span>
                  <span
                    className="flex-1 min-w-0 truncate text-[12px] text-text-secondary"
                    title={slot.branch}
                  >
                    {slot.branch}
                  </span>
                  {slot.isRunning && (
                    <span className="inline-flex items-center gap-1 text-[10.5px] text-text-tertiary flex-shrink-0">
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-status-idle animate-pulse"
                        style={{ boxShadow: "0 0 0 3px rgba(74, 222, 128, 0.15)" }}
                      />
                      running
                    </span>
                  )}
                  <span className="text-[11px] text-text-primary opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity flex-shrink-0">
                    {isBusy ? "Taking…" : "Take"}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>

      {/* Footer — adapts copy based on focused row + slot mix */}
      <PortPickerFooter
        targetBranch={targetBranch}
        slots={slots}
        slotCount={slotCount}
        freeCount={freeCount}
        error={error}
      />
    </div>
  );
}

function PortPickerFooter({
  targetBranch,
  slots,
  slotCount,
  freeCount,
  error,
}: {
  targetBranch: string;
  slots: PickerSlot[];
  slotCount: number;
  freeCount: number;
  error: string | null;
}) {
  if (error) {
    return (
      <div
        role="alert"
        className="px-3 py-2 border-t border-status-error/30 bg-status-error/10 text-[11px] text-status-error"
      >
        {error}
      </div>
    );
  }

  // Whether the picker is being used in a "range full" context — every slot
  // is held. Slightly different copy.
  const allHeld = freeCount === 0;
  // Heads-up if any held slot has a running server, since taking it will
  // stop that worktree's dev server.
  const anyRunning = slots.some((s) => s.kind === "held" && s.isRunning);

  return (
    <div className="px-3 py-2 border-t border-border-subtle bg-bg-secondary text-[11px] text-text-tertiary">
      {allHeld ? (
        <span>
          All {slotCount} ports in use. Take any row to free it for{" "}
          <strong className="text-text-secondary">{targetBranch}</strong>.
        </span>
      ) : (
        <span>
          Click any port to take it for{" "}
          <strong className="text-text-secondary">{targetBranch}</strong>.
          {anyRunning && (
            <span className="text-status-busy">
              {" "}Taking a running port stops that server.
            </span>
          )}
        </span>
      )}
    </div>
  );
}

export { PortPicker };

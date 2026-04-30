import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArchiveRestore, ChevronRight, Trash2 } from "lucide-react";
import { Tooltip } from "../ui";
import { Button } from "../ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/Dialog";
import type { Worktree } from "../../types";
import { DeleteWorktreeConfirm } from "./DeleteWorktreeConfirm";

interface ArchiveSectionProps {
  worktrees: Worktree[];
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
  onUnarchive: (id: string) => void;
  deletingCount?: { current: number; total: number } | null;
  archiveAfterDays: number;
  deleteAfterDays: number;
  /** Persists changes via updateConfig. */
  onUpdateLifecycleRules: (patch: { archiveAfterDays?: number; deleteAfterDays?: number }) => void;
  /** Lifted state — Sidebar owns it so the LifecycleNudge can also open the popover. */
  rulesOpen: boolean;
  onRulesOpenChange: (open: boolean) => void;
}

interface LifecycleRuleRowProps {
  label: string;
  value: number;
  /** Days to use when toggling on with no prior value. */
  fallback: number;
  onChange: (v: number) => void;
}

function LifecycleRuleRow({ label, value, fallback, onChange }: LifecycleRuleRowProps) {
  const [draft, setDraft] = useState<string>(value > 0 ? String(value) : String(fallback));
  const isOn = value > 0;

  // Keep draft synced when the value changes externally (e.g. via Settings dialog).
  useEffect(() => {
    if (value > 0) setDraft(String(value));
  }, [value]);

  function commit(raw: string) {
    const n = Math.max(0, parseInt(raw, 10) || 0);
    setDraft(String(n));
    if (n !== value) onChange(n);
  }

  return (
    <div className="flex items-center gap-2 my-1">
      <span className="flex-1">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        disabled={!isOn}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-10 h-5 rounded border border-border-default bg-bg-sidebar text-center font-mono text-[11px] text-text-primary disabled:opacity-50 focus:outline-none focus:border-accent-primary"
      />
      <span className="text-text-tertiary text-[10px]">d</span>
      <button
        type="button"
        onClick={() => onChange(isOn ? 0 : (parseInt(draft, 10) || fallback))}
        className={[
          "relative w-7 h-4 rounded-full transition-colors",
          isOn ? "bg-accent-primary" : "bg-bg-sidebar border border-border-default",
        ].join(" ")}
        aria-label={`Toggle ${label.toLowerCase()}`}
      >
        <span
          className={[
            "absolute top-0.5 w-3 h-3 rounded-full transition-transform",
            isOn ? "right-0.5 bg-white" : "left-0.5 bg-text-tertiary",
          ].join(" ")}
        />
      </button>
    </div>
  );
}

function ArchiveSection({ worktrees, onDelete, onDeleteAll, onUnarchive, deletingCount, archiveAfterDays, deleteAfterDays, onUpdateLifecycleRules, rulesOpen, onRulesOpenChange }: ArchiveSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Worktree | null>(null);

  if (worktrees.length === 0 && !rulesOpen) return null;

  return (
    <div className="mb-2">
      <div className="flex w-full items-center gap-1.5 py-1 select-none text-text-tertiary/60 group/arc">
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="flex items-center gap-1.5 hover:text-text-tertiary transition-colors cursor-pointer"
        >
          <ChevronRight
            className={[
              "h-3 w-3 transition-transform duration-150",
              isExpanded ? "rotate-90" : "rotate-0",
            ].join(" ")}
          />
          <span className="text-[11px] uppercase tracking-[0.05em] font-semibold">Archived</span>
          {worktrees.length > 0 && (
            <span className="text-[10px] tabular-nums">{worktrees.length}</span>
          )}
        </button>
        <span className="text-[10px] text-text-tertiary/40">·</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRulesOpenChange(!rulesOpen);
          }}
          className={[
            "text-[10px] cursor-pointer rounded px-1 py-0.5 -mx-1 hover:bg-bg-hover transition-colors",
            archiveAfterDays > 0 ? "text-accent-primary/80 hover:text-accent-primary" : "text-text-tertiary/50 hover:text-text-tertiary",
          ].join(" ")}
        >
          {archiveAfterDays > 0 ? `archive: ${archiveAfterDays}d` : "archive: off"}
        </button>
        <span className="text-[10px] text-text-tertiary/40">·</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRulesOpenChange(!rulesOpen);
          }}
          className={[
            "text-[10px] cursor-pointer rounded px-1 py-0.5 -mx-1 hover:bg-bg-hover transition-colors",
            deleteAfterDays > 0 ? "text-accent-primary/80 hover:text-accent-primary" : "text-text-tertiary/50 hover:text-text-tertiary",
          ].join(" ")}
        >
          {deleteAfterDays > 0 ? `delete: ${deleteAfterDays}d` : "delete: off"}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {rulesOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="my-2 ml-4 mr-1 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2.5 text-[11px] text-text-secondary">
              <div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-text-tertiary mb-1.5">
                Lifecycle rules
              </div>
              <LifecycleRuleRow
                label="Auto-archive merged after"
                value={archiveAfterDays}
                fallback={7}
                onChange={(v) => onUpdateLifecycleRules({ archiveAfterDays: v })}
              />
              <LifecycleRuleRow
                label="Auto-delete archived after"
                value={deleteAfterDays}
                fallback={30}
                onChange={(v) => onUpdateLifecycleRules({ deleteAfterDays: v })}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            {worktrees.map((wt) => (
              <div
                key={wt.id}
                className="group flex items-center gap-1.5 py-1 pl-1"
              >
                <span className="text-[11px] text-text-tertiary/60 truncate flex-1">
                  {wt.branch}
                </span>
                <Tooltip content="Restore" side="top" delayDuration={0}>
                  <button
                    type="button"
                    onClick={() => onUnarchive(wt.id)}
                    className="opacity-0 group-hover:opacity-100 text-text-tertiary/60 hover:text-accent-primary transition-opacity p-0.5 cursor-pointer"
                  >
                    <ArchiveRestore className="h-3 w-3" />
                  </button>
                </Tooltip>
                <Tooltip content="Delete" side="top" delayDuration={0}>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(wt)}
                    className="opacity-0 group-hover:opacity-100 text-text-tertiary/60 hover:text-red-400 transition-opacity p-0.5 cursor-pointer"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </Tooltip>
              </div>
            ))}
            {worktrees.length > 0 && (
              <button
                type="button"
                onClick={() => setDeleteAllDialogOpen(true)}
                disabled={!!deletingCount}
                className="text-[10px] text-text-tertiary/40 hover:text-red-400/70 transition-colors cursor-pointer mt-1 mb-1 pl-1"
              >
                {deletingCount
                  ? `Deleting ${deletingCount.current}/${deletingCount.total}...`
                  : "Delete all"}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <DeleteWorktreeConfirm
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        branch={pendingDelete?.branch ?? ""}
        onConfirm={() => {
          if (pendingDelete) onDelete(pendingDelete.id);
          setPendingDelete(null);
        }}
      />

      <Dialog open={deleteAllDialogOpen} onOpenChange={setDeleteAllDialogOpen}>
        <DialogContent className="w-[420px]">
          <DialogHeader>
            <DialogTitle>Delete all archived worktrees</DialogTitle>
            <DialogDescription>
              This will permanently delete <strong className="text-text-primary font-medium">{worktrees.length} worktree{worktrees.length === 1 ? "" : "s"}</strong> and their local branches. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <ul className="my-3 max-h-[160px] overflow-y-auto rounded-md border border-border-subtle bg-bg-sidebar px-3 py-2 font-mono text-xs text-text-secondary">
            {worktrees.slice(0, 5).map((wt) => (
              <li key={wt.id} className="py-0.5">{wt.branch}</li>
            ))}
            {worktrees.length > 5 && (
              <li className="py-0.5 italic text-text-tertiary">+{worktrees.length - 5} more</li>
            )}
          </ul>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteAllDialogOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => { setDeleteAllDialogOpen(false); onDeleteAll(); }}>
              Delete {worktrees.length} worktree{worktrees.length === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { ArchiveSection };

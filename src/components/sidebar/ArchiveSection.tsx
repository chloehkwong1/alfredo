import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArchiveRestore, ChevronRight, SlidersHorizontal, Trash2 } from "lucide-react";
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
import { worktreeDirtyState } from "../../api";
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

  // "Delete all" force-removes every archived worktree, so it needs the same
  // untracked-work guard as the single-delete confirm. Fetch each worktree's
  // dirty state when the dialog opens and surface which ones hold unseen work.
  const [dirtyAll, setDirtyAll] = useState<{ branch: string; count: number }[] | null>(null);
  useEffect(() => {
    if (!deleteAllDialogOpen) {
      setDirtyAll(null);
      return;
    }
    let cancelled = false;
    Promise.all(
      worktrees
        .filter((wt) => wt.path)
        .map(async (wt) => {
          try {
            const d = await worktreeDirtyState(wt.path, wt.repoPath);
            // Ignored files count here too — bulk delete is the easiest way to
            // lose a gitignored mockup, since nothing about the row hints at it.
            const count = d.untracked.length + d.uncommitted.length + d.ignored.length;
            return count > 0 ? { branch: wt.branch, count } : null;
          } catch {
            return null;
          }
        }),
    ).then((rows) => {
      if (!cancelled) {
        setDirtyAll(rows.filter((r): r is { branch: string; count: number } => r !== null));
      }
    });
    return () => { cancelled = true; };
  }, [deleteAllDialogOpen, worktrees]);

  const isEmpty = worktrees.length === 0;
  const hasRules = archiveAfterDays > 0 || deleteAfterDays > 0;
  const tooltipContent = hasRules ? (
    <div className="flex flex-col gap-0.5">
      {archiveAfterDays > 0 && (
        <div className="flex items-baseline gap-3">
          <span className="text-text-tertiary">Auto-archive merged</span>
          <span className="ml-auto tabular-nums text-text-primary">{archiveAfterDays}d</span>
        </div>
      )}
      {deleteAfterDays > 0 && (
        <div className="flex items-baseline gap-3">
          <span className="text-text-tertiary">Auto-delete archived</span>
          <span className="ml-auto tabular-nums text-text-primary">{deleteAfterDays}d</span>
        </div>
      )}
      {!rulesOpen && (
        <span className="mt-1 text-[10px] text-text-tertiary">Click to edit</span>
      )}
    </div>
  ) : (
    <div className="flex flex-col gap-0.5">
      <span>Lifecycle: off</span>
      {!rulesOpen && (
        <span className="text-[10px] text-text-tertiary">Click to configure</span>
      )}
    </div>
  );

  return (
    <div className="mb-2">
      <div className="flex w-full items-center gap-1.5 py-1 select-none text-text-tertiary/60 group/arc">
        <button
          type="button"
          onClick={() => !isEmpty && setIsExpanded((prev) => !prev)}
          disabled={isEmpty}
          className={[
            "flex flex-1 items-center gap-1.5 transition-colors",
            isEmpty ? "cursor-default" : "hover:text-text-tertiary cursor-pointer",
          ].join(" ")}
        >
          <ChevronRight
            className={[
              "h-3 w-3 transition-all duration-150",
              isExpanded ? "rotate-90" : "rotate-0",
              isEmpty && "opacity-0",
            ].filter(Boolean).join(" ")}
          />
          <span className="text-[11px] uppercase tracking-[0.05em] font-semibold">Archived</span>
          {!isEmpty && (
            <span className="text-[10px] tabular-nums">{worktrees.length}</span>
          )}
        </button>
        <Tooltip content={tooltipContent} side="bottom" delayDuration={150}>
          <button
            type="button"
            onClick={() => onRulesOpenChange(!rulesOpen)}
            aria-label="Lifecycle rules"
            aria-expanded={rulesOpen}
            className={[
              "relative flex h-[22px] w-[22px] items-center justify-center rounded transition-opacity cursor-pointer",
              "opacity-0 group-hover/arc:opacity-100 focus:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-accent-primary",
              rulesOpen
                ? "opacity-100 text-accent-primary bg-accent-muted"
                : "text-text-tertiary/60 hover:text-text-secondary hover:bg-bg-hover",
            ].join(" ")}
          >
            <SlidersHorizontal className="h-3 w-3" />
            {hasRules && !rulesOpen && (
              <span
                aria-hidden
                className="absolute top-0.5 right-0.5 h-1 w-1 rounded-full bg-accent-primary ring-2 ring-bg-sidebar"
              />
            )}
          </button>
        </Tooltip>
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
              <div className="mb-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-text-tertiary">
                  Lifecycle rules
                </div>
                <div className="text-[10px] text-text-tertiary/70">
                  Applies to all repositories
                </div>
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
        worktreePath={pendingDelete?.path}
        repoPath={pendingDelete?.repoPath}
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
          {dirtyAll && dirtyAll.length > 0 && (
            <div className="mb-3 rounded-md border border-red-400/25 bg-red-400/10 px-3 py-2.5 text-xs">
              <p className="font-medium text-red-400">
                {dirtyAll.length} of these {dirtyAll.length === 1 ? "worktrees has" : "worktrees have"} unsaved work that will be permanently deleted
              </p>
              <p className="mt-1 text-text-secondary">
                Untracked files (e.g. /research output) don't show in the changes badge:
              </p>
              <ul className="mt-1.5 space-y-0.5 font-mono text-text-secondary">
                {dirtyAll.slice(0, 6).map((r) => (
                  <li key={r.branch} className="truncate">{r.branch} — {r.count} file{r.count === 1 ? "" : "s"}</li>
                ))}
                {dirtyAll.length > 6 && (
                  <li className="text-text-tertiary">…and {dirtyAll.length - 6} more</li>
                )}
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteAllDialogOpen(false)}>Cancel</Button>
            {/* Disabled until the dirty check resolves — a fast click must not
                force-delete before the unsaved-work warning had a chance to render. */}
            <Button variant="danger" disabled={dirtyAll === null} onClick={() => { setDeleteAllDialogOpen(false); onDeleteAll(); }}>
              {dirtyAll && dirtyAll.length > 0
                ? `Delete ${worktrees.length} anyway`
                : `Delete ${worktrees.length} worktree${worktrees.length === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { ArchiveSection };

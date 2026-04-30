import { useState } from "react";
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

interface ArchiveSectionProps {
  worktrees: Worktree[];
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
  onUnarchive: (id: string) => void;
  deletingCount?: { current: number; total: number } | null;
}

function ArchiveSection({ worktrees, onDelete, onDeleteAll, onUnarchive, deletingCount }: ArchiveSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);

  if (worktrees.length === 0) return null;

  return (
    <div className="mb-2">
      <button
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full items-center gap-1.5 py-1 cursor-pointer select-none text-text-tertiary/60 hover:text-text-tertiary transition-colors"
      >
        <ChevronRight
          className={[
            "h-3 w-3 transition-transform duration-150",
            isExpanded ? "rotate-90" : "rotate-0",
          ].join(" ")}
        />
        <span className="text-[11px]">
          {worktrees.length} archived
        </span>
      </button>

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
                    onClick={() => onDelete(wt.id)}
                    className="opacity-0 group-hover:opacity-100 text-text-tertiary/60 hover:text-red-400 transition-opacity p-0.5 cursor-pointer"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </Tooltip>
              </div>
            ))}
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
          </motion.div>
        )}
      </AnimatePresence>

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

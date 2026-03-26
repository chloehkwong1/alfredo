import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Archive, ChevronRight, Trash2 } from "lucide-react";
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
  deletingCount?: { current: number; total: number } | null;
}

function ArchiveSection({ worktrees, onDelete, onDeleteAll, deletingCount }: ArchiveSectionProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);

  if (worktrees.length === 0) return null;

  return (
    <div className="mt-4 border-t border-border-subtle pt-2">
      <button
        onClick={() => setIsCollapsed((prev) => !prev)}
        className="flex w-full items-center gap-2 px-4 pt-3 pb-2 cursor-pointer select-none text-text-tertiary"
      >
        <Archive className="h-3.5 w-3.5" />
        <span className="text-xs font-semibold uppercase tracking-wider">
          Archive
        </span>
        <span className="ml-auto text-2xs text-text-tertiary tabular-nums">
          {worktrees.length}
        </span>
        <ChevronRight
          className={[
            "h-3.5 w-3.5 transition-transform duration-150",
            isCollapsed ? "rotate-0" : "rotate-90",
          ].join(" ")}
        />
      </button>

      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-red-400 hover:text-red-300 text-xs w-full"
                onClick={() => setDeleteAllDialogOpen(true)}
                disabled={!!deletingCount}
              >
                {deletingCount
                  ? `Deleting ${deletingCount.current}/${deletingCount.total}...`
                  : "Delete all"}
              </Button>
            </div>

            {worktrees.map((wt) => (
              <div
                key={wt.id}
                className="group w-full text-left px-3 py-2 mx-2 rounded-lg mb-1 flex items-center gap-2 bg-[rgba(255,255,255,0.02)]"
              >
                <span className="text-sm text-text-tertiary truncate flex-1">
                  {wt.branch}
                </span>
                <button
                  type="button"
                  onClick={() => onDelete(wt.id)}
                  className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-red-400 transition-opacity p-1 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog open={deleteAllDialogOpen} onOpenChange={setDeleteAllDialogOpen}>
        <DialogContent className="w-[420px]">
          <DialogHeader>
            <DialogTitle>Delete all archived worktrees</DialogTitle>
            <DialogDescription>
              This will delete {worktrees.length} worktree{worktrees.length === 1 ? "" : "s"} and their local branches. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteAllDialogOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => { setDeleteAllDialogOpen(false); onDeleteAll(); }}>
              Delete all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { ArchiveSection };

import { useState, useEffect, useRef } from "react";
import { GitBranch, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../ui/Dialog";
import { Input } from "../ui/Input";
import { listBranches, getDefaultBranch } from "../../api";
import { applyStackBaseChange } from "../../services/stackBase";
import type { Worktree } from "../../types";

interface ChangeBaseBranchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worktree: Worktree;
}

function ChangeBaseBranchDialog({ open, onOpenChange, worktree }: ChangeBaseBranchDialogProps) {
  // Resolved synchronously from `getDefaultBranch` on open. Null until resolved
  // — the list is disabled while null so we never write a stale "main" guess.
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null);
  const [branches, setBranches] = useState<Worktree[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setFilter("");
      setError(null);
      setSaving(null);
      setBranches([]);
      setDefaultBranch(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      listBranches(worktree.repoPath, true),
      getDefaultBranch(worktree.repoPath),
    ])
      .then(([branchList, def]) => {
        if (cancelled) return;
        setBranches(branchList);
        setDefaultBranch(def);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, worktree.repoPath]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => filterRef.current?.focus());
    }
  }, [open]);

  const currentBase = worktree.stackParent ?? defaultBranch;

  const filtered = branches.filter((b) => {
    if (b.branch === worktree.branch) return false;
    if (!filter.trim()) return true;
    return b.branch.toLowerCase().includes(filter.toLowerCase());
  });

  const handleSelect = async (branch: string) => {
    if (saving || defaultBranch === null) return;
    setSaving(branch);
    const nextParent = branch === defaultBranch ? null : branch;
    try {
      await applyStackBaseChange(worktree, nextParent);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(null);
    }
  };

  // Block close while a write is in flight, so the in-flight changeStackBase
  // can't resolve after the dialog state has been thrown away.
  const handleOpenChange = (next: boolean) => {
    if (!next && saving !== null) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="w-[480px]"
        onEscapeKeyDown={(e) => { if (saving !== null) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (saving !== null) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>Change base branch</DialogTitle>
          <DialogDescription>
            Current base:{" "}
            <span className="text-text-secondary font-medium">
              {currentBase ?? "resolving…"}
            </span>
            . Changing this rebases the branch's own commits onto the new base immediately (conflicts abort safely), then keeps it restacked automatically.
          </DialogDescription>
        </DialogHeader>

        {/* Native GitHub Stack members: manual re-parenting stays allowed, but
            GitHub owns retarget/rebase for this stack and Alfredo's automation
            stands down — warn before the user re-parents by hand. */}
        {worktree.prStatus?.nativeStack && (
          <div className="rounded-md border border-amber-400/25 bg-amber-400/10 px-3 py-2.5 text-xs">
            <p className="font-medium text-amber-400">
              This PR is in a GitHub-managed stack (Stack #{worktree.prStatus.nativeStack.number})
            </p>
            <p className="mt-1 text-text-secondary">
              Alfredo won't auto-restack it — GitHub manages this stack server-side and may
              retarget the PR again. You can still change the base manually.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Input
            ref={filterRef}
            placeholder="Filter branches..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="max-h-[320px] overflow-y-auto rounded-[var(--radius-md)] border border-border-default bg-bg-primary p-1">
            {loading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
              </div>
            )}
            {error && (
              <div className="text-xs text-danger text-center py-4 px-3">{error}</div>
            )}
            {!loading && !error && filtered.length === 0 && (
              <div className="text-xs text-text-tertiary text-center py-8">No branches found.</div>
            )}
            {!loading && !error && filtered.map((b) => {
              const isCurrent = b.branch === currentBase;
              const isSaving = saving === b.branch;
              const disabled = saving !== null || defaultBranch === null;
              return (
                <button
                  type="button"
                  key={b.branch}
                  onClick={() => handleSelect(b.branch)}
                  disabled={disabled}
                  className={[
                    "w-full text-left px-3 py-2.5 rounded-[var(--radius-sm)] cursor-pointer",
                    "transition-colors duration-[var(--transition-fast)]",
                    "disabled:opacity-60 disabled:cursor-default",
                    isCurrent
                      ? "bg-accent-muted text-text-primary"
                      : "text-text-secondary hover:bg-bg-hover hover:text-text-primary",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-2.5">
                    <GitBranch className="h-3.5 w-3.5 flex-shrink-0 opacity-50" />
                    <span className="text-[13px] font-medium truncate flex-1">{b.branch}</span>
                    {isCurrent && (
                      <span className="text-xs text-text-tertiary">current</span>
                    )}
                    {isSaving && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-text-tertiary" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { ChangeBaseBranchDialog };

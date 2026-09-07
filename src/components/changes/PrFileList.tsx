import { useEffect, useMemo, useState } from "react";
import { getPrFileViewedStates } from "../../api";
import { togglePrFileViewed } from "../../services/prFileViewed";
import { usePrStore } from "../../stores/prStore";
import { groupPrFilesByCategory } from "../../lib/prFileGrouping";
import { STATUS_BADGE_CLASSES, STATUS_LETTER } from "./FileSidebar";
import type { DiffFile } from "../../types";

interface PrFileListProps {
  worktreeId: string;
  repoPath: string;
  prNumber: number;
  files: DiffFile[];
  activeFilePath: string | null;
  onSelectFile: (path: string) => void;
}

const EMPTY_SET = new Set<string>();

/** Grouped (Implementation vs Tests) changed-file list for the wide PR
 *  Overview, with a per-file "Reviewed" checkbox synced to GitHub's native
 *  viewed-file state (Linear's Guide-tab pattern) — as opposed to
 *  FileSidebar's flat list used by the narrow Changes tab. */
export function PrFileList({ worktreeId, repoPath, prNumber, files, activeFilePath, onSelectFile }: PrFileListProps) {
  const reviewedFiles = usePrStore((s) => s.reviewedFiles[worktreeId]) ?? EMPTY_SET;
  const meta = usePrStore((s) => s.prFileMeta[worktreeId]);
  const [pendingPaths, setPendingPaths] = useState<Set<string>>(EMPTY_SET);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  // Hydrated once per worktree+PR per app session (store-cached) — in-app
  // toggles keep the store authoritative afterwards, and skipping the
  // re-fetch means a lagging GitHub read can't clobber a confirmed toggle.
  const hydratedMeta = meta && meta.prNumber === prNumber ? meta : null;
  const hydrated = hydratedMeta != null;
  const prNodeId = hydratedMeta?.nodeId ?? null;

  useEffect(() => {
    if (hydrated) return;
    let cancelled = false;
    setLoadError(null);
    getPrFileViewedStates(repoPath, prNumber)
      .then((states) => {
        if (cancelled) return;
        usePrStore.getState().setPrFileMeta(worktreeId, {
          nodeId: states.prNodeId,
          prNumber,
          prPaths: new Set(states.prPaths),
        });
        usePrStore.getState().setReviewedFiles(worktreeId, states.viewedPaths);
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn("[pr-file-list] Failed to fetch viewed states:", e);
        setLoadError(String(e));
      });
    return () => { cancelled = true; };
  }, [repoPath, prNumber, worktreeId, hydrated, retryNonce]);

  const groups = useMemo(() => groupPrFilesByCategory(files), [files]);

  async function handleToggle(path: string) {
    if (!prNodeId || pendingPaths.has(path)) return;
    setPendingPaths((p) => new Set(p).add(path));
    try {
      await togglePrFileViewed(repoPath, prNodeId, worktreeId, path, reviewedFiles.has(path));
    } finally {
      setPendingPaths((p) => {
        const next = new Set(p);
        next.delete(path);
        return next;
      });
    }
  }

  if (groups.length === 0) {
    return <div className="px-2.5 py-1.5 text-[13px] text-text-tertiary italic">No files changed</div>;
  }

  return (
    <div className="flex flex-col">
      {loadError && (
        <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-status-error">
          <span className="truncate" title={loadError}>Couldn't load reviewed states</span>
          <button
            onClick={() => setRetryNonce((n) => n + 1)}
            className="shrink-0 underline bg-transparent border-none cursor-pointer p-0 text-inherit font-[inherit]"
          >
            Retry
          </button>
        </div>
      )}
      {groups.map((group) => (
        <div key={group.label} className="mb-1">
          <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">
            <span>{group.label}</span>
            <span className="ml-auto normal-case font-normal">
              {group.additions > 0 && <span className="text-diff-added">+{group.additions}</span>}
              {group.deletions > 0 && <span className="text-diff-removed ml-1">-{group.deletions}</span>}
            </span>
          </div>
          {group.files.map((file) => {
            const isReviewed = reviewedFiles.has(file.path);
            const isPending = pendingPaths.has(file.path);
            // The list renders the LOCAL diff, but viewed toggles only exist
            // for files in the PR on GitHub — an unpushed change isn't there
            // yet, and marking it would just error.
            const inPrUniverse = hydratedMeta?.prPaths.has(file.path) ?? true;
            const filename = file.path.split("/").pop() ?? file.path;
            return (
              <div
                key={file.path}
                className={[
                  "group flex items-center gap-1.5 w-full px-2.5 py-1 text-left text-[13px] cursor-pointer",
                  "hover:bg-bg-hover transition-colors",
                  activeFilePath === file.path ? "bg-bg-hover text-text-primary" : "text-text-secondary",
                ].join(" ")}
                onClick={() => onSelectFile(file.path)}
              >
                <input
                  type="checkbox"
                  checked={isReviewed}
                  disabled={isPending || !prNodeId || !inPrUniverse}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => handleToggle(file.path)}
                  className="shrink-0 accent-accent-primary"
                  title={
                    prNodeId && !inPrUniverse
                      ? "Not in the PR on GitHub yet — push this change to mark it reviewed"
                      : "Mark as reviewed"
                  }
                />
                <span
                  className={["text-[10px] font-semibold px-1 py-px rounded-sm shrink-0", STATUS_BADGE_CLASSES[file.status] ?? ""].join(" ")}
                >
                  {STATUS_LETTER[file.status] ?? "?"}
                </span>
                <span
                  className={`flex-1 truncate ${isReviewed ? "text-text-tertiary line-through decoration-text-tertiary/40" : ""}`}
                  title={file.path}
                >
                  {filename}
                </span>
                <span className="text-text-tertiary text-[11px] shrink-0">
                  {file.additions > 0 && <span className="text-diff-added">+{file.additions}</span>}
                  {file.deletions > 0 && <span className="text-diff-removed ml-1">-{file.deletions}</span>}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

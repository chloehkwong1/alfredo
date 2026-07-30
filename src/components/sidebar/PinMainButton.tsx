import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { Plus } from "lucide-react";
import type { RepoEntry } from "../../types";
import { RepoTag } from "./RepoTag";
import { repoDisplayName } from "./RepoSelector";

interface PinMainButtonProps {
  /** Worktree-mode repos that are selected AND not yet in showMainCardRepos. */
  eligibleWorktreeRepos: RepoEntry[];
  worktreeCountByRepo: Record<string, number>;
  repoColors: Record<string, string>;
  repoDisplayNames?: Record<string, string>;
  repoIndexMap: Record<string, number>;
  onPinRepo: (path: string) => void;
}

function PinMainButton({
  eligibleWorktreeRepos,
  worktreeCountByRepo,
  repoColors,
  repoDisplayNames,
  repoIndexMap,
  onPinRepo,
}: PinMainButtonProps) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  // Popover placement is decided on open via viewport-collision check.
  // Default to "top" because the button typically sits near the bottom of
  // the sidebar list; flips when there's not enough room above (e.g. the
  // sidebar is scrolled and the button is near the viewport top).
  const [placement, setPlacement] = useState<"top" | "bottom">("top");
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const count = eligibleWorktreeRepos.length;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape + focus first row on open
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  useLayoutEffect(() => {
    if (open) {
      setFocusIndex(0);
      rowRefs.current[0]?.focus();
    }
  }, [open]);

  // Decide placement based on available viewport space; cap height to fit.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const margin = 8;
    const spaceAbove = rect.top - margin;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const next = spaceAbove >= spaceBelow ? "top" : "bottom";
    setPlacement(next);
    setMaxHeight(next === "top" ? spaceAbove : spaceBelow);
  }, [open]);

  function handleRowKey(e: React.KeyboardEvent, i: number) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.min(i + 1, count - 1);
      setFocusIndex(next);
      rowRefs.current[next]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.max(i - 1, 0);
      setFocusIndex(next);
      rowRefs.current[next]?.focus();
    }
  }

  function handlePick(path: string) {
    onPinRepo(path);
    setOpen(false);
    buttonRef.current?.focus();
  }

  if (count === 0) return null;

  return (
    <div ref={containerRef} className="relative mx-2.5 mt-2 mb-1">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Show a main-branch card in the sidebar for a repo — a persistent lane for general prompts."
        className={[
          "w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5",
          "rounded-[var(--radius-md)] border border-dashed border-border-default",
          "bg-transparent text-text-secondary text-[11px] font-medium",
          "hover:bg-bg-hover hover:text-text-primary hover:border-border-hover",
          "transition-colors cursor-pointer",
        ].join(" ")}
      >
        <Plus className="h-3 w-3" />
        <span>Pin a main-branch card</span>
        <span className="ml-1 px-1.5 py-px rounded text-[9px] bg-bg-elevated text-text-tertiary tabular-nums">
          {count}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Pin a main-branch card"
          className={[
            "absolute left-0 right-0 z-50 rounded-[var(--radius-md)] border border-border-default bg-bg-elevated shadow-md flex flex-col",
            placement === "top" ? "bottom-full mb-1" : "top-full mt-1",
          ].join(" ")}
          style={maxHeight !== undefined ? { maxHeight } : undefined}
        >
          <div className="px-3 pt-2.5 pb-1.5 flex-shrink-0">
            <div className="text-xs font-semibold text-text-primary">
              Pin a main-branch card
            </div>
            <div className="text-[11px] text-text-tertiary mt-0.5 leading-snug">
              Pick a worktree repo to show alongside its branches.
            </div>
          </div>
          <div className="px-1 pb-1 overflow-y-auto min-h-0">
            {eligibleWorktreeRepos.map((repo, i) => {
              const wtCount = worktreeCountByRepo[repo.path] ?? 0;
              return (
                <button
                  key={repo.path}
                  ref={(el) => { rowRefs.current[i] = el; }}
                  type="button"
                  onClick={() => handlePick(repo.path)}
                  onKeyDown={(e) => handleRowKey(e, i)}
                  tabIndex={i === focusIndex ? 0 : -1}
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-xs text-text-primary hover:bg-bg-hover cursor-pointer text-left transition-colors"
                >
                  <RepoTag
                    repoPath={repo.path}
                    repoColors={repoColors}
                    repoDisplayNames={repoDisplayNames}
                    repoIndex={repoIndexMap[repo.path] ?? 0}
                    visible
                  />
                  <span className="flex-1 truncate">
                    {repoDisplayName(repo.path, repoDisplayNames)}
                  </span>
                  <span className="text-[10px] text-text-tertiary flex-shrink-0 tabular-nums">
                    {wtCount} worktree{wtCount !== 1 ? "s" : ""}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="px-3 py-2 border-t border-border-subtle text-[10px] text-text-tertiary leading-snug flex-shrink-0">
            Branch-mode repos always show a main card.
          </div>
        </div>
      )}
    </div>
  );
}

export { PinMainButton };

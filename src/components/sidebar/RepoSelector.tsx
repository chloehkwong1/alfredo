import { useState, useRef, useEffect } from "react";
import { ChevronDown, Plus } from "lucide-react";
import type { RepoEntry } from "../../types";

const REPO_COLOR_PALETTE = [
  { bg: "rgba(147,51,234,0.12)", border: "rgba(147,51,234,0.25)", text: "#a78bfa", id: "purple" },
  { bg: "rgba(96,165,250,0.12)", border: "rgba(96,165,250,0.2)", text: "#60a5fa", id: "blue" },
  { bg: "rgba(74,222,128,0.12)", border: "rgba(74,222,128,0.2)", text: "#4ade80", id: "green" },
  { bg: "rgba(251,191,36,0.12)", border: "rgba(251,191,36,0.2)", text: "#fbbf24", id: "amber" },
  { bg: "rgba(244,114,182,0.12)", border: "rgba(244,114,182,0.2)", text: "#f472b6", id: "pink" },
  { bg: "rgba(34,211,238,0.12)", border: "rgba(34,211,238,0.2)", text: "#22d3ee", id: "cyan" },
];

function getRepoColor(index: number) {
  return REPO_COLOR_PALETTE[index % REPO_COLOR_PALETTE.length];
}

function repoDisplayName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function repoAbbrev(path: string): string {
  const name = repoDisplayName(path);
  if (name.length <= 14) return name;
  const words = name.split(/[_-]/);
  if (words.length <= 1) return name.slice(0, 12) + "…";
  return words[0] + "_" + words[words.length - 1];
}

interface RepoSelectorProps {
  repos: RepoEntry[];
  selectedRepos: string[];
  repoColors: Record<string, string>;
  onToggleRepo: (path: string) => void;
  onAddRepo: () => void;
  onRemoveRepo?: (path: string) => void;
  worktreeCountByRepo: Record<string, number>;
}

function RepoSelector({
  repos,
  selectedRepos,
  repoColors,
  onToggleRepo,
  onAddRepo,
  onRemoveRepo: _onRemoveRepo,
  worktreeCountByRepo,
}: RepoSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function getColorForRepo(path: string) {
    const colorId = repoColors[path];
    const found = REPO_COLOR_PALETTE.find((c) => c.id === colorId);
    if (found) return found;
    const idx = repos.findIndex((r) => r.path === path);
    return getRepoColor(idx >= 0 ? idx : 0);
  }

  if (repos.length <= 1) return null;

  return (
    <div ref={ref} className="relative px-3.5 py-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 rounded-[var(--radius-md)] border border-border-subtle bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-colors cursor-pointer"
      >
        <span className="flex gap-1 flex-1 flex-wrap items-center">
          {selectedRepos.length === 1 ? (
            <span className="text-xs text-text-secondary font-medium">
              {repoDisplayName(selectedRepos[0])}
            </span>
          ) : (
            selectedRepos.map((path) => {
              const color = getColorForRepo(path);
              return (
                <span
                  key={path}
                  className="text-[11px] font-medium px-1.5 py-px rounded-[3px]"
                  style={{ background: color.bg, color: color.text }}
                >
                  {repoAbbrev(path)}
                </span>
              );
            })
          )}
        </span>
        {selectedRepos.length === 1 && (
          <span className="text-2xs text-text-tertiary">
            {selectedRepos.length} of {repos.length}
          </span>
        )}
        <ChevronDown
          className={[
            "h-3 w-3 text-text-tertiary transition-transform duration-150",
            open ? "rotate-180" : "",
          ].join(" ")}
        />
      </button>

      {open && (
        <div className="absolute left-3.5 right-3.5 top-full mt-1 z-50 rounded-[var(--radius-md)] border border-border-default bg-bg-elevated shadow-lg overflow-hidden">
          {repos.map((repo) => {
            const isSelected = selectedRepos.includes(repo.path);
            const color = getColorForRepo(repo.path);
            const count = worktreeCountByRepo[repo.path] ?? 0;
            return (
              <button
                key={repo.path}
                type="button"
                onClick={() => onToggleRepo(repo.path)}
                className={[
                  "flex items-center gap-2 w-full px-2.5 py-1.5 text-left cursor-pointer transition-colors",
                  isSelected ? "bg-[rgba(255,255,255,0.03)]" : "hover:bg-bg-hover",
                ].join(" ")}
              >
                <span
                  className="w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center text-[9px] flex-shrink-0"
                  style={{
                    borderColor: isSelected ? color.border : "var(--border-default)",
                    background: isSelected ? color.bg : "transparent",
                    color: isSelected ? color.text : "transparent",
                  }}
                >
                  {isSelected ? "✓" : ""}
                </span>
                <span className="text-xs text-text-primary font-medium flex-1 truncate">
                  {repoDisplayName(repo.path)}
                </span>
                <span className="text-2xs text-text-tertiary flex-shrink-0">
                  {count} worktree{count !== 1 ? "s" : ""}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => { setOpen(false); onAddRepo(); }}
            className="flex items-center gap-2 w-full px-2.5 py-1.5 border-t border-border-subtle text-xs text-text-tertiary hover:text-text-secondary cursor-pointer transition-colors"
          >
            <Plus className="h-3 w-3" />
            Add repository
          </button>
        </div>
      )}
    </div>
  );
}

export { RepoSelector, REPO_COLOR_PALETTE, getRepoColor, repoDisplayName, repoAbbrev };

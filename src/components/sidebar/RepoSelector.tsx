import { useState, useRef, useEffect, type ReactNode } from "react";
import { ChevronDown, Settings, X } from "lucide-react";
import type { RepoEntry } from "../../types";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "../ui/ContextMenu";
import { openWorkspaceSettings } from "../settings/openWorkspaceSettings";

/** Wraps a chip element with a right-click menu that opens Workspace Settings
 *  scoped to the given repo path. */
function RepoChipMenu({ repoPath, children }: { repoPath: string; children: ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => openWorkspaceSettings(repoPath)}>
          <Settings className="h-4 w-4" />
          Open Repo Settings
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// Translucent-fill palette backed by --chip-*-bg / --chip-*-text tokens in
// theme.css. Deliberately off-axis from status colours (green/amber/blue/red)
// so a chip can't be misread as a state indicator.
const REPO_COLOR_PALETTE = [
  { id: "violet",  bg: "var(--chip-violet-bg)",  border: "var(--chip-violet-text)",  text: "var(--chip-violet-text)" },
  { id: "teal",    bg: "var(--chip-teal-bg)",    border: "var(--chip-teal-text)",    text: "var(--chip-teal-text)" },
  { id: "fuchsia", bg: "var(--chip-fuchsia-bg)", border: "var(--chip-fuchsia-text)", text: "var(--chip-fuchsia-text)" },
  { id: "coral",   bg: "var(--chip-coral-bg)",   border: "var(--chip-coral-text)",   text: "var(--chip-coral-text)" },
  { id: "ochre",   bg: "var(--chip-ochre-bg)",   border: "var(--chip-ochre-text)",   text: "var(--chip-ochre-text)" },
  { id: "slate",   bg: "var(--chip-slate-bg)",   border: "var(--chip-slate-text)",   text: "var(--chip-slate-text)" },
] as const;

// Maps pre-existing palette ids (from before the chip-palette rework) onto
// their nearest replacement, so users' saved repo colours shift to a sensible
// hue instead of resetting to the default.
const LEGACY_COLOR_ID_ALIASES: Record<string, string> = {
  purple: "violet",
  blue: "slate",
  green: "teal",
  amber: "ochre",
  pink: "coral",
  cyan: "fuchsia",
};

function resolveColorId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  if (REPO_COLOR_PALETTE.some((c) => c.id === id)) return id;
  return LEGACY_COLOR_ID_ALIASES[id];
}

function getRepoColor(index: number) {
  return REPO_COLOR_PALETTE[index % REPO_COLOR_PALETTE.length];
}

/** Pick the first palette colour not yet used by any repo. Falls back to
 *  round-robin when every slot is taken. */
function pickNextRepoColorId(
  existingColors: Record<string, string>,
  repoCountForFallback: number,
): string {
  const used = new Set(
    Object.values(existingColors)
      .map((c) => resolveColorId(c))
      .filter((c): c is string => !!c),
  );
  const free = REPO_COLOR_PALETTE.find((c) => !used.has(c.id));
  if (free) return free.id;
  return REPO_COLOR_PALETTE[repoCountForFallback % REPO_COLOR_PALETTE.length].id;
}

function repoDisplayName(path: string, displayNames?: Record<string, string>): string {
  if (displayNames?.[path]) return displayNames[path];
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function repoAbbrev(path: string, displayNames?: Record<string, string>): string {
  const name = repoDisplayName(path, displayNames);
  if (name.length <= 14) return name;
  const words = name.split(/[_-]/);
  if (words.length <= 1) return name.slice(0, 12) + "…";
  return words[0] + "_" + words[words.length - 1];
}

/** Two-letter initials from the repo display name, e.g. "Florence Go" → "FG" */
function repoInitials(path: string, displayNames?: Record<string, string>): string {
  const name = repoDisplayName(path, displayNames);
  const words = name.split(/[\s_-]+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

interface RepoSelectorProps {
  repos: RepoEntry[];
  selectedRepos: string[];
  repoColors: Record<string, string>;
  repoDisplayNames: Record<string, string>;
  onToggleRepo: (path: string) => void;
  onRemoveRepo?: (path: string) => void;
  worktreeCountByRepo: Record<string, number>;
}

function RepoSelector({
  repos,
  selectedRepos,
  repoColors,
  repoDisplayNames,
  onToggleRepo,
  onRemoveRepo,
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
    const resolved = resolveColorId(repoColors[path]);
    const found = resolved ? REPO_COLOR_PALETTE.find((c) => c.id === resolved) : undefined;
    if (found) return found;
    const idx = repos.findIndex((r) => r.path === path);
    return getRepoColor(idx >= 0 ? idx : 0);
  }

  // With a single repo, render a static chip — no dropdown affordance needed.
  if (repos.length === 1) {
    const color = getColorForRepo(repos[0].path);
    return (
      <div className="relative flex-1 min-w-0">
        <div className="flex items-center gap-1.5 w-full px-2.5 py-1.5 rounded-[var(--radius-md)] border border-border-subtle bg-[rgba(255,255,255,0.02)]">
          <RepoChipMenu repoPath={repos[0].path}>
            <span
              className="text-[11px] font-medium px-1.5 py-px rounded-[3px]"
              style={{ background: color.bg, color: color.text }}
            >
              {repoAbbrev(repos[0].path, repoDisplayNames)}
            </span>
          </RepoChipMenu>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 rounded-[var(--radius-md)] border border-border-subtle bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-colors cursor-pointer"
      >
        <span className="flex gap-1 flex-1 flex-wrap items-center">
          {selectedRepos.map((path) => {
            const color = getColorForRepo(path);
            return (
              <RepoChipMenu key={path} repoPath={path}>
                <span
                  className="text-[11px] font-medium px-1.5 py-px rounded-[3px]"
                  style={{ background: color.bg, color: color.text }}
                >
                  {repoAbbrev(path, repoDisplayNames)}
                </span>
              </RepoChipMenu>
            );
          })}
        </span>
        {selectedRepos.length === 1 && repos.length > 1 && (
          <span className="text-2xs text-text-tertiary px-1.5 py-px rounded-full bg-bg-elevated border border-border-default">
            {repos.length} repos
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
              <div key={repo.path} className="group/repo relative">
                <button
                  type="button"
                  onClick={() => onToggleRepo(repo.path)}
                  className={[
                    "flex items-center gap-2 w-full px-2.5 py-1.5 text-left cursor-pointer transition-colors",
                    isSelected ? "bg-[rgba(255,255,255,0.03)]" : "hover:bg-bg-hover",
                    onRemoveRepo ? "pr-7" : "",
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
                    {repoDisplayName(repo.path, repoDisplayNames)}
                  </span>
                  {repo.mode !== "branch" && (
                    <span className="text-2xs text-text-tertiary flex-shrink-0">
                      {count} worktree{count !== 1 ? "s" : ""}
                    </span>
                  )}
                </button>
                {onRemoveRepo && (
                  // Sibling of the row <button>, not a descendant, so no
                  // stopPropagation needed — the row's onClick can't fire.
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onRemoveRepo(repo.path);
                    }}
                    className="absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 group-hover/repo:opacity-100 focus:opacity-100 p-0.5 rounded hover:bg-[rgba(255,255,255,0.08)] text-text-tertiary hover:text-text-secondary transition-all"
                    title="Remove repository"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Short badge label for a repo. Prefers the user's custom `repoShortLabels`
 *  override; falls back to auto-generated 2-letter initials of the display name. */
function repoBadgeLabel(
  path: string,
  displayNames?: Record<string, string>,
  shortLabels?: Record<string, string>,
): string {
  const custom = shortLabels?.[path]?.trim();
  if (custom) return custom;
  return repoInitials(path, displayNames);
}

export {
  RepoSelector,
  REPO_COLOR_PALETTE,
  LEGACY_COLOR_ID_ALIASES,
  resolveColorId,
  getRepoColor,
  pickNextRepoColorId,
  repoDisplayName,
  repoAbbrev,
  repoInitials,
  repoBadgeLabel,
};

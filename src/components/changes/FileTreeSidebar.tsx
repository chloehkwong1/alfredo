import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CommitList } from "./CommitList";
import type { CommitInfo, DiffFile } from "../../types";

interface FileTreeSidebarProps {
  files: DiffFile[];
  visibleFilePath: string | null;
  onSelectFile: (path: string) => void;
  /** Commit mode props — when present, shows commit list above file tree */
  commits?: CommitInfo[];
  selectedCommitIndex?: number;
  onSelectCommit?: (index: number) => void;
}

const statusConfig: Record<
  DiffFile["status"],
  { label: string; color: string }
> = {
  added: { label: "A", color: "text-diff-added bg-diff-added/15" },
  modified: {
    label: "M",
    color: "text-accent-primary bg-accent-primary/15",
  },
  deleted: { label: "D", color: "text-diff-removed bg-diff-removed/15" },
  renamed: {
    label: "R",
    color: "text-status-waiting bg-status-waiting/15",
  },
};

interface DirectoryGroup {
  dir: string;
  files: DiffFile[];
}

function groupByDirectory(files: DiffFile[]): DirectoryGroup[] {
  const groups = new Map<string, DiffFile[]>();
  for (const file of files) {
    const lastSlash = file.path.lastIndexOf("/");
    const dir = lastSlash >= 0 ? file.path.slice(0, lastSlash + 1) : "";
    const existing = groups.get(dir) ?? [];
    existing.push(file);
    groups.set(dir, existing);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, files]) => ({ dir, files }));
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function FileTreeSidebar({
  files,
  visibleFilePath,
  onSelectFile,
  commits,
  selectedCommitIndex,
  onSelectCommit,
}: FileTreeSidebarProps) {
  const groups = useMemo(() => groupByDirectory(files), [files]);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  function toggleDir(dir: string) {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) {
        next.delete(dir);
      } else {
        next.add(dir);
      }
      return next;
    });
  }

  const showCommitList =
    commits && commits.length > 0 && onSelectCommit && selectedCommitIndex !== undefined;

  return (
    <div className="w-[220px] flex-shrink-0 border-l border-border-subtle bg-bg-secondary flex flex-col min-h-0">
      {/* Commit list (commit mode only) */}
      {showCommitList && (
        <CommitList
          commits={commits}
          selectedIndex={selectedCommitIndex}
          onSelect={onSelectCommit}
        />
      )}

      {/* File tree */}
      <div className="flex flex-col flex-1 min-h-0">
        <div className="px-3 py-2 text-xs font-semibold text-text-tertiary uppercase tracking-wider flex-shrink-0">
          Files
        </div>
        <div className="flex-1 overflow-y-auto">
          {groups.map((group) => {
            const isCollapsed = collapsedDirs.has(group.dir);
            return (
              <div key={group.dir}>
                {/* Directory header */}
                {group.dir && (
                  <button
                    type="button"
                    onClick={() => toggleDir(group.dir)}
                    className="w-full flex items-center gap-1 px-3 py-1 text-2xs text-text-tertiary hover:text-text-secondary cursor-pointer"
                  >
                    {isCollapsed ? (
                      <ChevronRight size={10} />
                    ) : (
                      <ChevronDown size={10} />
                    )}
                    <span className="truncate">{group.dir}</span>
                  </button>
                )}

                {/* Files in directory */}
                {!isCollapsed &&
                  group.files.map((file) => {
                    const isVisible = file.path === visibleFilePath;
                    const cfg = statusConfig[file.status];
                    const isDeleted = file.status === "deleted";

                    return (
                      <button
                        key={file.path}
                        type="button"
                        onClick={() => onSelectFile(file.path)}
                        className={[
                          "w-full flex items-center gap-2 py-1.5 text-left cursor-pointer transition-colors",
                          group.dir ? "pl-6 pr-3" : "px-3",
                          isVisible
                            ? "bg-bg-hover border-l-2 border-l-accent-primary"
                            : "border-l-2 border-l-transparent hover:bg-bg-hover/50",
                        ].join(" ")}
                      >
                        <span
                          className={[
                            "inline-flex items-center justify-center h-4 w-4 rounded text-2xs font-bold flex-shrink-0",
                            cfg.color,
                          ].join(" ")}
                        >
                          {cfg.label}
                        </span>
                        <span
                          className={[
                            "text-xs truncate flex-1",
                            isDeleted
                              ? "text-text-tertiary line-through opacity-60"
                              : "text-text-primary",
                          ].join(" ")}
                        >
                          {basename(file.path)}
                        </span>
                        <span className="text-2xs whitespace-nowrap flex-shrink-0">
                          {file.additions > 0 && (
                            <span className="text-diff-added">
                              +{file.additions}
                            </span>
                          )}
                          {file.additions > 0 && file.deletions > 0 && " "}
                          {file.deletions > 0 && (
                            <span className="text-diff-removed">
                              -{file.deletions}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { FileTreeSidebar };
export type { FileTreeSidebarProps };

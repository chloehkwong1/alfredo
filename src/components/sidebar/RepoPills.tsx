import { Plus } from "lucide-react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "../ui/ContextMenu";
import type { RepoEntry } from "../../types";

interface RepoPillsProps {
  repos: RepoEntry[];
  activeRepo: string | null;
  activeSessions: Record<string, boolean>;
  onSwitch: (path: string) => void;
  onAddRepo: () => void;
  onRemoveRepo: (path: string) => void;
}

function repoName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function RepoPills({
  repos,
  activeRepo,
  activeSessions,
  onSwitch,
  onAddRepo,
  onRemoveRepo,
}: RepoPillsProps) {
  return (
    <div className="relative">
      {/* Pill row */}
      <div
        className="flex items-center gap-[5px] px-3 py-2 overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
      >
        {repos.map((repo) => {
          const isActive = repo.path === activeRepo;
          const hasActive = activeSessions[repo.path] ?? false;
          return (
            <ContextMenu key={repo.path}>
              <ContextMenuTrigger asChild>
                <button
                  type="button"
                  onClick={() => onSwitch(repo.path)}
                  className={[
                    "inline-flex items-center gap-1 px-3.5 py-1 rounded-[5px] cursor-pointer",
                    "text-caption whitespace-nowrap flex-shrink-0",
                    "transition-colors duration-[var(--transition-fast)]",
                    isActive
                      ? "bg-accent-primary/20 border border-accent-primary/35 text-accent-primary font-semibold"
                      : "bg-bg-hover/50 text-text-tertiary hover:text-text-secondary border border-transparent",
                  ].join(" ")}
                >
                  {hasActive && (
                    <span className="w-[5px] h-[5px] rounded-full bg-status-idle flex-shrink-0" />
                  )}
                  {repoName(repo.path)}
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  className="text-red-400 data-[highlighted]:text-red-300"
                  onSelect={() => onRemoveRepo(repo.path)}
                >
                  Remove repository
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}

        {/* Add repo button */}
        <button
          type="button"
          onClick={onAddRepo}
          className="inline-flex items-center justify-center w-6 h-6 rounded-[4px] text-text-quaternary hover:text-text-tertiary hover:bg-bg-hover transition-colors flex-shrink-0 cursor-pointer"
          aria-label="Add repository"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export { RepoPills };

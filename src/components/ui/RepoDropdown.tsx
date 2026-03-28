import { ChevronDown, Check } from "lucide-react";
import type { RepoEntry } from "../../types";
import {
  REPO_COLOR_PALETTE,
  getRepoColor,
  repoDisplayName,
} from "../sidebar/RepoSelector";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "./DropdownMenu";

interface RepoDropdownProps {
  repos: RepoEntry[];
  selectedRepos: string[];
  repoColors: Record<string, string>;
  repoDisplayNames?: Record<string, string>;
  value: string;
  onChange: (repoPath: string) => void;
}

function getColorForRepo(
  path: string,
  repos: RepoEntry[],
  repoColors: Record<string, string>,
) {
  const colorId = repoColors[path];
  const found = REPO_COLOR_PALETTE.find((c) => c.id === colorId);
  if (found) return found;
  const idx = repos.findIndex((r) => r.path === path);
  return getRepoColor(idx >= 0 ? idx : 0);
}

function RepoDropdown({
  repos,
  selectedRepos,
  repoColors,
  repoDisplayNames,
  value,
  onChange,
}: RepoDropdownProps) {
  // Only render when multiple repos are selected
  if (selectedRepos.length <= 1) return null;

  const activeColor = getColorForRepo(value, repos, repoColors);

  return (
    <div>
      <label className="block text-xs font-medium text-text-secondary mb-2">
        Repository
      </label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-3 w-full h-9 px-3 rounded-[var(--radius-md)] border border-border-default bg-bg-elevated cursor-pointer text-[13px] font-medium text-text-primary transition-all duration-[var(--transition-fast)] hover:border-border-hover data-[state=open]:border-accent-primary/50 data-[state=open]:shadow-[0_0_0_1px_rgba(147,51,234,0.25)]"
          >
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{
                background: activeColor.text,
                boxShadow: `0 0 6px 1px ${activeColor.text}33`,
              }}
            />
            <span className="flex-1 text-left truncate">
              {repoDisplayName(value, repoDisplayNames)}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-text-tertiary" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
          <DropdownMenuLabel>Switch repository</DropdownMenuLabel>
          {selectedRepos.map((path) => {
            const color = getColorForRepo(path, repos, repoColors);
            const isSelected = path === value;
            return (
              <DropdownMenuItem
                key={path}
                onSelect={() => onChange(path)}
                className="gap-3"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: color.text }}
                />
                <span className="flex-1 truncate text-[13px]">
                  {repoDisplayName(path, repoDisplayNames)}
                </span>
                {isSelected && (
                  <Check className="h-3.5 w-3.5 text-accent-primary flex-shrink-0" />
                )}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export { RepoDropdown };

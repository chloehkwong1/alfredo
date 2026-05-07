import { ChevronDown, Check } from "lucide-react";
import type { RepoEntry } from "../../types";
import {
  REPO_COLOR_PALETTE,
  getRepoColor,
  repoDisplayName,
  resolveColorId,
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
  repoColors: Record<string, string>;
  repoDisplayNames?: Record<string, string>;
  value: string;
  onChange: (repoPath: string) => void;
  /** Compact pill variant: 28px tall, auto-width, used inline in dialog headers. */
  compact?: boolean;
}

function getColorForRepo(
  path: string,
  repos: RepoEntry[],
  repoColors: Record<string, string>,
) {
  const colorId = resolveColorId(repoColors[path]);
  const found = colorId ? REPO_COLOR_PALETTE.find((c) => c.id === colorId) : undefined;
  if (found) return found;
  const idx = repos.findIndex((r) => r.path === path);
  return getRepoColor(idx >= 0 ? idx : 0);
}

function RepoDropdown({
  repos,
  repoColors,
  repoDisplayNames,
  value,
  onChange,
  compact = false,
}: RepoDropdownProps) {
  const activeColor = getColorForRepo(value, repos, repoColors);

  const triggerClass = compact
    ? "inline-flex items-center gap-2 h-7 px-2.5 rounded-lg border border-border-default bg-bg-elevated cursor-pointer text-[13px] text-text-primary transition-colors duration-[var(--transition-fast)] hover:border-border-hover data-[state=open]:border-border-hover"
    : "flex items-center gap-3 w-full h-9 px-3 rounded-[var(--radius-md)] border border-border-default bg-bg-elevated cursor-pointer text-[13px] font-medium text-text-primary transition-all duration-[var(--transition-fast)] hover:border-border-hover data-[state=open]:border-accent-primary/50 data-[state=open]:shadow-[0_0_0_1px_rgba(147,51,234,0.25)]";

  return (
    <div className={compact ? "inline-block" : undefined}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={triggerClass}>
            <span
              className={compact ? "w-2 h-2 rounded-full flex-shrink-0" : "w-2.5 h-2.5 rounded-full flex-shrink-0"}
              style={{
                background: activeColor.bg,
                boxShadow: compact ? undefined : `0 0 6px 1px color-mix(in srgb, ${activeColor.bg} 20%, transparent)`,
              }}
            />
            <span className={compact ? "truncate" : "flex-1 text-left truncate"}>
              {repoDisplayName(value, repoDisplayNames)}
            </span>
            <ChevronDown className={compact ? "h-3 w-3 text-text-tertiary" : "h-3.5 w-3.5 text-text-tertiary"} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
          <DropdownMenuLabel>Switch repository</DropdownMenuLabel>
          {repos.map(({ path }) => {
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
                  style={{ background: color.bg }}
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

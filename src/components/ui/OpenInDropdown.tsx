import { useCallback } from "react";
import { ExternalLink, FolderOpen, Code, TerminalSquare, GitBranch, ChevronDown, Copy } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./DropdownMenu";
import { useInstalledApps } from "../../hooks/useInstalledApps";
import { openInApp, type InstalledApp } from "../../api";

const CATEGORY_ICON: Record<string, typeof FolderOpen> = {
  "file-manager": FolderOpen,
  editor: Code,
  terminal: TerminalSquare,
  git: GitBranch,
};

interface OpenInDropdownProps {
  worktreePath: string | undefined;
}

export function OpenInDropdown({ worktreePath }: OpenInDropdownProps) {
  const apps = useInstalledApps();

  const handleSelect = useCallback(
    (appId: string) => {
      if (!worktreePath) return;
      openInApp(appId, worktreePath).catch((e) =>
        console.error(`Failed to open in ${appId}:`, e),
      );
    },
    [worktreePath],
  );

  const handleCopy = useCallback(() => {
    if (!worktreePath) return;
    navigator.clipboard.writeText(worktreePath).catch(console.error);
  }, [worktreePath]);

  // Group apps by category, maintaining original order
  const groups: InstalledApp[][] = [];
  let lastCategory = "";
  for (const app of apps) {
    if (app.category !== lastCategory) {
      groups.push([]);
      lastCategory = app.category;
    }
    groups[groups.length - 1].push(app);
  }

  // Number items sequentially across groups
  let itemNumber = 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-text-secondary bg-bg-hover border border-border-default rounded-[var(--radius-sm)] hover:text-text-primary hover:border-border-hover transition-colors cursor-pointer"
        >
          <ExternalLink size={11} />
          Open in
          <ChevronDown size={9} className="opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="min-w-[180px]">
        {groups.map((group, gi) => {
          const items = group.map((app) => {
            itemNumber++;
            const num = itemNumber;
            const Icon = CATEGORY_ICON[app.category] ?? ExternalLink;
            return (
              <DropdownMenuItem
                key={app.id}
                onSelect={() => handleSelect(app.id)}
              >
                <Icon size={14} />
                <span className="flex-1">{app.name}</span>
                <span className="text-[10px] text-text-tertiary ml-3">{num}</span>
              </DropdownMenuItem>
            );
          });
          return (
            <div key={group[0].id}>
              {gi > 0 && <DropdownMenuSeparator />}
              {items}
            </div>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleCopy}>
          <Copy size={14} />
          <span className="flex-1">Copy path</span>
          <span className="text-[10px] text-text-tertiary ml-3">⌘⇧C</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

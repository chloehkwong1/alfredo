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

export const CATEGORY_ICON: Record<string, typeof FolderOpen> = {
  "file-manager": FolderOpen,
  editor: Code,
  terminal: TerminalSquare,
  git: GitBranch,
};

interface OpenInDropdownProps {
  worktreePath: string | undefined;
  linearTicketUrl?: string;
}

export function OpenInDropdown({ worktreePath, linearTicketUrl }: OpenInDropdownProps) {
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
            const Icon = CATEGORY_ICON[app.category] ?? ExternalLink;
            return (
              <DropdownMenuItem
                key={app.id}
                onSelect={() => handleSelect(app.id)}
              >
                <Icon size={14} />
                {app.name}
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
        {linearTicketUrl && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => window.open(linearTicketUrl, "_blank")}>
              <ExternalLink size={14} />
              Linear
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleCopy}>
          <Copy size={14} />
          <span className="flex-1">Copy path</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

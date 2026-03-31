import { useMemo, useState, useCallback } from "react";
import { Command } from "cmdk";
import { Clock } from "lucide-react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useAppConfig } from "../../hooks/useAppConfig";
import { useCommandRegistry, type GroupedCommands } from "./useCommandRegistry";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const RECENT_STORAGE_KEY = "alfredo:recent-commands";
const MAX_RECENT = 20;
const RECENT_DISPLAY_COUNT = 5;

function getRecentCommandIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { id: string; ts: number }[];
    return parsed.sort((a, b) => b.ts - a.ts).map((e) => e.id);
  } catch {
    return [];
  }
}

function trackCommand(id: string): void {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    let entries: { id: string; ts: number }[] = raw ? JSON.parse(raw) : [];
    entries = entries.filter((e) => e.id !== id);
    entries.unshift({ id, ts: Date.now() });
    if (entries.length > MAX_RECENT) entries.length = MAX_RECENT;
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // ignore storage errors
  }
}

const itemClass =
  "flex items-center gap-3 px-3 py-2 text-sm text-text-secondary rounded-[var(--radius-md)] cursor-pointer data-[selected=true]:bg-bg-hover data-[selected=true]:text-text-primary";

const groupHeadingClass =
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-text-tertiary";

function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const activeWorktreeId = useWorkspaceStore((s) => s.activeWorktreeId);
  const { repos, repoDisplayNames, switchRepo } = useAppConfig();
  const deps = useMemo(() => ({ repos, repoDisplayNames, switchRepo }), [repos, repoDisplayNames, switchRepo]);
  const groups = useCommandRegistry(activeWorktreeId, deps);
  const [search, setSearch] = useState("");

  // Build a flat lookup of all commands for recent resolution
  const allCommands = useMemo(() => {
    const map = new Map<string, GroupedCommands["commands"][number]>();
    for (const group of groups) {
      for (const cmd of group.commands) {
        map.set(cmd.id, cmd);
      }
    }
    return map;
  }, [groups]);

  // Recent group: only when search is empty
  const recentGroup: GroupedCommands | null = useMemo(() => {
    if (search) return null;
    const recentIds = getRecentCommandIds().slice(0, RECENT_DISPLAY_COUNT);
    const recentCmds = recentIds
      .map((id) => allCommands.get(id))
      .filter((cmd): cmd is NonNullable<typeof cmd> => !!cmd);
    if (recentCmds.length === 0) return null;
    return { category: "actions", label: "Recent", commands: recentCmds };
  }, [search, allCommands]);

  const handleSelect = useCallback(
    (cmd: GroupedCommands["commands"][number]) => {
      trackCommand(cmd.id);
      cmd.action();
      onOpenChange(false);
    },
    [onOpenChange],
  );

  // Reset search when closing
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) setSearch("");
      onOpenChange(next);
    },
    [onOpenChange],
  );

  return (
    <RadixDialog.Root open={open} onOpenChange={handleOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className="fixed inset-0 z-50 bg-black/60"
          style={{ animation: "var(--transition-fast)" }}
        />
        <RadixDialog.Content
          className="fixed left-1/2 top-[20%] z-50 -translate-x-1/2 w-[560px] rounded-[var(--radius-lg)] border border-border-default shadow-lg overflow-hidden focus:outline-none"
          style={{ backgroundColor: "var(--bg-secondary)" }}
        >
          <Command
            className="flex flex-col"
            label="Command palette"
          >
            <div className="flex items-center border-b border-border-default px-4">
              <Command.Input
                placeholder="Type a command..."
                className="flex-1 h-12 bg-transparent text-[15px] text-text-primary placeholder:text-text-tertiary outline-none border-none"
                value={search}
                onValueChange={setSearch}
              />
            </div>
            <Command.List className="max-h-[360px] overflow-y-auto p-2">
              <Command.Empty className="py-8 text-center text-sm text-text-tertiary">
                No results found.
              </Command.Empty>

              {recentGroup && (
                <Command.Group
                  heading={recentGroup.label}
                  className={groupHeadingClass}
                >
                  {recentGroup.commands.map((cmd) => {
                    const Icon = cmd.icon;
                    return (
                      <Command.Item
                        key={`recent-${cmd.id}`}
                        className={itemClass}
                        value={`recent ${cmd.label}`}
                        onSelect={() => handleSelect(cmd)}
                      >
                        {Icon ? (
                          <Icon className="h-4 w-4 flex-shrink-0 text-text-tertiary" />
                        ) : (
                          <Clock className="h-4 w-4 flex-shrink-0 text-text-tertiary" />
                        )}
                        <span className="flex-1">{cmd.label}</span>
                        {cmd.shortcut && (
                          <kbd className="bg-bg-elevated text-text-tertiary text-xs px-1.5 py-0.5 rounded">
                            {cmd.shortcut}
                          </kbd>
                        )}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              )}

              {groups.map((group, i) => (
                <Command.Group
                  key={group.category}
                  heading={group.label}
                  className={`${i > 0 || recentGroup ? "mt-2 " : ""}${groupHeadingClass}`}
                >
                  {group.commands.map((cmd) => {
                    const Icon = cmd.icon;
                    return (
                      <Command.Item
                        key={cmd.id}
                        className={itemClass}
                        value={cmd.label}
                        onSelect={() => handleSelect(cmd)}
                      >
                        {Icon && <Icon className="h-4 w-4 flex-shrink-0 text-text-tertiary" />}
                        <span className="flex-1">{cmd.label}</span>
                        {cmd.tag && (
                          <span className="text-[10px] text-text-tertiary bg-bg-elevated px-1.5 py-0.5 rounded">
                            {cmd.tag}
                          </span>
                        )}
                        {cmd.shortcut && (
                          <kbd className="bg-bg-elevated text-text-tertiary text-xs px-1.5 py-0.5 rounded">
                            {cmd.shortcut}
                          </kbd>
                        )}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export { CommandPalette };

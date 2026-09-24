import { X } from "lucide-react";
import type { KanbanColumn } from "../../types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { COLUMN_ORDER, columnLabel, columnIcon } from "./StatusGroup";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui/DropdownMenu";

interface SelectionBarProps {
  onMove: (ids: string[], column: KanbanColumn) => void;
  onArchive: (ids: string[]) => void;
  onPin: (ids: string[]) => void;
  onUnpin: (ids: string[]) => void;
  onMarkRead: (ids: string[]) => void;
  onMarkUnread: (ids: string[]) => void;
}

export function SelectionBar(props: SelectionBarProps) {
  const selectedWorktreeIds = useWorkspaceStore((s) => s.selectedWorktreeIds);
  const selectionColumn = useWorkspaceStore((s) => s.selectionColumn);
  const clearWorktreeSelection = useWorkspaceStore((s) => s.clearWorktreeSelection);

  const ids = [...selectedWorktreeIds];
  if (ids.length === 0 || !selectionColumn) return null;

  const targets = COLUMN_ORDER.filter((c) => c !== selectionColumn);

  return (
    <div className="mx-2 mb-2 flex items-center gap-2 rounded-md border border-border-subtle bg-bg-elevated px-2.5 py-2 shadow-lg">
      <span className="min-w-0 truncate text-2xs tabular-nums font-semibold text-text-primary">
        {ids.length} selected
      </span>
      <span className="flex-1" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Move to column"
            className="whitespace-nowrap shrink-0 text-2xs text-text-secondary hover:text-text-primary cursor-pointer rounded px-1.5 py-0.5 hover:bg-hover-wash"
          >
            Move
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {targets.map((col) => {
            const Icon = columnIcon[col];
            return (
              <DropdownMenuItem key={col} onSelect={() => props.onMove(ids, col)}>
                <Icon className="h-3.5 w-3.5 mr-2" />
                {columnLabel[col]}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More bulk actions"
            className="whitespace-nowrap shrink-0 text-2xs text-text-secondary hover:text-text-primary cursor-pointer rounded px-1.5 py-0.5 hover:bg-hover-wash"
          >
            ⋯
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => props.onArchive(ids)}>
            Archive {ids.length} worktree{ids.length === 1 ? "" : "s"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => props.onPin(ids)}>Pin</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => props.onUnpin(ids)}>Unpin</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => props.onMarkRead(ids)}>Mark read</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => props.onMarkUnread(ids)}>Mark unread</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        onClick={clearWorktreeSelection}
        aria-label="Clear selection"
        className="whitespace-nowrap shrink-0 text-text-tertiary hover:text-text-primary cursor-pointer"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

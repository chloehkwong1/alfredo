import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  X,
  Terminal,
  Sparkles,
  Play,
  GitCompareArrows,
  Square,
  ExternalLink,
  PanelRight,
  PanelBottom,
  Radio,
} from "lucide-react";
import { IconButton } from "../ui/IconButton";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../ui/DropdownMenu";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ui/ContextMenu";
import { useTabStore } from "../../stores/tabStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { lifecycleManager } from "../../services/lifecycleManager";
import type { TabType, WorkspaceTab } from "../../types";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";

const TAB_ICONS: Record<TabType, typeof Terminal> = {
  claude: Sparkles,
  shell: Terminal,
  server: Radio,
  changes: GitCompareArrows,
};

interface PaneTabBarProps {
  paneId: string;
  worktreeId: string;
  isActivePane: boolean;
  onToggleServer?: () => void;
  isServerRunning?: boolean;
  runScriptName?: string;
  runScriptUrl?: string;
}

function SortableTab({
  tab,
  isActive,
  canClose,
  worktreeId,
  paneId,
  onClose,
  onSplit,
}: {
  tab: WorkspaceTab;
  isActive: boolean;
  canClose: boolean;
  worktreeId: string;
  paneId: string;
  onClose: (e: React.MouseEvent, tabId: string) => void;
  onSplit: (tabId: string, direction: "horizontal" | "vertical") => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  const Icon = TAB_ICONS[tab.type];
  const setPaneActiveTab = useLayoutStore((s) => s.setPaneActiveTab);
  const setActivePaneId = useLayoutStore((s) => s.setActivePaneId);
  const setActiveTabId = useTabStore((s) => s.setActiveTabId);

  const layout = useLayoutStore((s) => s.layout[worktreeId]);
  const pane = useLayoutStore((s) => s.panes[worktreeId]?.[paneId]);
  const canSplit = (pane?.tabIds.length ?? 0) > 1 && layout?.type === "leaf";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          ref={setNodeRef}
          style={style}
          {...attributes}
          {...listeners}
          type="button"
          onClick={() => {
            setPaneActiveTab(worktreeId, paneId, tab.id);
            setActivePaneId(worktreeId, paneId);
            setActiveTabId(worktreeId, tab.id);
          }}
          className={[
            "group h-full px-5 min-w-[80px] text-sm font-medium transition-colors cursor-pointer flex items-center gap-1.5 relative",
            isActive
              ? "text-text-primary"
              : "text-text-tertiary hover:text-text-secondary",
          ].join(" ")}
        >
          <Icon size={14} />
          <span>{tab.label}</span>
          {canClose && (
            <button
              type="button"
              tabIndex={0}
              aria-label={`Close ${tab.label} tab`}
              onClick={(e) => onClose(e, tab.id)}
              className="ml-0.5 opacity-0 group-hover:opacity-100 hover:bg-bg-tertiary rounded p-1 transition-opacity cursor-pointer"
            >
              <X size={12} />
            </button>
          )}
          {isActive && (
            <motion.div
              layoutId={`tab-underline-${paneId}`}
              className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent-primary"
              transition={{ type: "spring", stiffness: 500, damping: 35 }}
            />
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={!canSplit}
          onSelect={() => onSplit(tab.id, "horizontal")}
        >
          <PanelRight size={14} />
          Split Right
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!canSplit}
          onSelect={() => onSplit(tab.id, "vertical")}
        >
          <PanelBottom size={14} />
          Split Down
        </ContextMenuItem>
        {canClose && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={(e) => onClose(e as unknown as React.MouseEvent, tab.id)}>
              <X size={14} />
              Close Tab
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function PaneTabBar({
  paneId,
  worktreeId,
  isActivePane,
  onToggleServer,
  isServerRunning,
  runScriptName,
  runScriptUrl,
}: PaneTabBarProps) {
  const allTabs = useTabStore((s) => s.tabs);
  const tabs = allTabs[worktreeId] ?? [];
  const pane = useLayoutStore((s) => s.panes[worktreeId]?.[paneId]);
  const reorderTabs = useLayoutStore((s) => s.reorderTabs);
  const splitPane = useLayoutStore((s) => s.splitPane);
  const setActivePaneId = useLayoutStore((s) => s.setActivePaneId);

  const [dragActiveId, setDragActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const paneTabs = (pane?.tabIds ?? [])
    .map((id) => tabs.find((t) => t.id === id))
    .filter((t): t is WorkspaceTab => t != null);

  const activeTabId = pane?.activeTabId;

  const allClaudeCount = tabs.filter((t) => t.type === "claude").length;
  const allShellCount = tabs.filter((t) => t.type === "shell").length;

  function canClose(tab: WorkspaceTab) {
    if (tab.type === "claude" && allClaudeCount <= 1) return false;
    if (tab.type === "shell" && allShellCount <= 1) return false;
    if (tab.type === "changes") return false;
    return true;
  }

  function handleCloseTab(e: React.MouseEvent | Event, tabId: string) {
    if ("stopPropagation" in e) e.stopPropagation();
    lifecycleManager.removeTab(worktreeId, tabId);
  }

  function handleAddTab(type: TabType) {
    lifecycleManager.addTab(worktreeId, type, paneId);
  }

  function handleSplit(tabId: string, direction: "horizontal" | "vertical") {
    splitPane(worktreeId, paneId, tabId, direction);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const tabIds = pane?.tabIds ?? [];
    const fromIndex = tabIds.indexOf(active.id as string);
    const toIndex = tabIds.indexOf(over.id as string);
    if (fromIndex === -1 || toIndex === -1) return;

    reorderTabs(worktreeId, paneId, fromIndex, toIndex);
  }

  const draggedTab = dragActiveId ? paneTabs.find((t) => t.id === dragActiveId) : null;

  const terminalTabs = paneTabs.filter((t) => t.type in TAB_ICONS);
  const terminalTabIds = terminalTabs.map((t) => t.id);

  return (
    <div
      className={[
        "flex items-center w-full h-11 bg-bg-bar border-b flex-shrink-0",
        isActivePane ? "border-accent-primary/30" : "border-border-subtle",
      ].join(" ")}
      onClick={() => setActivePaneId(worktreeId, paneId)}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={({ active }) => setDragActiveId(active.id as string)}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragActiveId(null)}
      >
        <SortableContext
          items={terminalTabIds}
          strategy={horizontalListSortingStrategy}
        >
          {terminalTabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <SortableTab
                key={tab.id}
                tab={tab}
                isActive={isActive}
                canClose={canClose(tab)}
                worktreeId={worktreeId}
                paneId={paneId}
                onClose={handleCloseTab}
                onSplit={handleSplit}
              />
            );
          })}
        </SortableContext>

        <DragOverlay>
          {draggedTab && draggedTab.type in TAB_ICONS ? (
            <div className="px-3 py-1.5 bg-bg-elevated text-text-primary text-sm font-medium rounded-md shadow-lg flex items-center gap-1.5 rotate-2">
              {(() => { const Icon = TAB_ICONS[draggedTab.type]; return <Icon size={14} />; })()}
              <span>{draggedTab.label}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="h-11 px-3 text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer flex items-center"
          >
            <Plus size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => handleAddTab("claude")}>
            <Sparkles size={14} /> New Claude tab
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => handleAddTab("shell")}>
            <Terminal size={14} /> New terminal tab
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex-1" />

      {onToggleServer && runScriptName && (
        <div className="flex items-center">
          <AnimatePresence>
            {isServerRunning && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.15 }}
              >
                <IconButton
                  size="sm"
                  label={`Open ${runScriptUrl ?? "http://localhost:3000"}`}
                  onClick={() => openUrl(runScriptUrl ?? "http://localhost:3000")}
                  className="text-status-idle hover:text-text-primary"
                >
                  <ExternalLink />
                </IconButton>
              </motion.div>
            )}
          </AnimatePresence>
          <IconButton
            size="sm"
            label={isServerRunning ? `Stop ${runScriptName}` : `Start ${runScriptName}`}
            onClick={onToggleServer}
            className={
              isServerRunning
                ? "text-status-idle hover:text-red-400"
                : "text-text-tertiary hover:text-text-secondary"
            }
          >
            {isServerRunning ? <Square /> : <Play />}
          </IconButton>
        </div>
      )}
    </div>
  );
}

export { PaneTabBar };

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
  Combine,
  Bot,
  Hexagon,
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
  DropdownMenuSeparator,
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
import { useAgentStore } from "../../stores/agentStore";
import { lifecycleManager } from "../../services/lifecycleManager";
import { isAgentTab } from "../../types";
import type { TabType, WorkspaceTab } from "../../types";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState, useSyncExternalStore, type ReactNode } from "react";

// ── Cross-pane drag state (module-level pub/sub) ──
interface CrossPaneDrag {
  worktreeId: string;
  paneId: string;
  tabId: string;
}

let crossPaneDragState: CrossPaneDrag | null = null;
const crossPaneDragListeners = new Set<() => void>();

export function setCrossPaneDrag(state: CrossPaneDrag | null) {
  crossPaneDragState = state;
  crossPaneDragListeners.forEach((l) => l());
}

export function useCrossPaneDrag(): CrossPaneDrag | null {
  return useSyncExternalStore(
    (cb) => {
      crossPaneDragListeners.add(cb);
      return () => crossPaneDragListeners.delete(cb);
    },
    () => crossPaneDragState,
  );
}

const TAB_ICONS: Record<TabType, typeof Terminal> = {
  claude: Sparkles,
  codex: Bot,
  gemini: Hexagon,
  shell: Terminal,
  server: Radio,
  diff: GitCompareArrows,
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
  onMoveToSibling,
  isSplit,
  isPreview,
}: {
  tab: WorkspaceTab;
  isActive: boolean;
  canClose: boolean;
  worktreeId: string;
  paneId: string;
  onClose: (e: React.MouseEvent, tabId: string) => void;
  onSplit: (tabId: string, direction: "horizontal" | "vertical") => void;
  onMoveToSibling: (tabId: string) => void;
  isSplit: boolean;
  isPreview: boolean;
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
  const pinPreviewTab = useLayoutStore((s) => s.pinPreviewTab);

  const layout = useLayoutStore((s) => s.layout[worktreeId]);
  const pane = useLayoutStore((s) => s.panes[worktreeId]?.[paneId]);
  const canSplit = (pane?.tabIds.length ?? 0) > 1 && layout?.type === "leaf";

  const effectiveCanClose = canClose || tab.type === "diff";

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
          onDoubleClick={() => {
            if (isPreview) {
              pinPreviewTab(worktreeId, paneId);
            }
          }}
          className={[
            "group h-full px-3 text-sm font-medium transition-colors cursor-pointer flex items-center gap-1.5 relative",
            isActive
              ? "text-text-primary"
              : "text-text-tertiary hover:text-text-secondary",
          ].join(" ")}
        >
          <Icon size={14} />
          <span className={isPreview ? "italic opacity-80" : ""}>{tab.label}</span>
          <button
            type="button"
            tabIndex={effectiveCanClose ? 0 : -1}
            aria-label={`Close ${tab.label} tab`}
            onClick={(e) => effectiveCanClose && onClose(e, tab.id)}
            className={[
              "ml-0.5 rounded p-1 transition-opacity",
              effectiveCanClose
                ? "opacity-0 group-hover:opacity-100 hover:bg-bg-tertiary cursor-pointer"
                : "opacity-0 pointer-events-none",
            ].join(" ")}
          >
            <X size={12} />
          </button>
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
        {isSplit && (
          <ContextMenuItem onSelect={() => onMoveToSibling(tab.id)}>
            <Combine size={14} />
            Move to Other Pane
          </ContextMenuItem>
        )}
        {effectiveCanClose && (
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
  const moveTabToSiblingPane = useLayoutStore((s) => s.moveTabToSiblingPane);
  const layout = useLayoutStore((s) => s.layout[worktreeId]);
  const setActivePaneId = useLayoutStore((s) => s.setActivePaneId);

  const [dragActiveId, setDragActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const paneTabs = (pane?.tabIds ?? [])
    .map((id) => tabs.find((t) => t.id === id))
    .filter((t): t is WorkspaceTab => t != null);

  const activeTabId = pane?.activeTabId;

  const allAgentCount = tabs.filter((t) => isAgentTab(t)).length;
  const allShellCount = tabs.filter((t) => t.type === "shell").length;
  function canClose(tab: WorkspaceTab) {
    if (isAgentTab(tab) && allAgentCount <= 1) return false;
    if (tab.type === "shell" && allShellCount <= 1) return false;
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

  function handleMoveToSibling(tabId: string) {
    moveTabToSiblingPane(worktreeId, paneId, tabId);
  }

  const isSplit = layout?.type === "split";

  const availableAgents = useAgentStore((s) => s.availableAgents);

  const agentMenuItems: { type: TabType; agentId: string; label: string; icon: ReactNode }[] = [
    { type: "claude", agentId: "claudeCode", label: "Claude", icon: <Sparkles size={14} /> },
    { type: "codex", agentId: "codex", label: "Codex", icon: <Bot size={14} /> },
    { type: "gemini", agentId: "geminiCli", label: "Gemini", icon: <Hexagon size={14} /> },
  ];

  function handleDragStart(tabId: string) {
    setDragActiveId(tabId);
    if (isSplit) {
      setCrossPaneDrag({ worktreeId, paneId, tabId });
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const draggedTabId = dragActiveId;
    setDragActiveId(null);
    setCrossPaneDrag(null);

    const { active, over } = event;

    // Check for cross-pane drop first — closestCenter may return a same-pane
    // target even when the pointer is over the sibling pane, so we always
    // check elementsFromPoint when in a split layout.
    if (draggedTabId && isSplit) {
      const activatorEvent = event.activatorEvent as PointerEvent;
      const finalX = activatorEvent.clientX + event.delta.x;
      const finalY = activatorEvent.clientY + event.delta.y;
      const elements = document.elementsFromPoint(finalX, finalY);
      const targetEl = elements.find((el) => {
        const dropPaneId = (el as HTMLElement).dataset?.paneDropTarget;
        return dropPaneId && dropPaneId !== paneId;
      });
      if (targetEl) {
        moveTabToSiblingPane(worktreeId, paneId, draggedTabId);
        return;
      }
    }

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
        "flex items-center w-full h-11 bg-bg-bar border-b flex-shrink-0 relative",
        isActivePane ? "border-accent-primary/30" : "border-border-subtle",
      ].join(" ")}
      onClick={() => setActivePaneId(worktreeId, paneId)}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={({ active }) => handleDragStart(active.id as string)}
        onDragEnd={handleDragEnd}
        onDragCancel={() => { setDragActiveId(null); setCrossPaneDrag(null); }}
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
                onMoveToSibling={handleMoveToSibling}
                isSplit={isSplit}
                isPreview={pane?.previewTabId === tab.id}
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
          {agentMenuItems
            .filter((item) => availableAgents.includes(item.agentId))
            .map((item) => (
              <DropdownMenuItem key={item.type} onSelect={() => handleAddTab(item.type)}>
                {item.icon} New {item.label} tab
              </DropdownMenuItem>
            ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => handleAddTab("shell")}>
            <Terminal size={14} /> New terminal tab
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex-1" />

      {onToggleServer && runScriptName && (
        <div className="flex items-center gap-1 mr-2">
          <AnimatePresence>
            {isServerRunning && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.15 }}
              >
                <IconButton
                  size="md"
                  label={`Open in browser (${runScriptUrl ?? "http://localhost:3000"})`}
                  onClick={() => openUrl(runScriptUrl ?? "http://localhost:3000")}
                  className="text-text-secondary hover:text-text-primary bg-bg-tertiary/50 hover:bg-bg-tertiary"
                >
                  <ExternalLink />
                </IconButton>
              </motion.div>
            )}
          </AnimatePresence>
          <IconButton
            size="md"
            label={isServerRunning ? `Stop ${runScriptName}` : `Start ${runScriptName}`}
            onClick={onToggleServer}
            className={
              isServerRunning
                ? "text-red-400 hover:text-red-300 bg-red-400/10 hover:bg-red-400/20"
                : "text-green-500 hover:text-green-400 bg-green-500/10 hover:bg-green-500/20"
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

import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  X,
  Terminal,
  GitCompareArrows,
  Globe,
  ArrowUpRight,
  PanelRight,
  PanelBottom,
  Radio,
  Combine,
  NotebookPen,
  ChevronDown,
} from "lucide-react";
import { StartServerControl } from "../terminal/StartServerControl";
import { AGENT_ICONS } from "../icons/agents";
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
import { useSessionStatusStore } from "../../stores/sessionStatusStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { lifecycleManager } from "../../services/lifecycleManager";
import { isAgentTab } from "../../types";
import type { AgentState, TabType, WorkspaceTab } from "../../types";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type ComponentType } from "react";
import { GROUP_ORDER, GROUP_LABELS, getActiveGroup, getGroupForTab, getTabsInGroup, type TabGroupId } from "../../lib/tabGroups";
import { useAppConfigValue } from "../../stores/appConfigStore";

const SESSION_STATUS_DOT: Partial<Record<AgentState | "stale", { cls: string; label: string; pulse?: boolean }>> = {
  busy: { cls: "bg-status-busy", label: "Thinking" },
  stale: { cls: "bg-amber-400", label: "Unresponsive" },
  idle: { cls: "bg-status-idle", label: "Idle" },
  waitingForInput: { cls: "bg-accent-primary", label: "Waiting for input", pulse: true },
};

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

// Agent tabs (claude/codex/gemini) intentionally omit a type icon at render
// time — the OSC title each agent emits already starts with a brand glyph
// (e.g. Claude Code's ✱ prefix), so our own icon next to it would duplicate
// the shape at a different size. We still keep agents in TAB_ICONS so the
// `type in TAB_ICONS` membership check in the render filter treats them as
// valid tab types. Agent icons still render in the "+" menu below, where no
// dynamic label sits beside them.
const TAB_ICONS: Record<TabType, ComponentType<{ size?: number; className?: string }>> = {
  claude: AGENT_ICONS.claude,
  codex: AGENT_ICONS.codex,
  gemini: AGENT_ICONS.gemini,
  shell: Terminal,
  server: Radio,
  diff: GitCompareArrows,
  notes: NotebookPen,
};

const TAB_TYPE_LABELS: Record<TabType, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  shell: "Terminal",
  diff: "Diff",
  server: "Server",
  notes: "Notes",
};

interface PaneTabBarProps {
  paneId: string;
  worktreeId: string;
  isActivePane: boolean;
  onToggleServer?: () => void;
  isServerRunning?: boolean;
  runScriptName?: string;
  runScriptUrl?: string;
  assignedPort?: number | null;
}

function SortableTab({
  tab,
  isActive,
  canClose,
  worktreeId,
  paneId,
  onClose,
  onCloseOthers,
  onCloseToRight,
  hasOthersToClose,
  hasTabsToRightToClose,
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
  onCloseOthers: (tabId: string) => void;
  onCloseToRight: (tabId: string) => void;
  hasOthersToClose: boolean;
  hasTabsToRightToClose: boolean;
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
  const sessionStatus = useSessionStatusStore((s) => s.statuses[tab.id]);
  const staleBusy = useWorkspaceStore((s) => s.worktrees.find((w) => w.id === worktreeId)?.staleBusy);
  const effectiveStatus = sessionStatus === "busy" && staleBusy ? "stale" : sessionStatus;
  const statusDot = isAgentTab(tab) && effectiveStatus ? SESSION_STATUS_DOT[effectiveStatus] : undefined;
  const setPaneActiveTab = useLayoutStore((s) => s.setPaneActiveTab);
  const setActivePaneId = useLayoutStore((s) => s.setActivePaneId);
  const setActiveTabId = useTabStore((s) => s.setActiveTabId);
  const pinPreviewTab = useLayoutStore((s) => s.pinPreviewTab);

  const layout = useLayoutStore((s) => s.layout[worktreeId]);
  const pane = useLayoutStore((s) => s.panes[worktreeId]?.[paneId]);
  const canSplit = (pane?.tabIds.length ?? 0) > 1 && layout?.type === "leaf";

  const effectiveCanClose = canClose || tab.type === "diff";

  const effectiveLabel = tab.dynamicLabel ?? tab.label;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          data-tab-id={tab.id}
          {...attributes}
          {...listeners}
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
          {!isAgentTab(tab) && <Icon size={14} />}
          <span title={effectiveLabel} className={["max-w-[240px] truncate", isPreview ? "italic opacity-80" : ""].join(" ")}>{effectiveLabel}</span>
          {statusDot && (
            <span
              aria-label={statusDot.label}
              title={statusDot.label}
              className={[
                "h-1.5 w-1.5 rounded-full flex-shrink-0",
                statusDot.cls,
                statusDot.pulse ? "animate-pulse-dot" : "",
              ].join(" ")}
            />
          )}
          <button
            type="button"
            tabIndex={effectiveCanClose ? 0 : -1}
            aria-label={`Close ${effectiveLabel} tab`}
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
        </div>
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
        {(effectiveCanClose || hasOthersToClose || hasTabsToRightToClose) && (
          <>
            <ContextMenuSeparator />
            {effectiveCanClose && (
              <ContextMenuItem onSelect={(e) => onClose(e as unknown as React.MouseEvent, tab.id)}>
                <X size={14} />
                Close Tab
              </ContextMenuItem>
            )}
            <ContextMenuItem
              disabled={!hasOthersToClose}
              onSelect={() => onCloseOthers(tab.id)}
            >
              <X size={14} />
              Close Other Tabs
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!hasTabsToRightToClose}
              onSelect={() => onCloseToRight(tab.id)}
            >
              <X size={14} />
              Close Tabs to the Right
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function PinnedTab({
  tab,
  isActive,
  worktreeId,
  paneId,
}: {
  tab: WorkspaceTab;
  isActive: boolean;
  worktreeId: string;
  paneId: string;
}) {
  const setPaneActiveTab = useLayoutStore((s) => s.setPaneActiveTab);
  const setActivePaneId = useLayoutStore((s) => s.setActivePaneId);
  const setActiveTabId = useTabStore((s) => s.setActiveTabId);
  const Icon = TAB_ICONS[tab.type];
  const effectiveLabel = tab.dynamicLabel ?? tab.label;

  const activate = () => {
    setPaneActiveTab(worktreeId, paneId, tab.id);
    setActivePaneId(worktreeId, paneId);
    setActiveTabId(worktreeId, tab.id);
  };

  return (
    <div
      data-tab-id={tab.id}
      role="tab"
      tabIndex={0}
      aria-label={effectiveLabel}
      aria-selected={isActive}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      }}
      title={effectiveLabel}
      className={[
        "group h-full px-2.5 transition-colors cursor-pointer flex items-center relative flex-shrink-0",
        isActive
          ? "text-text-primary"
          : "text-text-tertiary hover:text-text-secondary",
      ].join(" ")}
    >
      <Icon size={14} />
      {isActive && (
        <motion.div
          layoutId={`tab-underline-${paneId}`}
          className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent-primary"
          transition={{ type: "spring", stiffness: 500, damping: 35 }}
        />
      )}
    </div>
  );
}

function GroupSwitcher({
  activeGroup,
  tabs,
  onSelect,
}: {
  activeGroup: TabGroupId;
  tabs: WorkspaceTab[];
  onSelect: (group: TabGroupId) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group h-full px-2.5 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors cursor-pointer flex items-center gap-1 flex-shrink-0"
          aria-label={`Switch tab group (current: ${GROUP_LABELS[activeGroup]})`}
        >
          {GROUP_LABELS[activeGroup]}
          <ChevronDown size={12} className="opacity-60 group-hover:opacity-100" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {GROUP_ORDER.map((g) => {
          const count = getTabsInGroup(tabs, g).length;
          return (
            <DropdownMenuItem key={g} onSelect={() => onSelect(g)}>
              <span className="flex-1">{GROUP_LABELS[g]}</span>
              <span className="text-text-tertiary text-xs ml-3">({count})</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EmptyGroupState({
  group,
  defaultAgent,
  runScriptName,
  isServerRunning,
  onToggleServer,
  onAddDefaultAgent,
  onAddShell,
}: {
  group: TabGroupId;
  defaultAgent: TabType;
  runScriptName: string | undefined;
  isServerRunning: boolean;
  onToggleServer: (() => void) | undefined;
  onAddDefaultAgent: () => void;
  onAddShell: () => void;
}) {
  const cls = "h-full px-3 text-sm text-text-tertiary flex items-center gap-2";
  const btn = "text-accent-primary hover:underline cursor-pointer";

  if (group === "agents") {
    return (
      <div className={cls}>
        <span>No agents —</span>
        <button type="button" className={btn} onClick={onAddDefaultAgent}>
          + Add {TAB_TYPE_LABELS[defaultAgent]}
        </button>
      </div>
    );
  }
  if (group === "terminals") {
    return (
      <div className={cls}>
        <span>No terminals —</span>
        <button type="button" className={btn} onClick={onAddShell}>
          + New terminal
        </button>
      </div>
    );
  }
  if (group === "server") {
    if (isServerRunning || !runScriptName || !onToggleServer) {
      return <div className={cls}>Server not running</div>;
    }
    return (
      <div className={cls}>
        <span>Server not running —</span>
        <button type="button" className={btn} onClick={onToggleServer}>
          Start {runScriptName}
        </button>
      </div>
    );
  }
  // files
  return (
    <div className={cls}>
      No diff open — open a file from the Changes panel
    </div>
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
  assignedPort,
}: PaneTabBarProps) {
  const allTabs = useTabStore((s) => s.tabs);
  const tabs = allTabs[worktreeId] ?? [];
  const pane = useLayoutStore((s) => s.panes[worktreeId]?.[paneId]);
  const reorderTabs = useLayoutStore((s) => s.reorderTabs);
  const splitPane = useLayoutStore((s) => s.splitPane);
  const moveTabToSiblingPane = useLayoutStore((s) => s.moveTabToSiblingPane);
  const layout = useLayoutStore((s) => s.layout[worktreeId]);
  const setActivePaneId = useLayoutStore((s) => s.setActivePaneId);
  const groupedTabs = useAppConfigValue((s) => s.config?.groupedTabs ?? true);
  const defaultAgent = useAppConfigValue((s) => s.config?.defaultAgent ?? "claude");
  const activeGroup = getActiveGroup(pane?.activeTabId, tabs);

  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(false);
  const prevTabCountRef = useRef(0);
  const lastActiveInGroupRef = useRef<Record<TabGroupId, string | undefined>>({
    agents: undefined,
    terminals: undefined,
    server: undefined,
    files: undefined,
  });

  useEffect(() => {
    const id = pane?.activeTabId;
    if (!id) return;
    const t = tabs.find((tab) => tab.id === id);
    if (!t) return;
    const g = getGroupForTab(t);
    if (g) {
      lastActiveInGroupRef.current[g] = id;
    }
  }, [pane?.activeTabId, tabs]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const paneTabs = (pane?.tabIds ?? [])
    .map((id) => tabs.find((t) => t.id === id))
    .filter((t): t is WorkspaceTab => t != null);

  const activeTabId = pane?.activeTabId;

  function handleCloseTab(e: React.MouseEvent | Event, tabId: string) {
    if ("stopPropagation" in e) e.stopPropagation();
    lifecycleManager.removeTab(worktreeId, tabId);
  }

  function removeTabs(ids: string[]) {
    for (const id of ids) {
      lifecycleManager
        .removeTab(worktreeId, id)
        .catch((e) => console.warn("[PaneTabBar] Failed to close tab:", id, e));
    }
  }

  function handleCloseOthers(tabId: string) {
    removeTabs(paneTabs.filter((t) => t.id !== tabId).map((t) => t.id));
  }

  function handleCloseToRight(tabId: string) {
    const idx = paneTabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    removeTabs(paneTabs.slice(idx + 1).map((t) => t.id));
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
    { type: "claude", agentId: "claudeCode", label: "Claude", icon: <AGENT_ICONS.claude size={14} /> },
    { type: "codex", agentId: "codex", label: "Codex", icon: <AGENT_ICONS.codex size={14} /> },
    { type: "gemini", agentId: "geminiCli", label: "Gemini", icon: <AGENT_ICONS.gemini size={14} /> },
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

  const visibleTabs = paneTabs.filter((t) => t.type in TAB_ICONS);
  const pinnedTabs = visibleTabs.filter((t) => t.type === "notes");
  const nonPinnedTabs = visibleTabs.filter((t) => t.type !== "notes");
  const sortableTabs = groupedTabs
    ? nonPinnedTabs.filter((t) => getGroupForTab(t) === activeGroup)
    : nonPinnedTabs;
  const sortableTabIds = sortableTabs.map((t) => t.id);
  const tabCount = visibleTabs.length;
  const lastTabId = tabCount > 0 ? visibleTabs[tabCount - 1].id : null;

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const update = () => {
      setShowLeftFade(el.scrollLeft > 0);
      setShowRightFade(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [tabCount]);

  useEffect(() => {
    if (!activeTabId) return;
    const el = scrollContainerRef.current?.querySelector(
      `[data-tab-id="${activeTabId}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeTabId]);

  useEffect(() => {
    if (tabCount > prevTabCountRef.current && lastTabId) {
      const el = scrollContainerRef.current?.querySelector(
        `[data-tab-id="${lastTabId}"]`,
      );
      el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
    prevTabCountRef.current = tabCount;
  }, [tabCount, lastTabId]);

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
        <div className="relative flex items-center h-full min-w-0">
          <div
            ref={scrollContainerRef}
            className="flex items-center h-full w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {pinnedTabs.map((tab) => (
              <PinnedTab
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                worktreeId={worktreeId}
                paneId={paneId}
              />
            ))}
            {groupedTabs && (
              <GroupSwitcher
                activeGroup={activeGroup}
                tabs={tabs}
                onSelect={(g) => {
                  const remembered = lastActiveInGroupRef.current[g];
                  const inGroup = getTabsInGroup(tabs, g);
                  const target =
                    (remembered && inGroup.find((t) => t.id === remembered)) ??
                    inGroup[0];
                  if (target) {
                    useLayoutStore.getState().setPaneActiveTab(worktreeId, paneId, target.id);
                    useLayoutStore.getState().setActivePaneId(worktreeId, paneId);
                    useTabStore.getState().setActiveTabId(worktreeId, target.id);
                  }
                  // Empty group is a no-op here; the empty state UI is handled at the bar level.
                }}
              />
            )}
            <SortableContext
              items={sortableTabIds}
              strategy={horizontalListSortingStrategy}
            >
              {sortableTabs.map((tab, tabIdx) => {
                const isActive = tab.id === activeTabId;
                return (
                  <SortableTab
                    key={tab.id}
                    tab={tab}
                    isActive={isActive}
                    canClose={true}
                    worktreeId={worktreeId}
                    paneId={paneId}
                    onClose={handleCloseTab}
                    onCloseOthers={handleCloseOthers}
                    onCloseToRight={handleCloseToRight}
                    hasOthersToClose={visibleTabs.length > 1}
                    hasTabsToRightToClose={tabIdx < sortableTabs.length - 1}
                    onSplit={handleSplit}
                    onMoveToSibling={handleMoveToSibling}
                    isSplit={isSplit}
                    isPreview={pane?.previewTabId === tab.id}
                  />
                );
              })}
            </SortableContext>
            {groupedTabs && sortableTabs.length === 0 && (
              <EmptyGroupState
                group={activeGroup}
                defaultAgent={defaultAgent}
                runScriptName={runScriptName}
                isServerRunning={!!isServerRunning}
                onToggleServer={onToggleServer}
                onAddDefaultAgent={() => handleAddTab(defaultAgent)}
                onAddShell={() => handleAddTab("shell")}
              />
            )}
          </div>
          <div
            aria-hidden
            className={[
              "absolute left-0 top-0 bottom-0 w-6 pointer-events-none bg-gradient-to-r from-bg-bar to-transparent transition-opacity duration-150",
              showLeftFade ? "opacity-100" : "opacity-0",
            ].join(" ")}
          />
          <div
            aria-hidden
            className={[
              "absolute right-0 top-0 bottom-0 w-6 pointer-events-none bg-gradient-to-l from-bg-bar to-transparent transition-opacity duration-150",
              showRightFade ? "opacity-100" : "opacity-0",
            ].join(" ")}
          />
        </div>

        <DragOverlay>
          {draggedTab ? (
            <div className="px-3 py-1.5 bg-bg-elevated text-text-primary text-sm font-medium rounded-md shadow-lg flex items-center gap-1.5 rotate-2">
              {!isAgentTab(draggedTab) && (() => {
                const Icon = TAB_ICONS[draggedTab.type];
                return <Icon size={14} />;
              })()}
              <span className="max-w-[240px] truncate">{draggedTab.dynamicLabel ?? draggedTab.label}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="h-11 px-3 ml-1 text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer flex items-center flex-shrink-0"
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

      {assignedPort && isServerRunning && !runScriptUrl && (
        <button
          type="button"
          onClick={() => openUrl(`http://localhost:${assignedPort}`)}
          className="inline-flex items-center gap-1.5 h-6 px-2 mr-2 rounded text-xs text-accent-primary bg-accent-primary/10 border border-accent-primary/20 hover:bg-accent-primary/15 hover:border-accent-primary/30 transition-colors cursor-pointer flex-shrink-0 whitespace-nowrap"
          title={`Open http://localhost:${assignedPort} in browser`}
        >
          <Globe size={12} />
          localhost:{assignedPort}
          <ArrowUpRight size={11} className="opacity-70" />
        </button>
      )}

      {onToggleServer && runScriptName && (
        <div className="flex items-center gap-1 mr-2 flex-shrink-0">
          <AnimatePresence>
            {isServerRunning && runScriptUrl && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.15 }}
              >
                <button
                  type="button"
                  onClick={() => openUrl(runScriptUrl)}
                  className="inline-flex items-center gap-1.5 h-6 px-2 rounded text-xs text-accent-primary bg-accent-primary/10 border border-accent-primary/20 hover:bg-accent-primary/15 hover:border-accent-primary/30 transition-colors cursor-pointer flex-shrink-0 whitespace-nowrap"
                  title={`Open ${runScriptUrl} in browser`}
                >
                  <Globe size={12} />
                  {runScriptUrl.replace(/^https?:\/\//, "")}
                  <ArrowUpRight size={11} className="opacity-70" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          <StartServerControl
            worktreeId={worktreeId}
            isServerRunning={!!isServerRunning}
            runScriptName={runScriptName}
            onToggleServer={onToggleServer}
          />
        </div>
      )}
    </div>
  );
}

export { PaneTabBar };

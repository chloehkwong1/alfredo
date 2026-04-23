import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  X,
  Terminal,
  Play,
  GitCompareArrows,
  Square,
  Globe,
  ArrowUpRight,
  PanelRight,
  PanelBottom,
  Radio,
  Combine,
} from "lucide-react";
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

  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(false);
  const prevTabCountRef = useRef(0);

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

  // Compute which tabIds in `candidates` are actually closable, preserving
  // the invariant that at least one agent tab and one shell tab must remain
  // in the worktree. Walks candidates in order and simulates removals.
  function eligibleToClose(candidates: WorkspaceTab[]): string[] {
    let remainingAgents = allAgentCount;
    let remainingShells = allShellCount;
    const result: string[] = [];
    for (const t of candidates) {
      if (isAgentTab(t)) {
        if (remainingAgents <= 1) continue;
        remainingAgents -= 1;
      } else if (t.type === "shell") {
        if (remainingShells <= 1) continue;
        remainingShells -= 1;
      }
      result.push(t.id);
    }
    return result;
  }

  function removeTabs(ids: string[]) {
    for (const id of ids) {
      lifecycleManager
        .removeTab(worktreeId, id)
        .catch((e) => console.warn("[PaneTabBar] Failed to close tab:", id, e));
    }
  }

  function handleCloseOthers(tabId: string) {
    const others = paneTabs.filter((t) => t.id !== tabId);
    removeTabs(eligibleToClose(others));
  }

  function handleCloseToRight(tabId: string) {
    const idx = paneTabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    removeTabs(eligibleToClose(paneTabs.slice(idx + 1)));
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

  const terminalTabs = paneTabs.filter((t) => t.type in TAB_ICONS);
  const terminalTabIds = terminalTabs.map((t) => t.id);
  const tabCount = terminalTabs.length;
  const lastTabId = tabCount > 0 ? terminalTabs[tabCount - 1].id : null;

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
            <SortableContext
              items={terminalTabIds}
              strategy={horizontalListSortingStrategy}
            >
              {terminalTabs.map((tab, tabIdx) => {
                const isActive = tab.id === activeTabId;
                const others = terminalTabs.filter((t) => t.id !== tab.id);
                const toRight = terminalTabs.slice(tabIdx + 1);
                return (
                  <SortableTab
                    key={tab.id}
                    tab={tab}
                    isActive={isActive}
                    canClose={canClose(tab)}
                    worktreeId={worktreeId}
                    paneId={paneId}
                    onClose={handleCloseTab}
                    onCloseOthers={handleCloseOthers}
                    onCloseToRight={handleCloseToRight}
                    hasOthersToClose={eligibleToClose(others).length > 0}
                    hasTabsToRightToClose={eligibleToClose(toRight).length > 0}
                    onSplit={handleSplit}
                    onMoveToSibling={handleMoveToSibling}
                    isSplit={isSplit}
                    isPreview={pane?.previewTabId === tab.id}
                  />
                );
              })}
            </SortableContext>
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

      {assignedPort && (
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
          <button
            type="button"
            aria-label={isServerRunning ? `Stop ${runScriptName}` : `Start ${runScriptName}`}
            onClick={onToggleServer}
            className={[
              "inline-flex items-center gap-1.5 h-6 px-2.5 rounded text-xs font-medium border transition-colors",
              isServerRunning
                ? "text-red-400 hover:text-red-300 bg-red-400/10 hover:bg-red-400/20 border-red-400/25"
                : "text-green-500 hover:text-green-400 bg-green-500/10 hover:bg-green-500/20 border-green-500/25",
            ].join(" ")}
          >
            {isServerRunning ? <Square size={10} fill="currentColor" /> : <Play size={10} fill="currentColor" />}
            {isServerRunning ? `Stop ${runScriptName}` : `Start ${runScriptName}`}
          </button>
        </div>
      )}
    </div>
  );
}

export { PaneTabBar };

import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  X,
  Terminal,
  GitCompareArrows,
  ListX,
  Globe,
  ArrowUpRight,
  PanelRight,
  PanelBottom,
  Radio,
  Combine,
  NotebookPen,
  Pencil,
  ChevronDown,
  ChevronRight,
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
  DropdownMenuLabel,
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
import { focusTerminalTab } from "../../services/agentMessenger";
import { isAgentTab } from "../../types";
import type { AgentState, TabType, WorkspaceTab } from "../../types";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type ComponentType } from "react";
import { partitionPaneTabs, effectiveTabLabel } from "../../lib/paneTabLayout";

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

/** Stable empty array so the tab-store selector doesn't allocate per render. */
const EMPTY_TABS: WorkspaceTab[] = [];

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
  compact = false,
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
  compact?: boolean;
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

  const updateTab = useTabStore((s) => s.updateTab);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const cancelledRef = useRef(false);

  function commitRename() {
    if (!renaming || cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    const trimmed = draft.trim();
    updateTab(worktreeId, tab.id, { customLabel: trimmed === "" ? undefined : trimmed });
    setRenaming(false);
  }

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

  const effectiveLabel = effectiveTabLabel(tab);

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
            focusTerminalTab(tab.id);
          }}
          onDoubleClick={() => {
            if (isPreview) {
              pinPreviewTab(worktreeId, paneId);
            }
          }}
          className={[
            `group h-full ${compact ? "px-2 text-xs" : "px-3 text-sm"} font-medium transition-colors cursor-pointer flex items-center gap-1.5 relative`,
            isActive
              ? "text-text-primary"
              : "text-text-tertiary hover:text-text-secondary",
          ].join(" ")}
        >
          {!isAgentTab(tab) && <Icon size={compact ? 12 : 14} />}
          {renaming ? (
            <input
              autoFocus
              value={draft}
              placeholder={tab.dynamicLabel ?? tab.label}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") {
                  cancelledRef.current = true;
                  setRenaming(false);
                }
              }}
              onBlur={commitRename}
              className="w-[140px] bg-bg-tertiary text-text-primary rounded px-1.5 py-0.5 outline-none border border-accent-primary/40"
            />
          ) : (
            <span title={effectiveLabel} className={["max-w-[240px] truncate", isPreview ? "italic opacity-80" : ""].join(" ")}>{effectiveLabel}</span>
          )}
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
        {tab.type !== "server" && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => {
                cancelledRef.current = false;
                setDraft(tab.customLabel ?? "");
                setRenaming(true);
              }}
            >
              <Pencil size={14} />
              Rename Tab…
            </ContextMenuItem>
          </>
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
  const effectiveLabel = effectiveTabLabel(tab);

  const activate = () => {
    setPaneActiveTab(worktreeId, paneId, tab.id);
    setActivePaneId(worktreeId, paneId);
    setActiveTabId(worktreeId, tab.id);
    focusTerminalTab(tab.id);
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
  const tabs = useTabStore((s) => s.tabs[worktreeId] ?? EMPTY_TABS);
  const pane = useLayoutStore((s) => s.panes[worktreeId]?.[paneId]);
  const splitPane = useLayoutStore((s) => s.splitPane);
  const moveTabToSiblingPane = useLayoutStore((s) => s.moveTabToSiblingPane);
  const layout = useLayoutStore((s) => s.layout[worktreeId]);
  const setActivePaneId = useLayoutStore((s) => s.setActivePaneId);
  const paneTabs = (pane?.tabIds ?? [])
    .map((id) => tabs.find((t) => t.id === id))
    .filter((t): t is WorkspaceTab => t != null);

  const { notes, agents, terminals, diffs } = partitionPaneTabs(paneTabs);
  const activeTabId = pane?.activeTabId;

  const collapsedRows = pane?.collapsedRows;
  const toggleRowCollapsed = useLayoutStore((s) => s.toggleRowCollapsed);
  const hasTerminals = terminals.length > 0;
  const hasDiffs = diffs.length > 0;
  const terminalsCollapsed = !!collapsedRows?.terminals;
  const diffsCollapsed = !!collapsedRows?.diffs;
  const activeInTerminals = terminals.some((t) => t.id === activeTabId);
  const activeInDiffs = diffs.some((t) => t.id === activeTabId);

  const sessionScrollRef = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const el = sessionScrollRef.current;
    if (!el) return;
    const measure = () => {
      setClipped(el.scrollWidth - el.scrollLeft - el.clientWidth > 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [agents.length]);

  const agentIds = agents.map((t) => t.id);
  const terminalIds = terminals.map((t) => t.id);
  const diffIds = diffs.map((t) => t.id);

  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const prevTabCountRef = useRef(0);

  const [bornPulse, setBornPulse] = useState(false);
  const prevHasDiffsRef = useRef(hasDiffs);
  useEffect(() => {
    // Pulse only when the diffs row first appears (a diff opens), not when an
    // already-present-but-collapsed row is expanded.
    if (hasDiffs && !prevHasDiffsRef.current) {
      setBornPulse(true);
      const timer = setTimeout(() => setBornPulse(false), 600);
      prevHasDiffsRef.current = hasDiffs;
      return () => clearTimeout(timer);
    }
    prevHasDiffsRef.current = hasDiffs;
  }, [hasDiffs]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

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

  function categoryFor(tabId: string): WorkspaceTab[] {
    if (diffIds.includes(tabId)) return diffs;
    if (terminalIds.includes(tabId)) return terminals;
    return agents;
  }

  function handleCloseOthers(tabId: string) {
    const scope = categoryFor(tabId);
    removeTabs(scope.filter((t) => t.id !== tabId).map((t) => t.id));
  }

  function handleCloseToRight(tabId: string) {
    const scope = categoryFor(tabId);
    const idx = scope.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    removeTabs(scope.slice(idx + 1).map((t) => t.id));
  }

  function handleCloseAllDiffs() {
    removeTabs(diffIds);
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

  function reorderWithinCategory(categoryIds: string[], activeId: string, overId: string) {
    const tabIds = pane?.tabIds ?? [];
    const from = categoryIds.indexOf(activeId);
    const to = categoryIds.indexOf(overId);
    if (from === -1 || to === -1) return;
    const next = [...categoryIds];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const inCat = new Set(categoryIds);
    let i = 0;
    const merged = tabIds.map((id) => (inCat.has(id) ? next[i++] : id));
    useLayoutStore.getState().setPaneTabIds(worktreeId, paneId, merged);
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

    const cat = categoryFor(active.id as string).map((t) => t.id);
    reorderWithinCategory(cat, active.id as string, over.id as string);
  }

  const draggedTab = dragActiveId ? paneTabs.find((t) => t.id === dragActiveId) : null;

  const tabCount = paneTabs.length;
  const lastTabId = tabCount > 0 ? paneTabs[tabCount - 1].id : null;

  // Auto-scroll the active tab into view across BOTH rows.
  useEffect(() => {
    if (!activeTabId) return;
    const el = barRef.current?.querySelector(
      `[data-tab-id="${activeTabId}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeTabId]);

  // Scroll a newly-appended tab into view.
  useEffect(() => {
    if (tabCount > prevTabCountRef.current && lastTabId) {
      const el = barRef.current?.querySelector(
        `[data-tab-id="${lastTabId}"]`,
      );
      el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
    prevTabCountRef.current = tabCount;
  }, [tabCount, lastTabId]);

  const serverControls = (
    <>
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
    </>
  );

  return (
    <div
      ref={barRef}
      className={[
        "flex flex-col w-full bg-bg-bar border-b flex-shrink-0 relative",
        isActivePane ? "border-accent-primary/30" : "border-border-subtle",
      ].join(" ")}
      onClick={() => setActivePaneId(worktreeId, paneId)}
    >
      {/* ── Row 1: sessions ── */}
      <div className="flex items-center w-full h-11 min-w-0">
        {notes && (
          <div className="flex items-center h-full flex-shrink-0 border-r border-border-subtle">
            <PinnedTab tab={notes} isActive={notes.id === activeTabId} worktreeId={worktreeId} paneId={paneId} />
          </div>
        )}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={({ active }) => handleDragStart(active.id as string)}
          onDragEnd={handleDragEnd}
          onDragCancel={() => { setDragActiveId(null); setCrossPaneDrag(null); }}
        >
          <div
            ref={sessionScrollRef}
            className="flex items-center h-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden min-w-0 relative"
          >
            <SortableContext items={agentIds} strategy={horizontalListSortingStrategy}>
              {agents.map((tab, i) => (
                <SortableTab
                  key={tab.id}
                  tab={tab}
                  isActive={tab.id === activeTabId}
                  canClose={true}
                  worktreeId={worktreeId}
                  paneId={paneId}
                  onClose={handleCloseTab}
                  onCloseOthers={handleCloseOthers}
                  onCloseToRight={handleCloseToRight}
                  hasOthersToClose={agents.length > 1}
                  hasTabsToRightToClose={i < agents.length - 1}
                  onSplit={handleSplit}
                  onMoveToSibling={handleMoveToSibling}
                  isSplit={isSplit}
                  isPreview={pane?.previewTabId === tab.id}
                />
              ))}
            </SortableContext>
            {clipped && (
              <div className="pointer-events-none sticky right-0 top-0 h-full w-8 flex-shrink-0 -ml-8 bg-gradient-to-l from-bg-bar to-transparent" />
            )}
          </div>
          <DragOverlay>
            {draggedTab ? (
              <div className="px-3 py-1.5 bg-bg-elevated text-text-primary text-sm font-medium rounded-md shadow-lg flex items-center gap-1.5 rotate-2">
                {!isAgentTab(draggedTab) && (() => {
                  const Icon = TAB_ICONS[draggedTab.type];
                  return <Icon size={14} />;
                })()}
                <span className="max-w-[240px] truncate">{effectiveTabLabel(draggedTab)}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* + new-session menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="h-11 px-3 ml-1 text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer flex items-center flex-shrink-0"
              aria-label="New tab"
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
            {availableAgents.includes("claudeCode") && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="font-normal">
                  Default Claude flags set in Settings
                </DropdownMenuLabel>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex-1" />
        {serverControls}
      </div>

      {/* ── Row 2: terminals — collapses in place to [chevron │ count] ── */}
      <div
        className={[
          "grid transition-[grid-template-rows] duration-150 ease-out",
          hasTerminals ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        ].join(" ")}
      >
        <div className="overflow-hidden min-h-0">
          {hasTerminals && (
            <div
              className={[
                "flex items-center w-full min-w-0 border-t border-border-subtle bg-bg-bar/90",
                terminalsCollapsed ? "h-[22px]" : "h-[30px]",
              ].join(" ")}
            >
              <button
                type="button"
                aria-label={terminalsCollapsed ? "Expand terminals row" : "Collapse terminals row"}
                onClick={(e) => { e.stopPropagation(); toggleRowCollapsed(worktreeId, paneId, "terminals"); }}
                className="h-full px-1.5 text-text-tertiary hover:text-text-secondary cursor-pointer flex items-center flex-shrink-0"
              >
                {terminalsCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              </button>
              <div className="w-px h-4 bg-border-subtle mr-1 flex-shrink-0" />
              {terminalsCollapsed ? (
                <button
                  type="button"
                  aria-label="Expand terminals row"
                  onClick={(e) => { e.stopPropagation(); toggleRowCollapsed(worktreeId, paneId, "terminals"); }}
                  className={[
                    "inline-flex items-center gap-1 h-full px-1 text-xs cursor-pointer relative flex-shrink-0",
                    activeInTerminals ? "text-text-primary" : "text-text-tertiary hover:text-text-secondary",
                  ].join(" ")}
                >
                  <Terminal size={12} />
                  {terminals.length}
                  {activeInTerminals && (
                    <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-accent-primary rounded" />
                  )}
                </button>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={({ active }) => handleDragStart(active.id as string)}
                  onDragEnd={handleDragEnd}
                  onDragCancel={() => { setDragActiveId(null); setCrossPaneDrag(null); }}
                >
                  <div className="flex items-center h-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden min-w-0">
                    <SortableContext items={terminalIds} strategy={horizontalListSortingStrategy}>
                      {terminals.map((tab, i) => (
                        <SortableTab
                          key={tab.id}
                          tab={tab}
                          isActive={tab.id === activeTabId}
                          canClose={true}
                          worktreeId={worktreeId}
                          paneId={paneId}
                          onClose={handleCloseTab}
                          onCloseOthers={handleCloseOthers}
                          onCloseToRight={handleCloseToRight}
                          hasOthersToClose={terminals.length > 1}
                          hasTabsToRightToClose={i < terminals.length - 1}
                          onSplit={handleSplit}
                          onMoveToSibling={handleMoveToSibling}
                          isSplit={isSplit}
                          isPreview={pane?.previewTabId === tab.id}
                          compact
                        />
                      ))}
                    </SortableContext>
                  </div>
                  <DragOverlay>
                    {draggedTab ? (
                      <div className="px-3 py-1.5 bg-bg-elevated text-text-primary text-sm font-medium rounded-md shadow-lg flex items-center gap-1.5 rotate-2">
                        {!isAgentTab(draggedTab) && (() => {
                          const Icon = TAB_ICONS[draggedTab.type];
                          return <Icon size={14} />;
                        })()}
                        <span className="max-w-[240px] truncate">{effectiveTabLabel(draggedTab)}</span>
                      </div>
                    ) : null}
                  </DragOverlay>
                </DndContext>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Row 3: diffs — collapses in place to [chevron │ count] ── */}
      <div
        className={[
          "grid transition-[grid-template-rows] duration-150 ease-out",
          hasDiffs ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          bornPulse ? "shadow-[inset_0_0_0_1px_var(--color-accent-primary)]" : "",
        ].join(" ")}
      >
        <div className="overflow-hidden min-h-0">
          {hasDiffs && (
          <div
            className={[
              "flex items-center w-full min-w-0 border-t border-border-subtle bg-bg-bar/90",
              diffsCollapsed ? "h-[22px]" : "h-[30px]",
            ].join(" ")}
          >
            <button
              type="button"
              aria-label={diffsCollapsed ? "Expand diffs row" : "Collapse diffs row"}
              onClick={(e) => { e.stopPropagation(); toggleRowCollapsed(worktreeId, paneId, "diffs"); }}
              className="h-full px-1.5 text-text-tertiary hover:text-text-secondary cursor-pointer flex items-center flex-shrink-0"
            >
              {diffsCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </button>
            <div className="w-px h-4 bg-border-subtle mr-1 flex-shrink-0" />
            {diffsCollapsed ? (
              <button
                type="button"
                aria-label="Expand diffs row"
                onClick={(e) => { e.stopPropagation(); toggleRowCollapsed(worktreeId, paneId, "diffs"); }}
                className={[
                  "inline-flex items-center gap-1 h-full px-1 text-xs cursor-pointer relative flex-shrink-0",
                  activeInDiffs ? "text-text-primary" : "text-text-tertiary hover:text-text-secondary",
                ].join(" ")}
              >
                <GitCompareArrows size={12} />
                {diffs.length}
                {activeInDiffs && (
                  <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-accent-primary rounded" />
                )}
              </button>
            ) : (
            <>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={({ active }) => handleDragStart(active.id as string)}
              onDragEnd={handleDragEnd}
              onDragCancel={() => { setDragActiveId(null); setCrossPaneDrag(null); }}
            >
              <div className="flex items-center h-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden min-w-0">
                <SortableContext items={diffIds} strategy={horizontalListSortingStrategy}>
                  {diffs.map((tab, i) => (
                    <SortableTab
                      key={tab.id}
                      tab={tab}
                      isActive={tab.id === activeTabId}
                      canClose={true}
                      worktreeId={worktreeId}
                      paneId={paneId}
                      onClose={handleCloseTab}
                      onCloseOthers={handleCloseOthers}
                      onCloseToRight={handleCloseToRight}
                      hasOthersToClose={diffs.length > 1}
                      hasTabsToRightToClose={i < diffs.length - 1}
                      onSplit={handleSplit}
                      onMoveToSibling={handleMoveToSibling}
                      isSplit={isSplit}
                      isPreview={pane?.previewTabId === tab.id}
                    />
                  ))}
                </SortableContext>
              </div>
              <DragOverlay>
                {draggedTab ? (
                  <div className="px-3 py-1.5 bg-bg-elevated text-text-primary text-sm font-medium rounded-md shadow-lg flex items-center gap-1.5 rotate-2">
                    {!isAgentTab(draggedTab) && (() => {
                      const Icon = TAB_ICONS[draggedTab.type];
                      return <Icon size={14} />;
                    })()}
                    <span className="max-w-[240px] truncate">{effectiveTabLabel(draggedTab)}</span>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
            {/* far-right pinned control */}
            <div className="flex-1" />
            <div className="w-px h-5 bg-border-subtle flex-shrink-0" />
            <button
              type="button"
              onClick={handleCloseAllDiffs}
              className="inline-flex items-center gap-1.5 h-[22px] px-2 mr-1 rounded text-xs text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors cursor-pointer flex-shrink-0"
              title="Close all changes"
            >
              <ListX size={13} />
              Close all
            </button>
            </>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { PaneTabBar };

import { useEffect, useRef } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { lifecycleManager } from "../../services/lifecycleManager";
import type { GlobalAppConfig, Worktree } from "../../types";

function useStatePersistence(
  config: GlobalAppConfig | null,
  worktrees: Worktree[],
  activeWorktreeId: string | null,
  updateConfig: (patch: Partial<GlobalAppConfig>) => void,
): void {
  // Restore sidebar collapsed state from app config (one-time)
  const sidebarRestored = useRef(false);
  useEffect(() => {
    if (!sidebarRestored.current && config?.sidebarCollapsed != null) {
      sidebarRestored.current = true;
      useWorkspaceStore.getState().setSidebarCollapsed(config.sidebarCollapsed);
    }
  }, [config]);

  // Save sidebar collapsed state to config on toggle
  useEffect(() => {
    if (!sidebarRestored.current) return;
    let prev = useWorkspaceStore.getState().sidebarCollapsed;
    const unsub = useWorkspaceStore.subscribe((state) => {
      if (state.sidebarCollapsed !== prev) {
        prev = state.sidebarCollapsed;
        updateConfig({ sidebarCollapsed: state.sidebarCollapsed });
      }
    });
    return unsub;
  }, [updateConfig]);

  // Restore active worktree from app config (one-time). Arms the
  // persistence subscriber even when nothing was restored — otherwise
  // users whose persisted id is null can never write a new selection
  // back to disk, and every restart starts with no active card.
  const worktreeRestored = useRef(false);
  useEffect(() => {
    if (worktreeRestored.current) return;
    if (!config || worktrees.length === 0) return;
    worktreeRestored.current = true;
    const persisted = config.activeWorktreeId;
    if (persisted && worktrees.some((wt) => wt.id === persisted)) {
      useWorkspaceStore.getState().setActiveWorktree(persisted);
    }
  }, [config, worktrees]);

  // Persist active worktree to config when it changes. The
  // worktreeRestored gate is read inside the subscriber so it picks up
  // the ref's live value on each store change — placing it outside
  // would freeze it at effect-mount time and never arm.
  useEffect(() => {
    let prev = useWorkspaceStore.getState().activeWorktreeId;
    const unsub = useWorkspaceStore.subscribe((state) => {
      if (!worktreeRestored.current) return;
      if (state.activeWorktreeId !== prev) {
        prev = state.activeWorktreeId;
        updateConfig({ activeWorktreeId: state.activeWorktreeId });
      }
    });
    return unsub;
  }, [updateConfig]);

  // Clean up layout state for removed worktrees (skip branch-mode IDs)
  const worktreeIds = worktrees.map((wt) => wt.id);
  useEffect(() => {
    const layoutState = useLayoutStore.getState();
    for (const wtId of Object.keys(layoutState.layout)) {
      if (!wtId.startsWith("branch::") && !worktreeIds.includes(wtId)) {
        layoutState.removeLayout(wtId);
      }
    }
  }, [JSON.stringify(worktreeIds)]);

  // Initialize layout for branch-mode repos when selected
  useEffect(() => {
    if (!activeWorktreeId?.startsWith("branch::")) return;
    const layoutState = useLayoutStore.getState();
    if (!layoutState.layout[activeWorktreeId]) {
      lifecycleManager.initWorktreeDefaults(activeWorktreeId);
    }
  }, [activeWorktreeId]);
}

export { useStatePersistence };

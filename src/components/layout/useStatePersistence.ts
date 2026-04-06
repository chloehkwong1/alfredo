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

  // Restore active worktree from app config (one-time)
  const worktreeRestored = useRef(false);
  useEffect(() => {
    if (worktreeRestored.current || !config?.activeWorktreeId) return;
    // Only restore once worktrees have loaded so the ID is valid
    if (worktrees.length > 0) {
      worktreeRestored.current = true;
      const exists = worktrees.some((wt) => wt.id === config.activeWorktreeId);
      if (exists) {
        useWorkspaceStore.getState().setActiveWorktree(config.activeWorktreeId!);
      }
    }
  }, [config, worktrees]);

  // Persist active worktree to config when it changes
  useEffect(() => {
    if (!worktreeRestored.current) return;
    let prev = useWorkspaceStore.getState().activeWorktreeId;
    const unsub = useWorkspaceStore.subscribe((state) => {
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

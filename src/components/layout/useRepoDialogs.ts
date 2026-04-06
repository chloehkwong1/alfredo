import { useState, useEffect, useCallback } from "react";
import { setRepoColor as setRepoColorApi, getConfig } from "../../api";
import { REPO_COLOR_PALETTE } from "../sidebar/RepoSelector";
import type { AppConfig, RepoMode, RepoEntry, GlobalAppConfig } from "../../types";

interface UseRepoDialogsParams {
  repos: RepoEntry[];
  repoColors: Record<string, string> | undefined;
  addRepo: (path: string) => Promise<GlobalAppConfig | null>;
  removeRepo: (path: string) => Promise<GlobalAppConfig>;
  updateRepoMode: (path: string, mode: RepoMode) => Promise<void>;
  switchRepo: (path: string) => Promise<void>;
}

interface UseRepoDialogsReturn {
  createDialogOpen: boolean;
  setCreateDialogOpen: (open: boolean) => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  addRepoModalOpen: boolean;
  setAddRepoModalOpen: (open: boolean) => void;
  setupDialogOpen: boolean;
  setSetupDialogOpen: (open: boolean) => void;
  setupRepoPath: string | null;
  removeDialogOpen: boolean;
  setRemoveDialogOpen: (open: boolean) => void;
  removeRepoPath: string | null;
  setRemoveRepoPath: (path: string | null) => void;
  previousRepoConfig: AppConfig | null;
  handleRepoSelected: (path: string) => Promise<void>;
  handleRepoConfigured: (result: { mode: RepoMode; selectedWorktreeIds?: string[] }) => Promise<void>;
  handleRemoveRepo: () => Promise<void>;
}

export function useRepoDialogs({
  repos,
  repoColors,
  addRepo,
  removeRepo,
  updateRepoMode,
  switchRepo,
}: UseRepoDialogsParams): UseRepoDialogsReturn {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Listen for command palette's "new worktree" event
  useEffect(() => {
    const handler = () => setCreateDialogOpen(true);
    window.addEventListener("alfredo:create-worktree", handler);
    return () => window.removeEventListener("alfredo:create-worktree", handler);
  }, []);

  // Dialog state for multi-repo lifecycle
  const [addRepoModalOpen, setAddRepoModalOpen] = useState(false);
  const [setupDialogOpen, setSetupDialogOpen] = useState(false);
  const [setupRepoPath, setSetupRepoPath] = useState<string | null>(null);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [removeRepoPath, setRemoveRepoPath] = useState<string | null>(null);
  const [previousRepoConfig, setPreviousRepoConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    if (!setupRepoPath || repos.length <= 1) {
      setPreviousRepoConfig(null);
      return;
    }
    const otherRepo = repos.find((r) => r.path !== setupRepoPath);
    if (otherRepo) {
      getConfig(otherRepo.path)
        .then(setPreviousRepoConfig)
        .catch(() => setPreviousRepoConfig(null));
    }
  }, [setupRepoPath, repos]);

  // When a new repo is selected (from welcome screen or add modal)
  const handleRepoSelected = useCallback(async (path: string) => {
    const result = await addRepo(path);
    if (result) {
      setAddRepoModalOpen(false);
      setSetupRepoPath(path);
      setSetupDialogOpen(true);
      if (!repoColors?.[path]) {
        const usedColors = Object.values(repoColors ?? {});
        const available = REPO_COLOR_PALETTE.find((c) => !usedColors.includes(c.id));
        const colorId = available?.id ?? REPO_COLOR_PALETTE[repos.length % REPO_COLOR_PALETTE.length].id;
        await setRepoColorApi(path, colorId);
      }
    }
  }, [addRepo, repoColors, repos]);

  // When repo setup is configured
  const handleRepoConfigured = useCallback(async (result: { mode: RepoMode; selectedWorktreeIds?: string[] }) => {
    if (!setupRepoPath) return;
    await updateRepoMode(setupRepoPath, result.mode);
    await switchRepo(setupRepoPath);
    setSetupDialogOpen(false);
    if (result.mode === "worktree" && !result.selectedWorktreeIds) {
      setCreateDialogOpen(true);
    }
    // If result has selectedWorktreeIds, worktrees will be loaded by useSessionRestore
    // when the repo becomes active — no extra action needed here.
    setSetupRepoPath(null);
  }, [setupRepoPath, updateRepoMode, switchRepo]);

  // When removing a repo
  const handleRemoveRepo = useCallback(async () => {
    if (!removeRepoPath) return;
    await removeRepo(removeRepoPath);
    setRemoveDialogOpen(false);
    setRemoveRepoPath(null);
  }, [removeRepoPath, removeRepo]);

  return {
    createDialogOpen,
    setCreateDialogOpen,
    commandPaletteOpen,
    setCommandPaletteOpen,
    addRepoModalOpen,
    setAddRepoModalOpen,
    setupDialogOpen,
    setSetupDialogOpen,
    setupRepoPath,
    removeDialogOpen,
    setRemoveDialogOpen,
    removeRepoPath,
    setRemoveRepoPath,
    previousRepoConfig,
    handleRepoSelected,
    handleRepoConfigured,
    handleRemoveRepo,
  };
}

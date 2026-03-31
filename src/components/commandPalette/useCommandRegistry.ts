import { useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import {
  GitBranch,
  MessageSquare,
  Terminal,
  Columns2,
  Rows2,
  PanelRight,
  PanelLeft,
  Settings,
  Keyboard,
  GitPullRequest,
  ExternalLink,
  RefreshCw,
  Wrench,
  FolderGit2,
  Copy,
  FolderOpen,
  Code,
  TerminalSquare,
} from "lucide-react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { usePrStore } from "../../stores/prStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { useTabStore } from "../../stores/tabStore";
import { lifecycleManager } from "../../services/lifecycleManager";
import { rerunFailedChecks, fixFailingChecks } from "../../services/prActions";
import { openInEditor, openInTerminal, getAppConfig } from "../../api";
import type { Worktree, CheckRun, RepoEntry } from "../../types";

const EMPTY_CHECK_RUNS: CheckRun[] = [];

export interface Command {
  id: string;
  label: string;
  category: "actions" | "navigation" | "worktrees" | "pr";
  shortcut?: string;
  icon?: LucideIcon;
  /** Optional suffix tag displayed after the label (e.g. repo name). */
  tag?: string;
  action: () => void;
  enabled: () => boolean;
}

const CATEGORY_LABELS: Record<Command["category"], string> = {
  actions: "Actions",
  navigation: "Navigation",
  worktrees: "Worktrees",
  pr: "Pull Request",
};

const CATEGORY_ORDER: Command["category"][] = ["actions", "navigation", "worktrees", "pr"];

function buildCommands(activeWorktreeId: string | null, activeWorktree?: Worktree): Command[] {
  return [
    // ── Actions ──
    {
      id: "new-worktree",
      label: "New worktree",
      category: "actions",
      shortcut: "⌘N",
      icon: GitBranch,
      action: () => window.dispatchEvent(new CustomEvent("alfredo:create-worktree")),
      enabled: () => true,
    },
    {
      id: "new-claude-tab",
      label: "New Claude tab",
      category: "actions",
      shortcut: "⌘T",
      icon: MessageSquare,
      action: () => {
        if (activeWorktreeId) {
          lifecycleManager.addTab(activeWorktreeId, "claude");
        }
      },
      enabled: () => !!activeWorktreeId,
    },
    {
      id: "new-terminal-tab",
      label: "New terminal tab",
      category: "actions",
      icon: Terminal,
      action: () => {
        if (activeWorktreeId) {
          lifecycleManager.addTab(activeWorktreeId, "shell");
        }
      },
      enabled: () => !!activeWorktreeId,
    },
    {
      id: "split-pane-right",
      label: "Split pane right",
      category: "actions",
      shortcut: "⌘\\",
      icon: Columns2,
      action: () => {
        if (!activeWorktreeId) return;
        const layoutState = useLayoutStore.getState();
        const activePaneId = layoutState.activePaneId[activeWorktreeId];
        if (!activePaneId) return;
        const pane = layoutState.panes[activeWorktreeId]?.[activePaneId];
        if (pane && pane.tabIds.length >= 2 && pane.activeTabId) {
          layoutState.splitPane(activeWorktreeId, activePaneId, pane.activeTabId, "horizontal");
        }
      },
      enabled: () => {
        if (!activeWorktreeId) return false;
        const layoutState = useLayoutStore.getState();
        const activePaneId = layoutState.activePaneId[activeWorktreeId];
        if (!activePaneId) return false;
        const pane = layoutState.panes[activeWorktreeId]?.[activePaneId];
        return !!(pane && pane.tabIds.length >= 2);
      },
    },
    {
      id: "split-pane-down",
      label: "Split pane down",
      category: "actions",
      shortcut: "⌘⇧\\",
      icon: Rows2,
      action: () => {
        if (!activeWorktreeId) return;
        const layoutState = useLayoutStore.getState();
        const activePaneId = layoutState.activePaneId[activeWorktreeId];
        if (!activePaneId) return;
        const pane = layoutState.panes[activeWorktreeId]?.[activePaneId];
        if (pane && pane.tabIds.length >= 2 && pane.activeTabId) {
          layoutState.splitPane(activeWorktreeId, activePaneId, pane.activeTabId, "vertical");
        }
      },
      enabled: () => {
        if (!activeWorktreeId) return false;
        const layoutState = useLayoutStore.getState();
        const activePaneId = layoutState.activePaneId[activeWorktreeId];
        if (!activePaneId) return false;
        const pane = layoutState.panes[activeWorktreeId]?.[activePaneId];
        return !!(pane && pane.tabIds.length >= 2);
      },
    },
    {
      id: "toggle-changes-panel",
      label: "Toggle changes panel",
      category: "actions",
      shortcut: "⌘⇧C",
      icon: PanelRight,
      action: () => {
        if (!activeWorktreeId) return;
        const wsState = useWorkspaceStore.getState();
        const current = wsState.changesPanelCollapsed[activeWorktreeId] ?? false;
        wsState.setChangesPanelCollapsed(activeWorktreeId, !current);
      },
      enabled: () => !!activeWorktreeId,
    },
    {
      id: "toggle-pr-panel",
      label: "Toggle PR panel",
      category: "actions",
      shortcut: "⌘I",
      icon: GitPullRequest,
      action: () => {
        if (!activeWorktreeId) return;
        const wsState = useWorkspaceStore.getState();
        const current = wsState.changesPanelCollapsed[activeWorktreeId] ?? false;
        wsState.setChangesPanelCollapsed(activeWorktreeId, !current);
      },
      enabled: () => !!activeWorktreeId,
    },
    {
      id: "toggle-sidebar",
      label: "Toggle sidebar",
      category: "actions",
      shortcut: "⌘B",
      icon: PanelLeft,
      action: () => useWorkspaceStore.getState().toggleSidebar(),
      enabled: () => true,
    },

    // ── Utility Actions ──
    {
      id: "copy-branch-name",
      label: "Copy branch name",
      category: "actions",
      icon: Copy,
      action: () => {
        if (activeWorktree) {
          navigator.clipboard.writeText(activeWorktree.branch);
        }
      },
      enabled: () => !!activeWorktree,
    },
    {
      id: "copy-pr-url",
      label: "Copy PR URL",
      category: "actions",
      icon: Copy,
      action: () => {
        if (activeWorktree?.prStatus) {
          navigator.clipboard.writeText(activeWorktree.prStatus.url);
        }
      },
      enabled: () => !!activeWorktree?.prStatus,
    },
    {
      id: "copy-worktree-path",
      label: "Copy worktree path",
      category: "actions",
      icon: Copy,
      action: () => {
        if (activeWorktree) {
          navigator.clipboard.writeText(activeWorktree.path);
        }
      },
      enabled: () => !!activeWorktree,
    },
    {
      id: "open-in-editor",
      label: "Open in editor",
      category: "actions",
      icon: Code,
      action: async () => {
        if (!activeWorktree) return;
        try {
          const appCfg = await getAppConfig();
          await openInEditor(activeWorktree.path, appCfg.preferredEditor, appCfg.customEditorPath ?? undefined);
        } catch (e) {
          console.error("Failed to open editor:", e);
        }
      },
      enabled: () => !!activeWorktree,
    },
    {
      id: "open-in-terminal",
      label: "Open in terminal",
      category: "actions",
      icon: TerminalSquare,
      action: async () => {
        if (!activeWorktree) return;
        try {
          const appCfg = await getAppConfig();
          await openInTerminal(activeWorktree.path, appCfg.preferredTerminal, appCfg.customTerminalPath ?? undefined);
        } catch (e) {
          console.error("Failed to open terminal:", e);
        }
      },
      enabled: () => !!activeWorktree,
    },
    {
      id: "open-in-finder",
      label: "Open in Finder",
      category: "actions",
      icon: FolderOpen,
      action: () => {
        if (activeWorktree) {
          revealItemInDir(activeWorktree.path);
        }
      },
      enabled: () => !!activeWorktree,
    },
    {
      id: "open-repo-github",
      label: "Open repo on GitHub",
      category: "actions",
      icon: ExternalLink,
      action: () => {
        if (activeWorktree?.prStatus) {
          // Derive repo URL from PR URL: https://github.com/owner/repo/pull/N → https://github.com/owner/repo
          const repoUrl = activeWorktree.prStatus.url.replace(/\/pull\/\d+$/, "");
          openUrl(repoUrl);
        }
      },
      enabled: () => !!activeWorktree?.prStatus,
    },

    // ── Navigation ──
    {
      id: "go-to-settings",
      label: "Go to settings",
      category: "navigation",
      icon: Settings,
      action: () => window.dispatchEvent(new CustomEvent("alfredo:settings-open")),
      enabled: () => true,
    },
    {
      id: "go-to-keyboard-shortcuts",
      label: "Keyboard shortcuts",
      category: "navigation",
      shortcut: "⌘?",
      icon: Keyboard,
      action: () => window.dispatchEvent(new CustomEvent("alfredo:shortcuts-overlay")),
      enabled: () => true,
    },
  ];
}

// ── Dynamic command builders ──────────────────────────────────────

function buildWorktreeCommands(
  worktrees: Worktree[],
  activeWorktreeId: string | null,
  isMultiRepo: boolean,
  repoDisplayNames: Record<string, string>,
): Command[] {
  return worktrees
    .filter((wt) => !wt.archived)
    .map((wt) => {
      const repoTag = isMultiRepo
        ? repoDisplayNames[wt.repoPath] ?? wt.repoPath.split("/").pop() ?? ""
        : undefined;
      return {
        id: `switch-worktree-${wt.id}`,
        label: wt.name || wt.branch,
        category: "worktrees" as const,
        icon: GitBranch,
        tag: repoTag,
        action: () => useWorkspaceStore.getState().setActiveWorktree(wt.id),
        enabled: () => wt.id !== activeWorktreeId,
      };
    });
}

function buildRepoCommands(
  repos: RepoEntry[],
  repoDisplayNames: Record<string, string>,
  switchRepo: (path: string) => Promise<void>,
): Command[] {
  if (repos.length < 2) return [];
  return repos.map((repo) => {
    const displayName = repoDisplayNames[repo.path] ?? repo.path.split("/").pop() ?? repo.path;
    return {
      id: `switch-repo-${repo.path}`,
      label: `Switch to ${displayName}`,
      category: "navigation" as const,
      icon: FolderGit2,
      action: () => { switchRepo(repo.path); },
      enabled: () => true,
    };
  });
}

function buildPrCommands(
  activeWorktree: Worktree | undefined,
  checkRuns: CheckRun[],
): Command[] {
  if (!activeWorktree?.prStatus) return [];

  const pr = activeWorktree.prStatus;
  const worktreeId = activeWorktree.id;
  const repoPath = activeWorktree.repoPath;

  const failedChecks = checkRuns.filter(
    (r) => r.status === "completed" && r.conclusion !== "success" && r.conclusion !== "skipped" && r.conclusion !== null,
  );

  const switchToClaudeTab = () => {
    const tabs = useTabStore.getState().tabs[worktreeId] ?? [];
    const claudeTab = tabs.find((t) => t.type === "claude");
    if (claudeTab) {
      useTabStore.getState().setActiveTabId(worktreeId, claudeTab.id);
    }
  };

  const commands: Command[] = [
    {
      id: "view-pr-github",
      label: "View PR on GitHub",
      category: "pr" as const,
      icon: ExternalLink,
      action: () => openUrl(pr.url),
      enabled: () => true,
    },
  ];

  if (failedChecks.length > 0) {
    commands.push({
      id: "rerun-failed-checks",
      label: "Rerun failed checks",
      category: "pr" as const,
      icon: RefreshCw,
      action: () => { rerunFailedChecks(repoPath, failedChecks); },
      enabled: () => true,
    });
    commands.push({
      id: "fix-with-agent",
      label: "Fix failing checks with agent",
      category: "pr" as const,
      icon: Wrench,
      action: async () => {
        const sent = await fixFailingChecks(worktreeId, repoPath, failedChecks);
        if (sent) switchToClaudeTab();
      },
      enabled: () => true,
    });
  }

  return commands;
}

export interface GroupedCommands {
  category: Command["category"];
  label: string;
  commands: Command[];
}

interface UseCommandRegistryDeps {
  repos: RepoEntry[];
  repoDisplayNames: Record<string, string>;
  switchRepo: (path: string) => Promise<void>;
}

export function useCommandRegistry(
  activeWorktreeId: string | null,
  deps?: UseCommandRegistryDeps,
): GroupedCommands[] {
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const checkRuns = usePrStore((s) => activeWorktreeId ? s.checkRuns[activeWorktreeId] ?? EMPTY_CHECK_RUNS : EMPTY_CHECK_RUNS);

  return useMemo(() => {
    const activeWorktree = worktrees.find((wt) => wt.id === activeWorktreeId);

    const staticCommands = buildCommands(activeWorktreeId, activeWorktree);

    const isMultiRepo = (deps?.repos.length ?? 0) >= 2;
    const worktreeCommands = buildWorktreeCommands(
      worktrees,
      activeWorktreeId,
      isMultiRepo,
      deps?.repoDisplayNames ?? {},
    );

    const repoCommands = deps
      ? buildRepoCommands(deps.repos, deps.repoDisplayNames, deps.switchRepo)
      : [];

    const prCommands = buildPrCommands(activeWorktree, checkRuns);

    const all = [...staticCommands, ...repoCommands, ...worktreeCommands, ...prCommands];
    const filtered = all.filter((cmd) => cmd.enabled());

    const grouped: GroupedCommands[] = [];
    for (const cat of CATEGORY_ORDER) {
      const cmds = filtered.filter((c) => c.category === cat);
      if (cmds.length > 0) {
        grouped.push({ category: cat, label: CATEGORY_LABELS[cat], commands: cmds });
      }
    }
    return grouped;
  }, [activeWorktreeId, worktrees, checkRuns, deps]);
}

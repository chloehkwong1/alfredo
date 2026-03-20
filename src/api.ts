import { invoke, Channel } from "@tauri-apps/api/core";
import type {
  AppConfig,
  KanbanColumn,
  LinearTeam,
  LinearTicket,
  PrStatus,
  PtyEvent,
  Session,
  SetupScript,
  Worktree,
  WorktreeSource,
} from "./types";

// ── PTY ─────────────────────────────────────────────────────────

export function spawnPty(
  worktreePath: string,
  command: string,
  args: string[],
  onData: Channel<PtyEvent>,
): Promise<string> {
  return invoke("spawn_pty", { worktreePath, command, args, onData });
}

export function writePty(sessionId: string, data: number[]): Promise<void> {
  return invoke("write_pty", { sessionId, data });
}

export function resizePty(
  sessionId: string,
  rows: number,
  cols: number,
): Promise<void> {
  return invoke("resize_pty", { sessionId, rows, cols });
}

export function closePty(sessionId: string): Promise<void> {
  return invoke("close_pty", { sessionId });
}

export function listSessions(): Promise<Session[]> {
  return invoke("list_sessions");
}

/** Helper: create a Channel for PTY events with a callback. */
export function createPtyChannel(
  onEvent: (event: PtyEvent) => void,
): Channel<PtyEvent> {
  const channel = new Channel<PtyEvent>();
  channel.onmessage = onEvent;
  return channel;
}

// ── Worktree ────────────────────────────────────────────────────

export function createWorktreeFrom(
  repoPath: string,
  source: WorktreeSource,
): Promise<Worktree> {
  return invoke("create_worktree_from", { repoPath, source });
}

export function createWorktree(
  repoPath: string,
  branchName: string,
  baseBranch: string,
): Promise<Worktree> {
  return invoke("create_worktree", { repoPath, branchName, baseBranch });
}

export function deleteWorktree(
  repoPath: string,
  worktreeName: string,
): Promise<void> {
  return invoke("delete_worktree", { repoPath, worktreeName });
}

export function listWorktrees(repoPath: string): Promise<Worktree[]> {
  return invoke("list_worktrees", { repoPath });
}

export function getWorktreeStatus(
  repoPath: string,
  worktreeName: string,
): Promise<Worktree> {
  return invoke("get_worktree_status", { repoPath, worktreeName });
}

export function setWorktreeColumn(
  repoPath: string,
  worktreeName: string,
  column: KanbanColumn,
): Promise<void> {
  return invoke("set_worktree_column", { repoPath, worktreeName, column });
}

// ── GitHub ──────────────────────────────────────────────────────

export function syncPrStatus(repoPath: string): Promise<PrStatus[]> {
  return invoke("sync_pr_status", { repoPath });
}

export function getPrForBranch(
  owner: string,
  repo: string,
  branch: string,
): Promise<PrStatus | null> {
  return invoke("get_pr_for_branch", { owner, repo, branch });
}

// ── Config ──────────────────────────────────────────────────────

export function getConfig(repoPath: string): Promise<AppConfig> {
  return invoke("get_config", { repoPath });
}

export function saveConfig(
  repoPath: string,
  config: AppConfig,
): Promise<void> {
  return invoke("save_config", { repoPath, config });
}

export function runSetupScripts(
  worktreePath: string,
  scripts: SetupScript[],
): Promise<void> {
  return invoke("run_setup_scripts", { worktreePath, scripts });
}

// ── Linear ──────────────────────────────────────────────────────

export function searchLinearIssues(
  query: string,
  teamId?: string,
): Promise<LinearTicket[]> {
  return invoke("search_linear_issues", { query, teamId: teamId ?? null });
}

export function getLinearIssue(issueId: string): Promise<LinearTicket> {
  return invoke("get_linear_issue", { issueId });
}

export function listLinearTeams(): Promise<LinearTeam[]> {
  return invoke("list_linear_teams");
}

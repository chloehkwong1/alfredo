import { invoke, Channel } from "@tauri-apps/api/core";
import type {
  AppConfig,
  CheckRun,
  CommitInfo,
  DiffFile,
  GlobalAppConfig,
  KanbanColumn,
  LinearTeam,
  LinearTicket,
  PrStatus,
  PtyEvent,
  RepoMode,
  Session,
  SetupScript,
  Worktree,
  WorktreeSource,
} from "./types";

// ── PTY ─────────────────────────────────────────────────────────

export function spawnPty(
  worktreeId: string,
  worktreePath: string,
  command: string,
  args: string[],
  onData: Channel<PtyEvent>,
  agentType?: "claudeCode" | "codex" | "aider",
): Promise<string> {
  return invoke("spawn_pty", { worktreeId, worktreePath, command, args, onData, agentType });
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
  force = true,
): Promise<void> {
  return invoke("delete_worktree", { repoPath, worktreeName, force });
}

export function listWorktrees(repoPath: string): Promise<Worktree[]> {
  return invoke("list_worktrees", { repoPath });
}

export function getWorktreeDiffStats(
  worktreePath: string,
): Promise<[number, number]> {
  return invoke("get_worktree_diff_stats", { worktreePath });
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

// ── Branch Mode ─────────────────────────────────────────────────

export function listBranches(repoPath: string): Promise<Worktree[]> {
  return invoke("list_branches", { repoPath });
}

export function getActiveBranch(repoPath: string): Promise<string | null> {
  return invoke("get_active_branch", { repoPath });
}

export function createBranch(
  repoPath: string,
  branchName: string,
  baseBranch: string,
): Promise<Worktree> {
  return invoke("create_branch", { repoPath, branchName, baseBranch });
}

export function switchBranch(
  repoPath: string,
  branchName: string,
): Promise<void> {
  return invoke("switch_branch", { repoPath, branchName });
}

export function deleteBranch(
  repoPath: string,
  branchName: string,
): Promise<void> {
  return invoke("delete_branch", { repoPath, branchName });
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

// ── GitHub Auth ─────────────────────────────────────────────────

export interface GhCliStatus {
  installed: boolean;
  authenticated: boolean;
  username: string | null;
}

export function githubAuthStatus(): Promise<GhCliStatus> {
  return invoke("github_auth_status");
}

export function githubAuthToken(): Promise<string> {
  return invoke("github_auth_token");
}

export function githubAuthDisconnect(repoPath: string): Promise<void> {
  return invoke("github_auth_disconnect", { repoPath });
}

// ── GitHub Sync ─────────────────────────────────────────────────

export function setSyncRepoPath(repoPath: string): Promise<void> {
  return invoke("set_sync_repo_path", { repoPath });
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

// ── Diff ───────────────────────────────────────────────────────

export function getDiff(repoPath: string): Promise<DiffFile[]> {
  return invoke("get_diff", { repoPath });
}

export function getCommits(repoPath: string): Promise<CommitInfo[]> {
  return invoke("get_commits", { repoPath });
}

export function getDiffForCommit(
  repoPath: string,
  commitHash: string,
): Promise<DiffFile[]> {
  return invoke("get_diff_for_commit", { repoPath, commitHash });
}

// ── Repo ───────────────────────────────────────────────────────

export function validateGitRepo(path: string): Promise<boolean> {
  return invoke("validate_git_repo", { path });
}

// ── Check Runs ──────────────────────────────────────────────────

export function getCheckRuns(repoPath: string, branch: string): Promise<CheckRun[]> {
  return invoke("get_check_runs", { repoPath, branch });
}

// ── Session Persistence ──────────────────────────────────────────────────────

export function saveSessionFile(
  repoPath: string,
  worktreeId: string,
  data: string,
): Promise<void> {
  return invoke("save_session_file", { repoPath, worktreeId, data });
}

export function loadSessionFile(
  repoPath: string,
  worktreeId: string,
): Promise<string | null> {
  return invoke("load_session_file", { repoPath, worktreeId });
}

export function deleteSessionFile(
  repoPath: string,
  worktreeId: string,
): Promise<void> {
  return invoke("delete_session_file", { repoPath, worktreeId });
}

export function ensureAlfredoGitignore(repoPath: string): Promise<void> {
  return invoke("ensure_alfredo_gitignore", { repoPath });
}

// ── App Config ──────────────────────────────────────────────────

export function getAppConfig(): Promise<GlobalAppConfig> {
  return invoke("get_app_config");
}

export function saveAppConfig(config: GlobalAppConfig): Promise<void> {
  return invoke("save_app_config", { config });
}

export function addRepo(path: string, mode: RepoMode): Promise<GlobalAppConfig> {
  return invoke("add_app_repo", { path, mode });
}

export function removeRepo(path: string): Promise<GlobalAppConfig> {
  return invoke("remove_app_repo", { path });
}

export function setActiveRepo(path: string): Promise<void> {
  return invoke("set_active_repo", { path });
}

export function hasActiveSessions(repoPath: string): Promise<boolean> {
  return invoke("has_active_sessions", { repoPath });
}

import { invoke, Channel } from "@tauri-apps/api/core";
import type {
  AppConfig,
  CheckRun,
  CommitInfo,
  DiffFile,
  FileLine,
  GlobalAppConfig,
  KanbanColumn,
  LinearTicket,
  PrDetailedStatus,
  PrStatus,
  PtyEvent,
  RepoMode,
  Worktree,
  WorktreeSource,
  WorkflowRunLog,
} from "./types";

// ── PTY ─────────────────────────────────────────────────────────

export function spawnPty(
  worktreeId: string,
  worktreePath: string,
  mode: "shell" | "claude" | "codex" | "aider",
  args: string[],
  onData: Channel<PtyEvent>,
  agentType?: "claudeCode" | "codex" | "aider",
): Promise<string> {
  return invoke("spawn_pty", { worktreeId, worktreePath, mode, args, onData, agentType });
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

export function getCommitsBehindMain(worktreePath: string): Promise<number> {
  return invoke("get_commits_behind_main", { worktreePath });
}

export function rebaseWorktree(worktreePath: string): Promise<void> {
  return invoke("rebase_worktree", { worktreePath });
}

export function listWorktrees(repoPath: string): Promise<Worktree[]> {
  return invoke("list_worktrees", { repoPath });
}

export function getWorktreeDiffStats(
  worktreePath: string,
): Promise<[number, number]> {
  return invoke("get_worktree_diff_stats", { worktreePath });
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

// ── GitHub ──────────────────────────────────────────────────────

export function syncPrStatus(repoPath: string): Promise<PrStatus[]> {
  return invoke("sync_pr_status", { repoPath });
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

// ── GitHub Sync ─────────────────────────────────────────────────

export function setSyncRepoPaths(repoPaths: string[], activeBranches: string[]): Promise<void> {
  return invoke("set_sync_repo_paths", { repoPaths, activeBranches });
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

// ── Linear ──────────────────────────────────────────────────────

export function searchLinearIssues(
  query: string,
  teamId?: string,
): Promise<LinearTicket[]> {
  return invoke("search_linear_issues", { query, teamId: teamId ?? null });
}

export function listMyLinearIssues(): Promise<LinearTicket[]> {
  return invoke("list_my_linear_issues");
}

export function linearOAuthStart(): Promise<void> {
  return invoke("linear_oauth_start");
}

export function linearOAuthDisconnect(): Promise<void> {
  return invoke("linear_oauth_disconnect");
}

export interface LinearOAuthStatus {
  connected: boolean;
  displayName: string | null;
}

export function linearOAuthStatus(): Promise<LinearOAuthStatus> {
  return invoke("linear_oauth_status");
}

// ── Diff ───────────────────────────────────────────────────────

export function getDiff(repoPath: string, defaultBranch?: string): Promise<DiffFile[]> {
  return invoke("get_diff", { repoPath, defaultBranch });
}

export function getUncommittedDiff(repoPath: string): Promise<DiffFile[]> {
  return invoke<DiffFile[]>("get_uncommitted_diff", { repoPath });
}

export function getCommits(repoPath: string, defaultBranch?: string): Promise<CommitInfo[]> {
  return invoke("get_commits", { repoPath, defaultBranch });
}

export function getDefaultBranch(repoPath: string): Promise<string> {
  return invoke("get_default_branch", { repoPath });
}

export function getDiffForCommit(
  repoPath: string,
  commitHash: string,
): Promise<DiffFile[]> {
  return invoke("get_diff_for_commit", { repoPath, commitHash });
}

export function getPrFiles(
  repoPath: string,
  prNumber: number,
): Promise<DiffFile[]> {
  return invoke("get_pr_files", { repoPath, prNumber });
}

export function getPrCommits(
  repoPath: string,
  prNumber: number,
): Promise<CommitInfo[]> {
  return invoke("get_pr_commits", { repoPath, prNumber });
}

export function getFileLines(
  repoPath: string,
  filePath: string,
  startLine: number,
  endLine: number,
  commitHash?: string,
): Promise<FileLine[]> {
  return invoke("get_file_lines", {
    repoPath,
    filePath,
    startLine,
    endLine,
    commitHash: commitHash ?? null,
  });
}

export interface DiscardFileInfo {
  path: string;
  oldPath?: string;
  status: string;
}

export function discardFile(
  repoPath: string,
  filePath: string,
  fileStatus: string,
): Promise<void> {
  return invoke("discard_file", { repoPath, filePath, fileStatus });
}

export function discardAllUncommitted(
  repoPath: string,
  files: DiscardFileInfo[],
): Promise<void> {
  return invoke("discard_all_uncommitted", { repoPath, files });
}

// ── Repo ───────────────────────────────────────────────────────

export function validateGitRepo(path: string): Promise<boolean> {
  return invoke("validate_git_repo", { path });
}

// ── Check Runs ──────────────────────────────────────────────────

export function getCheckRuns(repoPath: string, branch: string): Promise<CheckRun[]> {
  return invoke("get_check_runs", { repoPath, branch });
}

export function rerunFailedChecks(
  repoPath: string,
  checkSuiteId: number,
): Promise<void> {
  return invoke("rerun_failed_checks", { repoPath, checkSuiteId });
}

export function getWorkflowLog(
  repoPath: string,
  checkSuiteId: number,
): Promise<WorkflowRunLog[]> {
  return invoke("get_workflow_log", { repoPath, checkSuiteId });
}

export function getPrDetail(
  repoPath: string,
  prNumber: number,
): Promise<PrDetailedStatus> {
  return invoke("get_pr_detail", { repoPath, prNumber });
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

export function setSelectedRepos(paths: string[]): Promise<GlobalAppConfig> {
  return invoke<GlobalAppConfig>("set_selected_repos", { paths });
}

export function setDisplayName(name: string | null): Promise<GlobalAppConfig> {
  return invoke<GlobalAppConfig>("set_display_name", { name });
}

export function setRepoColor(repoPath: string, color: string): Promise<GlobalAppConfig> {
  return invoke<GlobalAppConfig>("set_repo_color", { repoPath, color });
}

export function setRepoDisplayName(repoPath: string, name: string | null): Promise<GlobalAppConfig> {
  return invoke<GlobalAppConfig>("set_repo_display_name", { repoPath, name });
}

// ── External Tools ─────────────────────────────────────────────

// ── Claude Session ─────────────────────────────────────────────

export function findClaudeSession(worktreePath: string): Promise<string | null> {
  return invoke("find_claude_session", { worktreePath });
}

export function openInEditor(
  path: string,
  editor: string,
  customPath?: string,
): Promise<void> {
  return invoke("open_in_editor", { path, editor, customPath: customPath ?? null });
}

export function openInTerminal(
  path: string,
  terminal: string,
  customPath?: string,
): Promise<void> {
  return invoke("open_in_terminal", { path, terminal, customPath: customPath ?? null });
}

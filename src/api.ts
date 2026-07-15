import { invoke, Channel } from "@tauri-apps/api/core";
import type {
  AgentType,
  AppConfig,
  ClaudeRegistryEntry,
  CommitInfo,
  DiffFile,
  EffectiveConfig,
  FileLine,
  GlobalAppConfig,
  KanbanColumn,
  LinearTicket,
  PortClaimResult,
  TakePortResult,
  PrStatus,
  PtyEvent,
  RepoMode,
  RepoSharedConfig,
  Session,
  SessionType,
  Worktree,
  WorktreeSource,
  WorkflowRunLog,
} from "./types";

// ── PTY ─────────────────────────────────────────────────────────

export function spawnPty(
  worktreeId: string,
  worktreePath: string,
  mode: "shell" | "claude" | "codex" | "gemini" | "aider",
  args: string[],
  onData: Channel<PtyEvent>,
  agentType?: AgentType,
  sessionType?: SessionType,
  assignedPort?: number,
  portEnvVar?: string,
  repoPath?: string,
): Promise<string> {
  return invoke("spawn_pty", { worktreeId, worktreePath, repoPath, mode, args, onData, agentType, sessionType, assignedPort, portEnvVar });
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

/** List all active PTY sessions on the Rust backend. */
export function listSessions(): Promise<Session[]> {
  return invoke("list_sessions");
}

/**
 * Reattach to an existing PTY session with a new IPC channel.
 * Returns the worktree_id the session belongs to.
 */
export function reattachPty(
  sessionId: string,
  onData: Channel<PtyEvent>,
): Promise<string> {
  return invoke("reattach_pty", { sessionId, onData });
}

export function detectAvailableAgents(): Promise<string[]> {
  return invoke("detect_available_agents");
}

export interface CustomOutputStyle {
  name: string;
  source: "user" | "project";
}

export function listOutputStyles(repoPath?: string | null): Promise<CustomOutputStyle[]> {
  return invoke("list_output_styles", { repoPath: repoPath ?? null });
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

export function runSetupScripts(
  repoPath: string,
  worktreePath: string,
): Promise<void> {
  return invoke("run_setup_scripts", { repoPath, worktreePath });
}

export function deleteWorktree(
  repoPath: string,
  worktreeName: string,
  force = true,
): Promise<void> {
  return invoke("delete_worktree", { repoPath, worktreeName, force });
}

/** Uncommitted work a worktree delete would destroy. `untracked` files are the
 *  dangerous ones — they show +0/-0 in the diff badge but are wiped on delete. */
export interface WorktreeDirtyState {
  untracked: string[];
  uncommitted: string[];
}

export function worktreeDirtyState(worktreePath: string): Promise<WorktreeDirtyState> {
  return invoke("worktree_dirty_state", { worktreePath });
}

export function getCommitsBehindMain(
  worktreePath: string,
  stackParent?: string | null,
): Promise<number> {
  return invoke("get_commits_behind_main", { worktreePath, stackParent: stackParent ?? null });
}

export function rebaseWorktree(
  worktreePath: string,
  stackParent?: string | null,
): Promise<void> {
  return invoke("rebase_worktree", { worktreePath, stackParent: stackParent ?? null });
}

export async function getAheadBehindOrigin(
  worktreePath: string,
  repoPath: string,
  forceFetch = false,
): Promise<[number, number] | null> {
  return invoke("get_ahead_behind_origin", { worktreePath, repoPath, forceFetch });
}

export async function gitPush(repoPath: string): Promise<void> {
  return invoke("git_push", { repoPath });
}

export async function gitPullRebase(repoPath: string): Promise<void> {
  return invoke("git_pull_rebase", { repoPath });
}

export async function gitPublishBranch(repoPath: string, branch: string): Promise<void> {
  return invoke("git_publish_branch", { repoPath, branch });
}

// ── Notes ───────────────────────────────────────────────────────

export function readWorktreeNotes(worktreePath: string): Promise<string> {
  return invoke("read_worktree_notes", { worktreePath });
}

export function writeWorktreeNotes(worktreePath: string, content: string): Promise<void> {
  return invoke("write_worktree_notes", { worktreePath, content });
}

// ── Git Ops ─────────────────────────────────────────────────────

export function setStackParent(
  repoPath: string,
  worktreeName: string,
  parentBranch: string | null,
): Promise<void> {
  return invoke("set_stack_parent", { repoPath, worktreeName, parentBranch });
}

export function listWorktrees(repoPath: string): Promise<Worktree[]> {
  return invoke("list_worktrees", { repoPath });
}

export function countWorktrees(repoPath: string): Promise<number> {
  return invoke("count_worktrees", { repoPath });
}

export function getWorktreeDiffStats(
  worktreePath: string,
  stackParent?: string | null,
): Promise<[number, number]> {
  return invoke("get_worktree_diff_stats", { worktreePath, stackParent: stackParent ?? null });
}

export function setWorktreeColumn(
  repoPath: string,
  worktreeName: string,
  column: KanbanColumn,
): Promise<void> {
  return invoke("set_worktree_column", { repoPath, worktreeName, column });
}

/** Drop a worktree's persisted column override, reverting it to the
 *  auto-derived kanban column. Used to self-heal a stale auto-Done when the
 *  worktree's branch goes live again (reopened / reused with a new PR). */
export function clearWorktreeColumn(repoPath: string, worktreeName: string): Promise<void> {
  return invoke("clear_worktree_column", { repoPath, worktreeName });
}

export function claimWorktreePort(repoPath: string, worktreeName: string): Promise<PortClaimResult> {
  return invoke("claim_worktree_port", { repoPath, worktreeName });
}

export function releaseWorktreePort(repoPath: string, worktreeName: string): Promise<void> {
  return invoke("release_worktree_port", { repoPath, worktreeName });
}

/**
 * Release a worktree's port using its `id` — the key `port_assignments` is
 * stored under. Always prefer this over `releaseWorktreePort` at call sites
 * that have a Worktree: it reads `wt.id`, so no caller can accidentally pass
 * `wt.name` (the bug that made every release a silent no-op).
 */
export function releasePortFor(wt: { repoPath: string; id: string }): Promise<void> {
  return releaseWorktreePort(wt.repoPath, wt.id);
}

export function takeWorktreePort(
  repoPath: string,
  worktreeName: string,
  port: number,
): Promise<TakePortResult> {
  return invoke("take_worktree_port", { repoPath, worktreeName, port });
}

export function getAssignedWorktreePort(repoPath: string, worktreeName: string): Promise<number | null> {
  return invoke("get_assigned_worktree_port", { repoPath, worktreeName });
}

export function reconcileWorktreePorts(repoPath: string): Promise<string[]> {
  return invoke("reconcile_worktree_ports", { repoPath });
}

// ── Branch Mode ─────────────────────────────────────────────────

export function listBranches(repoPath: string, includeDefaultBranches?: boolean): Promise<Worktree[]> {
  return invoke("list_branches", { repoPath, includeDefaultBranches });
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

export function setRepoMode(
  repoPath: string,
  mode: RepoMode,
): Promise<void> {
  return invoke("set_repo_mode", { repoPath, mode });
}

export function getRepoConfigLayers(repoPath: string): Promise<EffectiveConfig> {
  return invoke("get_repo_config_layers", { repoPath });
}

export function readAlfredoJson(repoPath: string): Promise<RepoSharedConfig | null> {
  return invoke("read_alfredo_json", { repoPath });
}

export function writeAlfredoJson(repoPath: string, config: RepoSharedConfig): Promise<void> {
  return invoke("write_alfredo_json", { repoPath, config });
}

export function resetRepoOverrides(repoPath: string): Promise<void> {
  return invoke("reset_repo_overrides", { repoPath });
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

/** Persist a Linear ticket link for a worktree so the StatusBar chip survives restart. */
export function setWorktreeLinearTicket(
  repoPath: string,
  worktreeName: string,
  url: string,
  identifier: string,
): Promise<void> {
  return invoke("set_worktree_linear_ticket", { repoPath, worktreeName, url, identifier });
}

export function linearOAuthStart(): Promise<void> {
  return invoke("linear_oauth_start");
}

export function linearOAuthDisconnect(): Promise<void> {
  return invoke("linear_oauth_disconnect");
}

export interface LinearOAuthCompletePayload {
  displayName: string | null;
}

export interface LinearOAuthStatus {
  connected: boolean;
  displayName: string | null;
}

export function linearOAuthStatus(): Promise<LinearOAuthStatus> {
  return invoke("linear_oauth_status");
}

export function runArchiveScript(repoPath: string, worktreePath: string): Promise<void> {
  return invoke("run_archive_script", { repoPath, worktreePath });
}

// ── Diff ───────────────────────────────────────────────────────

export function getDiff(
  repoPath: string,
  defaultBranch?: string,
  mergeCommitSha?: string,
  clampDrift?: boolean,
): Promise<DiffFile[]> {
  return invoke<DiffFile[]>("get_diff", {
    repoPath,
    defaultBranch,
    mergeCommitSha,
    clampDrift,
  });
}

export function getUncommittedDiff(repoPath: string): Promise<DiffFile[]> {
  return invoke<DiffFile[]>("get_uncommitted_diff", { repoPath });
}

export function getFileContent(
  repoPath: string,
  filePath: string,
  commitHash?: string,
): Promise<string> {
  return invoke<string>("get_file_content", { repoPath, filePath, commitHash });
}

export function toggleTaskListItem(
  repoPath: string,
  filePath: string,
  lineNumber: number,
  newChecked: boolean,
): Promise<void> {
  return invoke<void>("toggle_task_list_item", {
    repoPath,
    filePath,
    lineNumber,
    newChecked,
  });
}

export function getCommits(
  repoPath: string,
  defaultBranch?: string,
  mergeCommitSha?: string,
  clampDrift?: boolean,
): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("get_commits", {
    repoPath,
    defaultBranch,
    mergeCommitSha,
    clampDrift,
  });
}

export function getFullCommits(repoPath: string, limit?: number): Promise<CommitInfo[]> {
  return invoke("get_full_commits", { repoPath, limit });
}

export function getGitUser(repoPath: string): Promise<string | null> {
  return invoke("get_git_user", { repoPath });
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

export function rerunFailedChecks(
  repoPath: string,
  checkSuiteId: number,
): Promise<void> {
  return invoke("rerun_failed_checks", { repoPath, checkSuiteId });
}

export function getJobLog(
  repoPath: string,
  jobId: number,
  jobName: string,
): Promise<WorkflowRunLog | null> {
  return invoke("get_job_log", { repoPath, jobId, jobName });
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

export function pollClaudeRegistry(): Promise<ClaudeRegistryEntry[]> {
  return invoke<ClaudeRegistryEntry[]>("poll_claude_registry");
}

/** Eagerly persist one tab's discovered Claude session id (write-through, Rust-side). */
export function recordResumeSessionId(
  repoPath: string,
  worktreeId: string,
  tabId: string,
  sessionId: string,
): Promise<void> {
  return invoke("record_resume_session_id", { repoPath, worktreeId, tabId, sessionId });
}

/** Load the resume-id sidecar (`{ tabId: sessionId }`) overlaid onto restored tabs. */
export function loadResumeSessionIds(
  repoPath: string,
  worktreeId: string,
): Promise<Record<string, string>> {
  return invoke("load_resume_session_ids", { repoPath, worktreeId });
}

export function deleteSessionFile(
  repoPath: string,
  worktreeId: string,
): Promise<void> {
  return invoke("delete_session_file", { repoPath, worktreeId });
}

export interface PtyDumpPaths {
  raw: string;
  serialized: string | null;
  screenshot: string | null;
}

export function dumpPtyBuffer(
  sessionId: string,
  bytes: Uint8Array,
  serialized: string | null,
  captureScreenshot: boolean,
): Promise<PtyDumpPaths> {
  // JSON-array IPC encoding is fine for the ~50KB ring buffer this is wired
  // to today; switch to Tauri raw IPC if this ever becomes an auto-dump path.
  return invoke("dump_pty_buffer", {
    sessionId,
    bytes: Array.from(bytes),
    serialized,
    captureScreenshot,
  });
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

export function setRepoShortLabel(repoPath: string, label: string | null): Promise<GlobalAppConfig> {
  return invoke<GlobalAppConfig>("set_repo_short_label", { repoPath, label });
}

export function setWorktreeLabel(worktreePath: string, label: string | null): Promise<GlobalAppConfig> {
  return invoke<GlobalAppConfig>("set_worktree_label", { worktreePath, label });
}

export function setCommentChips(chips: string[]): Promise<GlobalAppConfig> {
  return invoke<GlobalAppConfig>("set_comment_chips", { chips });
}

// ── External Tools ─────────────────────────────────────────────

// ── Claude Session ─────────────────────────────────────────────

export function findClaudeSession(
  worktreePath: string,
  excludeIds: string[] = [],
): Promise<string | null> {
  return invoke("find_claude_session", { worktreePath, excludeIds });
}

// List every top-level Claude session UUID for a worktree path. Snapshotted at
// spawn time so the discovery loop can tell this tab's freshly created session
// apart from foreign/historical ones already sharing the cwd-keyed project dir.
export function listClaudeSessions(worktreePath: string): Promise<string[]> {
  return invoke("list_claude_sessions", { worktreePath });
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

// ── Audio ───────────────────────────────────────────────────────

export function playSound(id: string): Promise<void> {
  return invoke("play_sound", { id });
}

// ── Notifications ───────────────────────────────────────────────

export function sendAppNotification(title: string, body: string, sound?: string): Promise<void> {
  return invoke<void>("send_app_notification", { title, body, sound });
}

export function notificationPermissionStatus(): Promise<"granted" | "denied" | "default"> {
  return invoke<"granted" | "denied" | "default">("notification_permission_status");
}

export function requestNotificationPermission(): Promise<boolean> {
  return invoke<boolean>("request_notification_permission");
}

// ── Badge ────────────────────────────────

/**
 * Set the OS dock/taskbar badge count. 0 clears the badge.
 * macOS + Linux only — no-op on other platforms (handled by Rust).
 */
export function setDockBadge(count: number): Promise<void> {
  return invoke("set_dock_badge", { count: Math.max(0, Math.floor(count)) });
}

// ── App Detection ─────────────────────────────────────────────

export interface InstalledApp {
  id: string;
  name: string;
  category: string;
}

export function detectInstalledApps(): Promise<InstalledApp[]> {
  return invoke("detect_installed_apps");
}

export function openInApp(appId: string, path: string): Promise<void> {
  return invoke("open_in_app", { appId, path });
}

// ── Ask Alfredo ───────────────────────────────────────────────

export interface HelpHit {
  title: string;
  uiPath: string | null;
  keywords: string[];
  body: string;
  score: number;
}

export function searchAlfredoDocs(query: string, limit = 5): Promise<HelpHit[]> {
  return invoke<HelpHit[]>("search_alfredo_docs", { query, limit });
}

// ── Debug log bridge (frontend → alfredo.log) ─────────────────

export function debugLog(message: string): Promise<void> {
  return invoke("debug_log", { message });
}

// ── PTY ─────────────────────────────────────────────────────────

export interface Session {
  id: string;
  worktreeId: string;
  command: string;
  status: SessionStatus;
}

export type SessionStatus =
  | "running"
  | "idle"
  | "waitingForInput"
  | { exited: number };

export type PtyEvent =
  | { event: "output"; data: number[] }
  | { event: "agentState"; data: AgentState }
  | { event: "hookAgentState"; data: AgentState }
  | { event: "heartbeat" };

// ── Agent ───────────────────────────────────────────────────────

export type AgentType = "claudeCode" | "codex" | "aider" | "unknown";

export type AgentState = "idle" | "busy" | "waitingForInput" | "notRunning";

// ── Worktree / Kanban ───────────────────────────────────────────

export interface Worktree {
  id: string;
  name: string;
  path: string;
  branch: string;
  prStatus: PrStatus | null;
  agentStatus: AgentState;
  channelAlive?: boolean;
  column: KanbanColumn;
  isBranchMode: boolean;
  additions: number | null;
  deletions: number | null;
  archived?: boolean;
}

export type KanbanColumn =
  | "inProgress"
  | "blocked"
  | "draftPr"
  | "openPr"
  | "done";

export type WorktreeSource =
  | { kind: "newBranch"; name: string; base: string }
  | { kind: "existingBranch"; name: string }
  | { kind: "pullRequest"; number: number }
  | { kind: "linearTicket"; id: string };

// ── GitHub ──────────────────────────────────────────────────────

export interface PrStatus {
  number: number;
  state: string;
  title: string;
  url: string;
  draft: boolean;
  merged: boolean;
  branch: string;
  mergedAt?: string;
}

/** Payload emitted by the `github:pr-update` Tauri event. */
export interface PrUpdatePayload {
  prs: PrStatusWithColumn[];
}

/** A PR status annotated with the auto-determined kanban column. */
export interface PrStatusWithColumn {
  number: number;
  state: string;
  title: string;
  url: string;
  draft: boolean;
  merged: boolean;
  branch: string;
  autoColumn: KanbanColumn;
  mergedAt?: string;
}

// ── Config ──────────────────────────────────────────────────────

export interface SetupScript {
  name: string;
  command: string;
  runOn: string;
}

export interface NotificationConfig {
  enabled: boolean;
  sound: string; // sound ID
  notifyOnWaiting: boolean;
  notifyOnIdle: boolean;
  notifyOnError: boolean;
}

export interface ClaudeDefaults {
  model?: string;
  effort?: string;
  permissionMode?: string;
  dangerouslySkipPermissions?: boolean;
  outputStyle?: string;
  verbose?: boolean;
}

export interface ClaudeOverrides {
  model?: string;
  effort?: string;
  permissionMode?: string;
  outputStyle?: string;
}

export interface AppConfig {
  repoPath: string;
  setupScripts: SetupScript[];
  githubToken: string | null;
  linearApiKey: string | null;
  branchMode: boolean;
  columnOverrides?: Record<string, KanbanColumn>;
  theme?: string;
  notifications?: NotificationConfig;
  worktreeBasePath?: string | null;
  archiveAfterDays?: number;
  claudeDefaults?: ClaudeDefaults;
  worktreeOverrides?: Record<string, ClaudeOverrides>;
}

// ── Linear ──────────────────────────────────────────────────────

export interface LinearTicket {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  state: string;
  labels: string[];
  assignee: string | null;
}

export interface LinearTeam {
  id: string;
  name: string;
  key: string;
}

// ── Diff viewer ──────────────────────────────────────────────────

export interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface DiffLine {
  lineType: "context" | "addition" | "deletion";
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  timestamp: number;
}

// ── Workspace tabs ──────────────────────────────────────────────

export type TabType = "claude" | "shell" | "changes" | "pr";

export interface CheckRun {
  id: number;
  name: string;
  status: string;       // "queued" | "in_progress" | "completed"
  conclusion: string | null;
  htmlUrl: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface WorkspaceTab {
  id: string;
  type: TabType;
  label: string;
  command?: string;
  args?: string[];
  claudeSettings?: {
    model?: string;
    effort?: string;
    permissionMode?: string;
    outputStyle?: string;
  };
}

// ── App Config (multi-repo) ──────────────────────────────────────

export type RepoMode = "worktree" | "branch";

export interface RepoEntry {
  path: string;
  mode: RepoMode;
}

export interface GlobalAppConfig {
  repos: RepoEntry[];
  activeRepo: string | null;
  theme: string | null;
  notifications: NotificationConfig | null;
}

// ── Inline annotation ────────────────────────────────────────────

export interface Annotation {
  id: string;
  worktreeId: string;
  filePath: string;
  lineNumber: number;
  commitHash: string | null; // null = "all changes" mode
  text: string;
  createdAt: number;
}

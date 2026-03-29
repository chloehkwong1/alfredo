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
  staleBusy?: boolean;
  column: KanbanColumn;
  isBranchMode: boolean;
  additions: number | null;
  deletions: number | null;
  archived?: boolean;
  lastActivityAt?: number; // unix timestamp ms, updated on status/diff/pr changes
  repoPath: string;
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
  baseBranch?: string;
  mergedAt?: string;
  headSha?: string;
  body?: string;
}

/** Payload emitted by the `github:pr-update` Tauri event. */
export interface PrUpdatePayload {
  prs: PrStatusWithColumn[];
}

/** A PR status annotated with the auto-determined kanban column. */
export interface PrStatusWithColumn extends PrStatus {
  autoColumn: KanbanColumn;
  failingCheckCount?: number;
  unresolvedCommentCount?: number;
  reviewDecision?: string | null;
  mergeable?: boolean | null;
  /** The repo path this PR belongs to, for multi-repo disambiguation. */
  repoPath: string;
}

// ── Config ──────────────────────────────────────────────────────

export interface SetupScript {
  name: string;
  command: string;
  runOn: string;
}

export interface RunScript {
  name: string;
  command: string;
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
  runScript?: RunScript | null;
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

export type TabType = "claude" | "shell" | "server" | "changes";

export type DiffViewMode = "unified" | "split";
export type PrPanelState = "open" | "collapsed";

// ── Layout (split panes) ────────────────────────────────────────

export type LayoutNode =
  | { type: "leaf"; paneId: string }
  | {
      type: "split";
      direction: "horizontal" | "vertical";
      ratio: number;
      children: [LayoutNode, LayoutNode];
    };

export interface Pane {
  tabIds: string[];
  activeTabId: string;
}

export interface CheckRun {
  id: number;
  name: string;
  status: string;       // "queued" | "in_progress" | "completed"
  conclusion: string | null;
  htmlUrl: string;
  startedAt: string | null;
  completedAt: string | null;
  checkSuiteId?: number;
}

export interface PrReview {
  reviewer: string;
  state: string; // "approved" | "changes_requested" | "pending" | "dismissed"
  submittedAt: string | null;
}

export interface PrComment {
  id: number;
  author: string;
  body: string;
  path: string | null;
  line: number | null;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface WorkflowRunLog {
  runId: number;
  jobName: string;
  stepName: string;
  logExcerpt: string;
}

export interface PrDetailedStatus {
  reviews: PrReview[];
  comments: PrComment[];
  mergeable: boolean | null;
  reviewDecision: string | null;
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
  selectedRepos: string[];
  displayName: string | null;
  repoColors: Record<string, string>;
  repoDisplayNames: Record<string, string>;
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

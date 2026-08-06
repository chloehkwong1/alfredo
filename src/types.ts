// ── PTY ─────────────────────────────────────────────────────────

export type SessionType = "agent" | "server" | "shell";

export interface Session {
  id: string;
  worktreeId: string;
  /** Worktree filesystem path — used by the orphan sweep to join against
   *  claude-registry entries (by cwd) before closing an unclaimed session. */
  worktreePath: string;
  command: string;
  status: SessionStatus;
  sessionType: SessionType;
}

export type SessionStatus =
  | "running"
  | "idle"
  | "waitingForInput"
  | { exited: number };

export type PtyEvent =
  | { event: "output"; data: number[] }
  | { event: "agentState"; data: AgentState }
  | { event: "hookAgentState"; data: { state: AgentState; notify: NotifyReason; phase: HookPhase } }
  | { event: "heartbeat" }
  | { event: "title"; data: string | null }
  | { event: "process"; data: string | null }
  | { event: "cwd"; data: string | null };

/** Hook lifecycle phase — mirrors the Rust `HookPhase` enum. */
export type HookPhase = "none" | "promptStart" | "toolStart" | "toolEnd" | "turnEnd" | "subagentStart" | "subagentEnd" | "monitorStart" | "questionEnd";

// ── Agent ───────────────────────────────────────────────────────

export type AgentType = "claudeCode" | "codex" | "geminiCli" | "aider" | "unknown";

export type AgentState = "idle" | "busy" | "waitingForInput" | "notRunning";

export type NotifyReason = "none" | "finished" | "error" | "input";

/** Narrowed status values from Claude Code's session registry. */
export type ClaudeRegistryStatus = "busy" | "idle" | "waiting";

/** One session from `claude agents --json` (camelCase via serde rename). */
export interface ClaudeRegistryEntry {
  pid: number;
  sessionId: string;
  cwd: string;
  kind: string;
  /** "busy" | "idle" | "waiting" — kept as string so future CLI values can't throw. */
  status: string;
  /** Present only when status === "waiting", e.g. "permission prompt". */
  waitingFor?: string;
}

// ── Worktree / Kanban ───────────────────────────────────────────

export type StackRebaseStatus =
  | { kind: "upToDate" }
  | { kind: "behind"; count: number }
  | { kind: "rebasing" }
  | { kind: "conflict" }
  | { kind: "skippedDirty" }
  | { kind: "pushFailed" }
  | { kind: "rewrittenExternally" };

/** A merged-parent restack Alfredo has queued but deferred. Event-fed
 *  (`stack:pending-update`) — the backend never returns it from listWorktrees.
 *  `nativeRestacked` is a notice, not a deferral: the parent belonged to a
 *  native GitHub Stack, so GitHub restacked the branch server-side and Alfredo
 *  only cleared its local bookkeeping. */
export interface StackPendingAction {
  mergedParent: string;
  blockedBy: "dirty" | "agentBusy" | "nativeRestacked";
}

export interface Worktree {
  id: string;
  name: string;
  path: string;
  branch: string;
  prStatus: PrStatus | null;
  agentStatus: AgentState;
  channelAlive?: boolean;
  staleBusy?: boolean;
  /** Number of background/Task subagents currently in flight across this
   *  worktree's sessions. When > 0 the sidebar renders "Running N agents…"
   *  instead of "Thinking…". Written by the reconciler (see sessionManager). */
  runningAgents?: number;
  /** True while at least one of this worktree's sessions is parked on a pending
   *  Claude Code monitor. The sidebar renders "Monitoring…" instead of "Idle".
   *  Written by the reconciler (see sessionManager). */
  monitorPending?: boolean;
  column: KanbanColumn;
  isBranchMode: boolean;
  additions: number | null;
  deletions: number | null;
  archived?: boolean;
  archivedAt?: number; // unix timestamp ms — when moved to archive
  unarchivedAt?: number; // unix timestamp ms — when manually unarchived (prevents immediate re-archive)
  lastActivityAt?: number; // unix timestamp ms, computed from max(lastCommitEpoch, prUpdatedAt, agentChange)
  lastCommitEpoch?: number; // epoch ms of latest commit on branch (from Rust)
  createdAtEpoch?: number; // epoch ms the worktree directory was created (from Rust)
  repoPath: string;
  /** Claude Code session UUID for `--resume` on next spawn. */
  claudeSessionId?: string;
  /** True while the worktree is being created in the background. */
  creating?: boolean;
  /** Error message if background creation failed. */
  createError?: string;
  /** True when background creation just finished — cleared on first select. */
  justCreated?: boolean;
  /** URL of the Linear ticket this worktree was created from. */
  linearTicketUrl?: string;
  /** Human-readable Linear identifier (e.g. "ROS-42"). */
  linearTicketIdentifier?: string;
  stackParent?: string | null;
  stackChildren?: string[];
  stackRebaseStatus?: StackRebaseStatus | null;
  stackPending?: StackPendingAction | null;
  /** Last background stack action that touched this worktree ("restacked",
   *  "moved onto main"). Event-fed, in-memory only — gone on app restart. */
  lastStackAction?: { action: string; at: number } | null;
  /** Setup script error — worktree was created successfully but post-create scripts failed. */
  setupScriptError?: string | null;
  /** True while post-create setup scripts are still running in the background.
   *  The worktree is already usable; the sidebar shows "Setting up…". Cleared
   *  by the `worktree:setup-complete` event (see useWorktreeSetup). */
  setupInProgress?: boolean;
  /** Auto-assigned dev server port. */
  assignedPort?: number | null;
  /** Frontend-only: true for synthetic "main-branch card" entries pinned by
      worktree-mode repos. Distinguishes them from real branch-mode entries
      so UI surfaces like the rebase banner know to show "behind origin/main". */
  isPinnedMainCard?: boolean;
}

// ── Port claim ──────────────────────────────────────────────────

export interface PortHolder {
  worktreeName: string;
  port: number;
}

export type PortClaimResult =
  | { kind: "assigned"; port: number }
  | { kind: "disabled" }
  | {
      kind: "rangeFull";
      rangeStart: number;
      rangeEnd: number;
      holders: PortHolder[];
    };

export type TakePortResult =
  | { kind: "taken"; port: number; previousHolder: string | null }
  | { kind: "disabled" };

export type KanbanColumn =
  | "toDo"
  | "inProgress"
  | "blocked"
  | "draftPr"
  | "openPr"
  | "needsReview"
  | "done";

export type WorktreeSource =
  | { kind: "newBranch"; name: string; base: string }
  | { kind: "existingBranch"; name: string; newName?: string }
  | { kind: "pullRequest"; number: number }
  | { kind: "linearTicket"; id: string; base?: string };

// ── GitHub ──────────────────────────────────────────────────────

/** One PR in a native GitHub Stack roster. Sibling PRs usually have no local
 *  worktree, so their metadata rides along here rather than coming from a
 *  worktree-attached PrStatus. */
export interface NativeStackMember {
  number: number;
  title: string;
  branch: string;
  /** GraphQL PR state: "OPEN" | "MERGED" | "CLOSED". */
  state: string;
  url: string;
  /** 1-based position within the stack (base-most first). */
  position: number;
}

/** A PR's membership in a native GitHub Stack (public preview). Present when
 *  GitHub manages retarget/rebase server-side — Alfredo's stack automation
 *  stands down for these branches. */
export interface NativeStackInfo {
  id: string;
  /** The stack's user-facing number ("Stack #23263"). */
  number: number;
  /** This PR's 1-based position within the stack. */
  position: number;
  /** Total number of PRs in the stack. */
  size: number;
  /** Full ordered roster (sorted by position, includes this PR). */
  members: NativeStackMember[];
}

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
  mergeCommitSha?: string;
  body?: string;
  author?: string;
  requestedReviewers?: string[];
  /** Native GitHub Stack membership; null/absent when not a member. */
  nativeStack?: NativeStackInfo | null;
}

/** Payload emitted by the `github:pr-update` Tauri event. */
export interface PrUpdatePayload {
  prs: PrStatusWithColumn[];
}

/** A PR status annotated with the auto-determined kanban column. */
export interface PrStatusWithColumn extends PrStatus {
  autoColumn: KanbanColumn;
  failingCheckCount?: number;
  pendingCheckCount?: number;
  unresolvedCommentCount?: number;
  reviewDecision?: string | null;
  mergeable?: boolean | null;
  /** The repo path this PR belongs to, for multi-repo disambiguation. */
  repoPath: string;
  /** Full check run objects for the PR panel. */
  checkRuns: CheckRun[];
  /** Full review objects (deduplicated, latest per reviewer). */
  reviews: PrReview[];
  /** Line comments + issue comments merged. null = not fetched yet in this batch. */
  comments: PrComment[] | null;
  /** ISO 8601 timestamp of the last update to this PR. */
  updatedAt?: string;
  /** True when the current user is a requested reviewer on someone else's open PR. */
  reviewRequested: boolean;
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
  url?: string;
}

export interface NotificationConfig {
  enabled: boolean;
  sound: string; // sound ID
  notifyOnWaiting: boolean;
  notifyOnIdle: boolean;
}

export interface ClaudeDefaults {
  model?: string;
  effort?: string;
  permissionMode?: string;
  dangerouslySkipPermissions?: boolean;
  outputStyle?: string;
  verbose?: boolean;
  extraFlags?: string;
}

export interface ClaudeOverrides {
  model?: string;
  effort?: string;
  permissionMode?: string;
  outputStyle?: string;
}

export interface AppConfig {
  repoPath: string;
  setupScripts?: SetupScript[] | null;
  runScript?: RunScript | null;
  githubToken: string | null;
  linearApiKey: string | null;
  branchMode: boolean;
  columnOverrides?: Record<string, KanbanColumn>;
  /** Manual sidebar card order per kanban column (worktree names, top-first).
   *  Personal-layer only — passes through the effective config unchanged. */
  worktreeOrder?: Partial<Record<KanbanColumn, string[]>>;
  theme?: string;
  notifications?: NotificationConfig;
  worktreeBasePath?: string | null;
  claudeDefaults?: ClaudeDefaults;
  worktreeOverrides?: Record<string, ClaudeOverrides>;
  defaultAgent?: TabType;
  archiveScript?: string | null;
  stackParentOverrides?: Record<string, string>;
  linearTickets?: Record<string, { url: string; identifier: string }>;
  portAssignments?: Record<string, number>;
  autoAssignPorts?: boolean;
  portEnvVar?: string | null;
  /** Inclusive dev-server port range for this repo. Both must be set for
   *  auto-assign to actually claim ports; a missing/inverted range is treated
   *  as "not configured" on the backend. */
  portRangeStart?: number | null;
  portRangeEnd?: number | null;
  /** Personal template pasted into Claude when opening a Linear issue.
   *  Variables: {{identifier}}, {{title}}, {{description}}, {{branch}},
   *  {{url}}. Empty/absent = built-in format. */
  linearPromptTemplate?: string | null;
  /** Press Enter after pasting the Linear prompt. Default false. */
  linearAutoSubmit?: boolean;
}

export interface RepoSharedConfig {
  setupScripts?: SetupScript[];
  runScript?: RunScript;
  archiveScript?: string;
  portEnvVar?: string;
  portRangeStart?: number;
  portRangeEnd?: number;
}

export interface RepoOverrideFlags {
  setupScripts: boolean;
  runScript: boolean;
  archiveScript: boolean;
  portEnvVar: boolean;
  portRangeStart: boolean;
  portRangeEnd: boolean;
}

export interface EffectiveConfig {
  effective: AppConfig;
  overrides: RepoOverrideFlags;
  upstream: RepoSharedConfig | null;
  /** True when alfredo.json exists *and* is in the git index. False when it
   *  exists but is untracked (e.g. a migration artifact teammates won't see),
   *  or when there's no alfredo.json at all. */
  upstreamInGit: boolean;
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
  updatedAt?: string | null;
}

// ── Diff viewer ──────────────────────────────────────────────────

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  truncated?: boolean;
  /** Full text of the file before the change. Null for added files, binary, or oversized blobs. */
  originalContent?: string | null;
  /** Full text of the file after the change. Null for deleted files, binary, or oversized blobs. */
  modifiedContent?: string | null;
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

export interface FileLine {
  lineNumber: number;
  content: string;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  timestamp: number;
}

// ── Workspace tabs ──────────────────────────────────────────────

export type TabType = "claude" | "codex" | "gemini" | "shell" | "server" | "diff" | "notes";

/** Tab types that represent an AI agent session. */
export const AGENT_TAB_TYPES: ReadonlySet<TabType> = new Set(["claude", "codex", "gemini"]);

/** Check whether a tab type is an AI agent (Claude, Codex, or Gemini). */
export function isAgentTab(tab: { type: TabType }): boolean {
  return AGENT_TAB_TYPES.has(tab.type);
}

/** Find the first agent tab in a list. */
export function findAgentTab(tabs: { type: TabType; id: string }[]): typeof tabs[number] | undefined {
  return tabs.find((t) => AGENT_TAB_TYPES.has(t.type));
}

export type DiffViewMode = "inline" | "side-by-side";

/**
 * Map any persisted DiffViewMode-like value to the current union. Old persisted
 * values (`"unified"` / `"split"` / `"file"`) come from app.json + saved
 * sessions on disk.
 */
export function normalizeDiffViewMode(v: unknown): DiffViewMode {
  if (v === "inline" || v === "side-by-side") return v;
  if (v === "split") return "side-by-side";
  return "inline";
}
export type FileViewMode = "diff" | "rendered";
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
  previewTabId: string | null;
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
  /** Top-level review summary body, when the reviewer left one (e.g. cubic's
   *  issue roll-up). `null`/`undefined` for stub reviews that only carry
   *  inline comments. */
  body?: string | null;
}

export interface PrComment {
  id: number;
  author: string;
  body: string;
  path: string | null;
  line: number | null;
  side: DiffSide;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface WorkflowRunLog {
  jobName: string;
  stepName: string;
  logExcerpt: string;
}

export interface PrDetailedStatus {
  reviews: PrReview[];
  comments: PrComment[];
  mergeable: boolean | null;
  reviewDecision: string | null;
  requestedReviewers: string[];
}

export interface DiffTarget {
  type: "file" | "commit";
  filePath?: string;
  /** When true the target is an uncommitted (working-tree) change; false means committed. */
  isUncommitted?: boolean;
  commitHash?: string;
  scrollToFile?: string;
  scrollToLine?: number;
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
  /** Set only on tabs restored from a saved session — triggers --resume on first spawn. */
  resumeSessionId?: string;
  diffTarget?: DiffTarget;
  /**
   * Live, dynamically-resolved label (OSC title / foreground process / CWD).
   * When set, renderers prefer this over `label`. `null` or undefined means
   * fall back to `label`.
   */
  dynamicLabel?: string | null;
  /**
   * User-set name from "Rename Tab". Outranks `dynamicLabel` until cleared
   * (set back to undefined by committing an empty rename input).
   */
  customLabel?: string;
}

// ── App Config (multi-repo) ──────────────────────────────────────

export type RepoMode = "worktree" | "branch";

export interface RepoEntry {
  path: string;
  mode: RepoMode;
}

/** One release's curated highlights, parsed from the bundled whats-new.md. */
export interface WhatsNewEntry {
  version: string;
  date: string;
  /** Markdown bullet list for this release. */
  body: string;
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
  /** Optional 1–4 char badge label per repo; falls back to initials. */
  repoShortLabels: Record<string, string>;
  worktreeLabels: Record<string, string>;
  preferredEditor: string;
  customEditorPath: string | null;
  preferredTerminal: string;
  customTerminalPath: string | null;
  model?: string | null;
  effort?: string | null;
  permissionMode?: string | null;
  dangerouslySkipPermissions?: boolean | null;
  outputStyle?: string | null;
  verbose?: boolean | null;
  extraFlags?: string | null;
  /** Default diff view mode for new worktrees. */
  defaultDiffViewMode?: DiffViewMode;
  /** Which kanban column groups are collapsed in the sidebar. */
  collapsedKanbanColumns?: string[];
  /** Whether the sidebar starts collapsed. */
  sidebarCollapsed?: boolean;
  /** Hide unpinned worktrees in the sidebar. */
  hideUnpinnedWorktrees?: boolean;
  /** Worktree-mode repo paths that opt in to the sidebar "main branch" card. */
  showMainCardRepos?: string[];
  /** Whether the user has dismissed the orientation banner. */
  hasSeenOrientation?: boolean;
  /** Last-active worktree ID, restored on app launch. */
  activeWorktreeId?: string | null;
  /** Which agent to spawn by default for new worktrees. */
  defaultAgent?: TabType;
  /** Days after merge before auto-archiving. */
  archiveAfterDays?: number;
  /** Days after archiving before auto-deleting. 0 or null = never. */
  deleteAfterDays?: number;
  /** Show diagnostic info in notifications (state source, hook name). */
  debugMode?: boolean;
  /** Reusable quick-insert prompts for diff comment chips. */
  commentChips?: string[];
  /** Opt in to pre-release builds from the beta update channel. */
  receiveBetaUpdates?: boolean;
  /** Auto-create worktrees for PRs awaiting your review. Default true. */
  autoPullReviewRequests?: boolean;
  /** First-time worktree-lifecycle nudge has been dismissed by the user. */
  dismissedLifecycleNudge?: boolean;
  /** Newest what's-new entry version the user has dismissed, e.g. "0.19.0". */
  whatsNewLastSeen?: string | null;
}

// ── Inline annotation ────────────────────────────────────────────

export type DiffSide = "old" | "new";

export interface Annotation {
  id: string;
  worktreeId: string;
  filePath: string;
  lineNumber: number;
  side: DiffSide; // which side of the diff: old (deletion) or new (addition/context)
  commitHash: string | null; // null = "all changes" mode
  text: string;
  createdAt: number;
}

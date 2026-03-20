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
  | { event: "agentState"; data: AgentState };

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
  column: KanbanColumn;
  isBranchMode: boolean;
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
}

// ── Config ──────────────────────────────────────────────────────

export interface SetupScript {
  name: string;
  command: string;
  runOn: string;
}

export interface AppConfig {
  repoPath: string;
  setupScripts: SetupScript[];
  githubToken: string | null;
  linearApiKey: string | null;
  branchMode: boolean;
  columnOverrides?: Record<string, KanbanColumn>;
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

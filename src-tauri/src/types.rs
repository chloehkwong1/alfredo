use std::collections::HashMap;
use serde::{Deserialize, Serialize};

// ── PTY ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SessionType {
    Agent,
    Server,
    Shell,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub worktree_id: String,
    pub command: String,
    pub status: SessionStatus,
    pub session_type: SessionType,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SessionStatus {
    Running,
    Idle,
    WaitingForInput,
    Exited(i32),
}

/// Tagged enum sent over a Channel from the PTY reader thread.
/// Frontend discriminates on the `event` field.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum PtyEvent {
    /// Raw terminal output bytes
    Output(Vec<u8>),
    /// Agent state change detected by the PTY output parser (fallback).
    AgentState(AgentState),
    /// Authoritative agent state from hook callbacks (via state server).
    /// Takes priority over detector-sourced AgentState events.
    HookAgentState {
        state: AgentState,
        notify: NotifyReason,
        phase: HookPhase,
    },
    /// Periodic heartbeat so the frontend can detect a dead PTY channel.
    Heartbeat,
    /// OSC 0/1/2 title emitted by the child process. `None` means the child
    /// set an empty title — frontend reverts to fallback label.
    Title(Option<String>),
    /// Foreground process name/command string for shell sessions.
    /// `None` when the shell itself is the foreground process (idle at prompt).
    Process(Option<String>),
    /// Current working directory for shell sessions. Tilde-abbreviated if
    /// under $HOME (e.g. "~/alfredo"); `None` if resolution failed.
    Cwd(Option<String>),
}

// ── Agent ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AgentType {
    ClaudeCode,
    Codex,
    Aider,
    GeminiCli,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AgentState {
    Idle,
    Busy,
    WaitingForInput,
    NotRunning,
}

/// Why a hook-sourced state update should (optionally) trigger an OS notification.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum NotifyReason {
    /// No notification.
    None,
    /// Agent finished a turn (Stop hook).
    Finished,
    /// Agent turn ended due to API error (StopFailure hook).
    Error,
    /// Agent needs user input (PermissionRequest / Elicitation).
    Input,
}

/// Hook lifecycle phase — used to track tool-in-flight state.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum HookPhase {
    None,
    PromptStart,  // UserPromptSubmit
    ToolStart,    // PreToolUse
    ToolEnd,      // PostToolUse / PostToolUseFailure
    TurnEnd,      // Stop / StopFailure (resets counter)
    SubagentEnd,  // SubagentStop — straggler after parent's TurnEnd must not wake idle sessions
}

// ── Worktree / Kanban ───────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum StackRebaseStatus {
    UpToDate,
    Behind { count: u32 },
    Rebasing,
    Conflict,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub id: String,
    pub name: String,
    pub path: String,
    pub branch: String,
    pub repo_path: String,
    pub pr_status: Option<PrStatus>,
    pub agent_status: AgentState,
    pub column: KanbanColumn,
    pub is_branch_mode: bool,
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
    /// Epoch milliseconds of the latest commit on this branch.
    #[serde(default)]
    pub last_commit_epoch: Option<i64>,
    /// Name of the author of the latest commit on this branch (for sorting).
    #[serde(default)]
    pub last_commit_author: Option<String>,
    /// URL of the Linear ticket this worktree was created from (if any).
    #[serde(default)]
    pub linear_ticket_url: Option<String>,
    /// Human-readable Linear identifier (e.g. "ROS-42").
    #[serde(default)]
    pub linear_ticket_identifier: Option<String>,
    #[serde(default)]
    pub stack_parent: Option<String>,
    #[serde(default)]
    pub stack_children: Vec<String>,
    #[serde(default)]
    pub stack_rebase_status: Option<StackRebaseStatus>,
    /// Error from post-create setup scripts. The worktree itself was created
    /// successfully; this surfaces script failure without failing the whole op.
    #[serde(default)]
    pub setup_script_error: Option<String>,
    /// Auto-assigned dev server port for this worktree.
    #[serde(default)]
    pub assigned_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum KanbanColumn {
    ToDo,
    InProgress,
    Blocked,
    DraftPr,
    OpenPr,
    NeedsReview,
    Done,
}

/// What to create a worktree from.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum WorktreeSource {
    NewBranch { name: String, base: String },
    ExistingBranch { name: String, new_name: Option<String> },
    PullRequest { number: u64 },
    LinearTicket { id: String, base: Option<String> },
}

// ── GitHub ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrStatus {
    pub number: u64,
    pub state: String,
    pub title: String,
    pub url: String,
    pub draft: bool,
    pub merged: bool,
    /// The head branch name for this PR (used to match PRs to worktrees).
    #[serde(default)]
    pub branch: String,
    /// The base (target) branch for this PR (e.g. "develop", "main").
    #[serde(default)]
    pub base_branch: Option<String>,
    #[serde(default)]
    pub merged_at: Option<String>,
    #[serde(default)]
    pub head_sha: Option<String>,
    #[serde(default)]
    pub merge_commit_sha: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    /// ISO 8601 timestamp of the last update to this PR (from GitHub API).
    #[serde(default)]
    pub updated_at: Option<String>,
    /// GitHub login of the PR author (used for "In Review" vs "Needs Review" column).
    #[serde(default)]
    pub author: Option<String>,
    /// GitHub logins of users requested to review this PR.
    #[serde(default)]
    pub requested_reviewers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckRun {
    pub id: u64,
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub html_url: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    #[serde(default)]
    pub check_suite_id: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrReview {
    pub reviewer: String,
    pub state: String,       // "approved", "changes_requested", "pending", "dismissed"
    pub submitted_at: Option<String>,
    /// Top-level review body (e.g. cubic's summary). `None` for review stubs
    /// that only carry inline comments.
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrComment {
    pub id: u64,
    pub author: String,
    pub body: String,
    pub path: Option<String>,
    pub line: Option<u32>,
    pub resolved: bool,
    pub created_at: String,
    pub updated_at: String,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunLog {
    pub job_name: String,
    pub step_name: String,
    pub log_excerpt: String,
}

/// Detailed PR info fetched on-demand when the PR tab is opened.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrDetailedStatus {
    pub reviews: Vec<PrReview>,
    pub comments: Vec<PrComment>,
    pub mergeable: Option<bool>,
    pub review_decision: Option<String>,
    pub requested_reviewers: Vec<String>,
}

// ── Config ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetupScript {
    pub name: String,
    pub command: String,
    pub run_on: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RunScript {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_sound")]
    pub sound: String,
    #[serde(default = "default_true")]
    pub notify_on_waiting: bool,
    #[serde(default = "default_true")]
    pub notify_on_idle: bool,
    #[serde(default)]
    pub notify_on_error: bool,
}

fn default_sound() -> String { "chime".to_string() }
fn default_true() -> bool { true }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeDefaults {
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(default)]
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub dangerously_skip_permissions: Option<bool>,
    #[serde(default)]
    pub output_style: Option<String>,
    #[serde(default)]
    pub verbose: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeOverrides {
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(default)]
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub output_style: Option<String>,
}

/// Repo-wide config that lives in `<repo>/alfredo.json` (committed). Every
/// field is optional. `None` means "not specified by the repo" — fall through
/// to the personal-overrides layer or the code default.
#[derive(Debug, Clone, Default, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RepoSharedConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup_scripts: Option<Vec<SetupScript>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_script: Option<RunScript>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archive_script: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port_env_var: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port_range_start: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port_range_end: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub repo_path: String,
    pub setup_scripts: Vec<SetupScript>,
    #[serde(default)]
    pub run_script: Option<RunScript>,
    pub github_token: Option<String>,
    pub linear_api_key: Option<String>,
    pub branch_mode: bool,
    #[serde(default)]
    pub column_overrides: HashMap<String, KanbanColumn>,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub notifications: Option<NotificationConfig>,
    #[serde(default)]
    pub worktree_base_path: Option<String>,
    #[serde(default)]
    pub claude_defaults: Option<ClaudeDefaults>,
    #[serde(default)]
    pub worktree_overrides: Option<HashMap<String, ClaudeOverrides>>,
    /// Maps worktree name → parent branch name for stacked branches.
    #[serde(default)]
    pub stack_parent_overrides: HashMap<String, String>,
    #[serde(default)]
    pub archive_script: Option<String>,
    /// Maps worktree name → Linear ticket reference for worktrees created from a Linear ticket.
    #[serde(default)]
    pub linear_tickets: HashMap<String, LinearTicketRef>,
    /// Maps worktree name → assigned dev server port.
    #[serde(default)]
    pub port_assignments: HashMap<String, u16>,
    /// Whether to auto-assign dev server ports to worktrees.
    #[serde(default)]
    pub auto_assign_ports: bool,
    /// Environment variable name to inject the assigned port as (defaults to "PORT").
    #[serde(default)]
    pub port_env_var: Option<String>,
    /// Inclusive lower bound of the dev-server port range. `None` means the
    /// user hasn't configured a range — auto-assign is treated as disabled
    /// regardless of `auto_assign_ports` until both bounds are set.
    #[serde(default)]
    pub port_range_start: Option<u16>,
    /// Inclusive upper bound. See `port_range_start`.
    #[serde(default)]
    pub port_range_end: Option<u16>,
}

/// Persisted Linear ticket metadata for a worktree. Survives app restart so the
/// StatusBar "Open in Linear" button and related UI stay populated.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LinearTicketRef {
    pub url: String,
    pub identifier: String,
}

pub fn default_archive_days() -> Option<u32> { Some(2) }

// ── Linear OAuth ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearOAuthTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}

// ── App-Level Config ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum RepoMode {
    Worktree,
    Branch,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoEntry {
    pub path: String,
    pub mode: RepoMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalAppConfig {
    #[serde(default)]
    pub repos: Vec<RepoEntry>,
    #[serde(default)]
    pub active_repo: Option<String>,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub notifications: Option<NotificationConfig>,
    #[serde(default)]
    pub selected_repos: Vec<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub repo_colors: HashMap<String, String>,
    #[serde(default)]
    pub repo_display_names: HashMap<String, String>,
    /// Optional 1–4 char badge label shown on sidebar cards. Falls back to
    /// `repo_display_names` initials when unset.
    #[serde(default)]
    pub repo_short_labels: HashMap<String, String>,
    #[serde(default)]
    pub worktree_labels: HashMap<String, String>,
    #[serde(default = "default_editor")]
    pub preferred_editor: String,
    #[serde(default)]
    pub custom_editor_path: Option<String>,
    #[serde(default = "default_terminal")]
    pub preferred_terminal: String,
    #[serde(default)]
    pub custom_terminal_path: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(default)]
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub dangerously_skip_permissions: Option<bool>,
    #[serde(default)]
    pub output_style: Option<String>,
    #[serde(default)]
    pub verbose: Option<bool>,
    #[serde(default)]
    pub default_diff_view_mode: Option<String>,
    #[serde(default)]
    pub collapsed_kanban_columns: Vec<String>,
    #[serde(default)]
    pub sidebar_collapsed: Option<bool>,
    #[serde(default)]
    pub hide_unpinned_worktrees: Option<bool>,
    /// Worktree-mode repos for which a synthetic "main branch" card is shown
    /// in the sidebar. Opt-in per repo.
    #[serde(default)]
    pub show_main_card_repos: Vec<String>,
    #[serde(default)]
    pub has_seen_orientation: bool,
    #[serde(default)]
    pub active_worktree_id: Option<String>,
    #[serde(default)]
    pub linear_oauth: Option<LinearOAuthTokens>,
    #[serde(default)]
    pub default_agent: Option<String>,
    #[serde(default = "default_archive_days")]
    pub archive_after_days: Option<u32>,
    #[serde(default)]
    pub delete_after_days: Option<u32>,
    #[serde(default)]
    pub dismissed_lifecycle_nudge: bool,
    #[serde(default)]
    pub debug_mode: Option<bool>,
    #[serde(default)]
    pub comment_chips: Vec<String>,
    /// Opt in to pre-release builds from the beta update channel.
    #[serde(default)]
    pub receive_beta_updates: bool,
}

fn default_editor() -> String { "vscode".into() }
fn default_terminal() -> String { "iterm".into() }

// ── Linear ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinearTicket {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub url: String,
    pub state: String,
    pub labels: Vec<String>,
    pub assignee: Option<String>,
    #[serde(default)]
    pub branch_name: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinearTeam {
    pub id: String,
    pub name: String,
    pub key: String,
}

// ── Port claim ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortHolder {
    pub worktree_name: String,
    pub port: u16,
}

/// Outcome of a port-claim attempt. Exhaustion is modelled in the Ok path so
/// the frontend can render a choice dialog without fighting the AppError
/// string serializer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PortClaimResult {
    /// Port was assigned (new or pre-existing sticky claim).
    Assigned { port: u16 },
    /// Auto-assign is off — caller should not inject a port env var.
    Disabled,
    /// Every port in the configured range is already held by another worktree.
    /// `rename_all_fields` is required: a serde enum's `rename_all` only renames
    /// variant tags, so without it `range_start` / `range_end` ship as snake_case
    /// and the TS dialog reads `undefined` → renders "All NaN ports in use".
    RangeFull {
        range_start: u16,
        range_end: u16,
        holders: Vec<PortHolder>,
    },
}

/// Outcome of an atomic port-take. `previous_holder` lets the frontend stop
/// the holder's dev server and surface an Undo toast when the take displaced
/// a running session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum TakePortResult {
    Taken {
        port: u16,
        previous_holder: Option<String>,
    },
    /// Auto-assign is off or the range isn't set — caller should fall back to
    /// no-port behaviour. Mirrors `PortClaimResult::Disabled` so callers can
    /// branch identically on either result.
    Disabled,
}

// ── Errors ──────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("PTY error: {0}")]
    Pty(String),
    #[error("Git error: {0}")]
    Git(String),
    #[error("GitHub error: {0}")]
    Github(String),
    #[error("Linear error: {0}")]
    Linear(String),
    #[error("Config error: {0}")]
    Config(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_claim_result_range_full_serializes_camel_case_fields() {
        // Guards against `rename_all` on the enum being dropped or replaced —
        // serde only renames variant tags, not struct-variant fields, so the
        // explicit `rename_all_fields = "camelCase"` is what keeps the TS
        // dialog from rendering "All NaN ports in use".
        let value = PortClaimResult::RangeFull {
            range_start: 3000,
            range_end: 3005,
            holders: vec![PortHolder {
                worktree_name: "wt-1".to_string(),
                port: 3001,
            }],
        };
        let json = serde_json::to_value(&value).unwrap();
        assert_eq!(json["kind"], "rangeFull");
        assert_eq!(json["rangeStart"], 3000);
        assert_eq!(json["rangeEnd"], 3005);
        assert_eq!(json["holders"][0]["worktreeName"], "wt-1");
        assert_eq!(json["holders"][0]["port"], 3001);
    }
}

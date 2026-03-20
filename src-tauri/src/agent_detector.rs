use std::time::Instant;

use crate::types::{AgentState, AgentType};

/// Grace period after a resize event — suppress false detections during terminal reflow.
const RESIZE_GRACE_MS: u128 = 150;

/// Echo suppression window after user input — avoid misdetecting echoed commands.
const ECHO_SUPPRESS_MS: u128 = 100;

/// Detects which AI coding agent is running in a PTY and tracks its state
/// by pattern-matching on terminal output.
pub struct AgentDetector {
    agent_type: AgentType,
    state: AgentState,
    /// Timestamp of last resize event (for grace period).
    last_resize: Option<Instant>,
    /// Timestamp of last user input (for echo suppression).
    last_input: Option<Instant>,
    /// Accumulates partial lines for pattern matching.
    line_buf: String,
}

impl AgentDetector {
    pub fn new() -> Self {
        Self {
            agent_type: AgentType::Unknown,
            state: AgentState::NotRunning,
            last_resize: None,
            last_input: None,
            line_buf: String::new(),
        }
    }

    /// Call when the terminal is resized. Starts a grace period during which
    /// state changes are suppressed to avoid false detections from reflow.
    pub fn notify_resize(&mut self) {
        self.last_resize = Some(Instant::now());
    }

    /// Set resize timestamp from an external source (cross-thread signalling).
    pub fn notify_resize_at(&mut self, ts: Instant) {
        // Only update if this timestamp is newer
        if self.last_resize.map_or(true, |prev| ts > prev) {
            self.last_resize = Some(ts);
        }
    }

    /// Call when user input is sent to the PTY. Starts an echo suppression
    /// window to avoid misdetecting echoed commands as agent output.
    pub fn notify_input(&mut self) {
        self.last_input = Some(Instant::now());
    }

    /// Set input timestamp from an external source (cross-thread signalling).
    pub fn notify_input_at(&mut self, ts: Instant) {
        if self.last_input.map_or(true, |prev| ts > prev) {
            self.last_input = Some(ts);
        }
    }

    /// Current detected agent type.
    pub fn agent_type(&self) -> &AgentType {
        &self.agent_type
    }

    /// Current detected state.
    pub fn state(&self) -> &AgentState {
        &self.state
    }

    /// Feed raw PTY output bytes into the detector. Returns `Some(...)` only
    /// when the detected `(AgentType, AgentState)` changes from the previous value.
    pub fn feed(&mut self, data: &[u8]) -> Option<(AgentType, AgentState)> {
        // Check suppression windows
        if let Some(ts) = self.last_resize {
            if ts.elapsed().as_millis() < RESIZE_GRACE_MS {
                return None;
            }
        }
        if let Some(ts) = self.last_input {
            if ts.elapsed().as_millis() < ECHO_SUPPRESS_MS {
                return None;
            }
        }

        // Convert bytes to string (lossy — terminal output may contain partial UTF-8)
        let text = String::from_utf8_lossy(data);

        // Accumulate into line buffer and process complete lines
        self.line_buf.push_str(&text);

        // Process all complete lines plus the trailing partial
        let mut new_type = self.agent_type.clone();
        let mut new_state = self.state.clone();

        // Split on newlines but keep the last chunk (may be incomplete)
        let parts: Vec<&str> = self.line_buf.split('\n').collect();
        let (complete_lines, remainder) = parts.split_at(parts.len() - 1);

        for line in complete_lines {
            let (t, s) = Self::classify_line(line, &self.agent_type);
            if let Some(t) = t {
                new_type = t;
            }
            if let Some(s) = s {
                new_state = s;
            }
        }

        // Also check the remainder (partial line) for prompt patterns
        if let Some(remainder) = remainder.first() {
            let (t, s) = Self::classify_line(remainder, &self.agent_type);
            if let Some(t) = t {
                new_type = t;
            }
            if let Some(s) = s {
                new_state = s;
            }
        }

        // Keep only the last partial line
        if let Some(r) = parts.last() {
            self.line_buf = r.to_string();
        }

        // Truncate line buffer if it grows too large (safety valve)
        if self.line_buf.len() > 4096 {
            self.line_buf = self.line_buf[self.line_buf.len() - 1024..].to_string();
        }

        // Only emit when something changed
        if new_type != self.agent_type || new_state != self.state {
            self.agent_type = new_type.clone();
            self.state = new_state.clone();
            Some((new_type, new_state))
        } else {
            None
        }
    }

    /// Classify a single line of output. Returns optional updates to agent type and state.
    fn classify_line(
        line: &str,
        current_type: &AgentType,
    ) -> (Option<AgentType>, Option<AgentState>) {
        // Strip ANSI escape sequences for matching
        let clean = strip_ansi(line);
        let trimmed = clean.trim();

        // ── Agent launch detection ──────────────────────────────────
        // Detect when an agent binary is launched from the shell
        if is_agent_launch(trimmed, "claude") {
            return (Some(AgentType::ClaudeCode), Some(AgentState::Busy));
        }
        if is_agent_launch(trimmed, "codex") {
            return (Some(AgentType::Codex), Some(AgentState::Busy));
        }
        if is_agent_launch(trimmed, "aider") {
            return (Some(AgentType::Aider), Some(AgentState::Busy));
        }

        // ── Per-agent state detection ───────────────────────────────
        match current_type {
            AgentType::ClaudeCode => classify_claude_code(trimmed),
            AgentType::Codex => classify_codex(trimmed),
            AgentType::Aider => classify_aider(trimmed),
            AgentType::Unknown => classify_shell(trimmed),
        }
    }
}

/// Check if a line looks like launching an agent command.
/// Matches patterns like `$ claude`, `claude --flag`, etc.
fn is_agent_launch(line: &str, agent_cmd: &str) -> bool {
    // Remove common shell prompt prefixes
    let after_prompt = line
        .trim_start_matches(|c: char| c == '$' || c == '>' || c == '%' || c.is_whitespace());

    // The first word should be the agent command
    let first_word = after_prompt.split_whitespace().next().unwrap_or("");

    // Match exact command or path ending in the command (e.g. /usr/local/bin/claude)
    first_word == agent_cmd || first_word.ends_with(&format!("/{agent_cmd}"))
}

/// Claude Code state detection
fn classify_claude_code(line: &str) -> (Option<AgentType>, Option<AgentState>) {
    // Permission / approval prompts
    if line.contains("Allow") && line.contains("Deny") {
        return (None, Some(AgentState::WaitingForInput));
    }
    // "Do you want to proceed?" style prompts
    if line.contains("Do you want to") || line.contains("(y/n)") || line.contains("[Y/n]") {
        return (None, Some(AgentState::WaitingForInput));
    }

    // Idle prompt — Claude Code shows a `❯` or `>` prompt when waiting for user input
    // The prompt line is typically short and ends with the prompt char
    if line_is_claude_prompt(line) {
        return (None, Some(AgentState::Idle));
    }

    // Exit detection — back to shell
    if line.contains("exited") || line.contains("Goodbye") {
        return (Some(AgentType::Unknown), Some(AgentState::NotRunning));
    }

    // If we see substantial output, agent is busy
    if line.len() > 3 {
        return (None, Some(AgentState::Busy));
    }

    (None, None)
}

/// Check if line looks like a Claude Code idle prompt
fn line_is_claude_prompt(line: &str) -> bool {
    let trimmed = line.trim();
    // Common Claude Code prompt patterns:
    // "❯ " at end (or just "❯")
    // "> " at end after the agent has been running
    trimmed.ends_with('❯')
        || trimmed.ends_with("❯ ")
        || (trimmed.len() < 20 && trimmed.ends_with("> "))
        || (trimmed.len() < 20 && trimmed.ends_with('>'))
}

/// Codex state detection
fn classify_codex(line: &str) -> (Option<AgentType>, Option<AgentState>) {
    // Approval prompts
    if line.contains("approve") || line.contains("Approve") || line.contains("deny") {
        return (None, Some(AgentState::WaitingForInput));
    }
    if line.contains("(y/n)") || line.contains("[Y/n]") {
        return (None, Some(AgentState::WaitingForInput));
    }

    // Idle prompt
    if line.ends_with("> ") || line.ends_with(">>> ") {
        return (None, Some(AgentState::Idle));
    }

    // Exit
    if line.contains("exited") || line.contains("Goodbye") {
        return (Some(AgentType::Unknown), Some(AgentState::NotRunning));
    }

    if line.len() > 3 {
        return (None, Some(AgentState::Busy));
    }

    (None, None)
}

/// Aider state detection
fn classify_aider(line: &str) -> (Option<AgentType>, Option<AgentState>) {
    // Aider uses ">" as its prompt. Short line ending with > is idle.
    if line.trim() == ">" || line.ends_with("> ") && line.len() < 20 {
        return (None, Some(AgentState::Idle));
    }

    // Aider asks for confirmation
    if line.contains("(Y)es/(N)o") || line.contains("[Yes]") {
        return (None, Some(AgentState::WaitingForInput));
    }

    // Exit
    if line.contains("exited") || line.contains("Goodbye") {
        return (Some(AgentType::Unknown), Some(AgentState::NotRunning));
    }

    if line.len() > 3 {
        return (None, Some(AgentState::Busy));
    }

    (None, None)
}

/// Plain shell — just detect if someone types an agent command
fn classify_shell(line: &str) -> (Option<AgentType>, Option<AgentState>) {
    // We're in "no agent" mode. State stays NotRunning.
    // Agent launches are caught in classify_line before we get here.
    let _ = line;
    (None, None)
}

/// Strip ANSI escape sequences from a string.
fn strip_ansi(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // Skip ESC [ ... (letter) sequence
            if chars.peek() == Some(&'[') {
                chars.next(); // consume '['
                // Consume until we hit a letter (the terminator)
                while let Some(&next) = chars.peek() {
                    chars.next();
                    if next.is_ascii_alphabetic() || next == '~' {
                        break;
                    }
                }
            }
            // Also skip ESC ] ... BEL/ST (OSC sequences)
            else if chars.peek() == Some(&']') {
                chars.next();
                while let Some(&next) = chars.peek() {
                    chars.next();
                    if next == '\x07' || next == '\\' {
                        break;
                    }
                }
            }
            // Single-char escape sequences
            else {
                chars.next();
            }
        } else if c == '\r' {
            // Skip carriage returns
            continue;
        } else {
            result.push(c);
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_claude_code_launch() {
        let mut det = AgentDetector::new();
        let result = det.feed(b"$ claude\n");
        assert_eq!(
            result,
            Some((AgentType::ClaudeCode, AgentState::Busy))
        );
    }

    #[test]
    fn detects_codex_launch() {
        let mut det = AgentDetector::new();
        let result = det.feed(b"$ codex\n");
        assert_eq!(result, Some((AgentType::Codex, AgentState::Busy)));
    }

    #[test]
    fn detects_aider_launch() {
        let mut det = AgentDetector::new();
        let result = det.feed(b"$ aider\n");
        assert_eq!(result, Some((AgentType::Aider, AgentState::Busy)));
    }

    #[test]
    fn detects_claude_code_idle_prompt() {
        let mut det = AgentDetector::new();
        // First launch Claude
        det.feed(b"$ claude\n");
        // Then show idle prompt
        let result = det.feed(b"\xe2\x9d\xaf \n"); // "❯ \n"
        assert_eq!(
            result,
            Some((AgentType::ClaudeCode, AgentState::Idle))
        );
    }

    #[test]
    fn detects_claude_code_permission_prompt() {
        let mut det = AgentDetector::new();
        det.feed(b"$ claude\n");
        let result = det.feed(b"Allow this action? Allow / Deny\n");
        assert_eq!(
            result,
            Some((AgentType::ClaudeCode, AgentState::WaitingForInput))
        );
    }

    #[test]
    fn detects_claude_code_busy() {
        let mut det = AgentDetector::new();
        det.feed(b"$ claude\n");
        // Simulate idle first
        det.feed(b"\xe2\x9d\xaf \n");
        // Then busy output
        let result = det.feed(b"Reading file src/main.rs and analyzing...\n");
        assert_eq!(
            result,
            Some((AgentType::ClaudeCode, AgentState::Busy))
        );
    }

    #[test]
    fn detects_aider_idle_prompt() {
        let mut det = AgentDetector::new();
        det.feed(b"$ aider\n");
        let result = det.feed(b"> \n");
        assert_eq!(result, Some((AgentType::Aider, AgentState::Idle)));
    }

    #[test]
    fn detects_aider_waiting_for_input() {
        let mut det = AgentDetector::new();
        det.feed(b"$ aider\n");
        let result = det.feed(b"Apply changes? (Y)es/(N)o\n");
        assert_eq!(
            result,
            Some((AgentType::Aider, AgentState::WaitingForInput))
        );
    }

    #[test]
    fn returns_none_when_state_unchanged() {
        let mut det = AgentDetector::new();
        det.feed(b"$ claude\n");
        // Already busy from launch — feeding more busy output should return None
        let result = det.feed(b"Still processing more output...\n");
        assert_eq!(result, None);
    }

    #[test]
    fn detects_agent_exit() {
        let mut det = AgentDetector::new();
        det.feed(b"$ claude\n");
        let result = det.feed(b"Goodbye!\n");
        assert_eq!(
            result,
            Some((AgentType::Unknown, AgentState::NotRunning))
        );
    }

    #[test]
    fn suppresses_during_resize_grace() {
        let mut det = AgentDetector::new();
        det.feed(b"$ claude\n");
        det.notify_resize();
        // Should be suppressed during grace period
        let result = det.feed(b"\xe2\x9d\xaf \n");
        assert_eq!(result, None);
    }

    #[test]
    fn suppresses_echo_after_input() {
        let mut det = AgentDetector::new();
        det.feed(b"$ claude\n");
        det.notify_input();
        // Should be suppressed during echo window
        let result = det.feed(b"some echoed text\n");
        assert_eq!(result, None);
    }

    #[test]
    fn strips_ansi_sequences() {
        let result = strip_ansi("\x1b[32mHello\x1b[0m World");
        assert_eq!(result, "Hello World");
    }

    #[test]
    fn agent_launch_with_path() {
        let mut det = AgentDetector::new();
        let result = det.feed(b"$ /usr/local/bin/claude --flag\n");
        assert_eq!(
            result,
            Some((AgentType::ClaudeCode, AgentState::Busy))
        );
    }

    #[test]
    fn no_false_detect_on_plain_shell() {
        let mut det = AgentDetector::new();
        // Regular shell output should not trigger any state change
        // (state is already NotRunning / Unknown from init)
        let result = det.feed(b"ls -la\ntotal 42\n");
        assert_eq!(result, None);
    }

    #[test]
    fn handles_ansi_in_claude_prompt() {
        let mut det = AgentDetector::new();
        det.feed(b"$ claude\n");
        // Prompt with ANSI color codes around the ❯
        let result = det.feed(b"\x1b[36m\xe2\x9d\xaf\x1b[0m \n");
        assert_eq!(
            result,
            Some((AgentType::ClaudeCode, AgentState::Idle))
        );
    }

    #[test]
    fn codex_approval_prompt() {
        let mut det = AgentDetector::new();
        det.feed(b"$ codex\n");
        let result = det.feed(b"Do you approve this change? (y/n)\n");
        assert_eq!(
            result,
            Some((AgentType::Codex, AgentState::WaitingForInput))
        );
    }
}

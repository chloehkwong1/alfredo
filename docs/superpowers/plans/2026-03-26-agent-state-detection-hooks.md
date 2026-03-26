# Agent State Detection: Expanded Hooks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix inaccurate agent status by registering 6 additional Claude Code hooks and reducing the detector suppression window.

**Architecture:** Add new hook entries to the existing `write_hooks_config()` function in Rust, and reduce `HOOK_AUTHORITY_MS` in the TypeScript session manager. No new files, types, or infrastructure needed.

**Tech Stack:** Rust (Tauri backend), TypeScript (React frontend)

---

### Task 1: Add new hook entries to `write_hooks_config()`

**Files:**
- Modify: `src-tauri/src/pty_manager.rs:401-418`

- [ ] **Step 1: Add the 6 new hook entries**

In `src-tauri/src/pty_manager.rs`, expand the `alfredo_hooks` vec starting at line 401. Add these entries after the existing `Notification` entry (before the closing `];`):

```rust
        ("SubagentStart", serde_json::json!({
            "hooks": [{ "type": "http", "url": format!("{base_url}/agent-state/{worktree_id}/busy") }]
        })),
        ("SubagentStop", serde_json::json!({
            "hooks": [{ "type": "http", "url": format!("{base_url}/agent-state/{worktree_id}/busy") }]
        })),
        ("PostToolUse", serde_json::json!({
            "hooks": [{ "type": "http", "url": format!("{base_url}/agent-state/{worktree_id}/busy") }]
        })),
        ("TaskCreated", serde_json::json!({
            "hooks": [{ "type": "http", "url": format!("{base_url}/agent-state/{worktree_id}/busy") }]
        })),
        ("TaskCompleted", serde_json::json!({
            "hooks": [{ "type": "http", "url": format!("{base_url}/agent-state/{worktree_id}/busy") }]
        })),
        ("StopFailure", serde_json::json!({
            "hooks": [{ "type": "http", "url": format!("{base_url}/agent-state/{worktree_id}/idle") }]
        })),
```

- [ ] **Step 2: Build to verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors.

- [ ] **Step 3: Run existing tests**

Run: `cd src-tauri && cargo test`
Expected: All tests pass (state_server tests, detector tests).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/pty_manager.rs
git commit -m "feat(hooks): register SubagentStart, SubagentStop, PostToolUse, TaskCreated, TaskCompleted, StopFailure hooks"
```

---

### Task 2: Reduce `HOOK_AUTHORITY_MS`

**Files:**
- Modify: `src/services/sessionManager.ts:21`

- [ ] **Step 1: Change the constant**

In `src/services/sessionManager.ts` line 21, change:

```typescript
const HOOK_AUTHORITY_MS = 5_000;
```

to:

```typescript
const HOOK_AUTHORITY_MS = 3_000;
```

- [ ] **Step 2: Build frontend to verify**

Run: `npm run build`
Expected: Builds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/sessionManager.ts
git commit -m "feat(hooks): reduce detector suppression window to 3s"
```

---

### Task 3: Manual verification

- [ ] **Step 1: Restart the app**

Run: `/restart` or rebuild with `cargo tauri dev`.

- [ ] **Step 2: Verify hooks are written**

Open `.claude/settings.local.json` in any worktree and confirm all 11 hooks are present: `SessionStart`, `UserPromptSubmit`, `Stop`, `PreToolUse`, `Notification`, `SubagentStart`, `SubagentStop`, `PostToolUse`, `TaskCreated`, `TaskCompleted`, `StopFailure`.

- [ ] **Step 3: Trigger subagent work**

Ask Claude Code to perform a task that spawns subagents (e.g., "Research how X works in this codebase"). Verify the sidebar shows "Thinking..." throughout the subagent work, not "Idle".

- [ ] **Step 4: Verify idle detection**

After the agent finishes and shows the `>` prompt, verify the sidebar transitions to "Idle" (or "Done" if unseen).

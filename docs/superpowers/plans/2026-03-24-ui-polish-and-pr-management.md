# UI Polish & PR Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevate Alfredo's UI polish to Conductor.build parity — add animations, richer sidebar items, PR status/CI viewing, and smoother transitions throughout.

**Architecture:** Three workstreams executed in dependency order: (1) animation/transition polish across existing components, (2) sidebar upgrade with richer agent items and state indicators, (3) PR detail panel with GitHub Actions/CI status viewing. The Rust backend gains a new `get_check_runs` command using octocrab's checks API. Frontend adds a `PrDetailPanel` component and animates existing components with Framer Motion (already installed, currently unused).

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Framer Motion 12.38, Zustand, Radix UI, Lucide icons, Tauri v2 (Rust backend with octocrab), xterm.js

---

## File Structure

### New Files
- `src/components/pr/PrDetailPanel.tsx` — PR status view with CI checks, shown as a tab or panel
- `src/components/pr/CheckRunItem.tsx` — Individual CI check run display (status icon, name, duration, link)
- `src/components/pr/PrHeader.tsx` — PR title, number, state badge, and "Open on GitHub" link
- `src-tauri/src/commands/checks.rs` — Tauri command to fetch GitHub Actions check runs via octocrab

### Modified Files
- `src/components/layout/AppShell.tsx` — Add animated tab transitions, PR tab support
- `src/components/layout/StatusBar.tsx` — Enrich with PR info, CI status indicator, clickable PR link
- `src/components/sidebar/Sidebar.tsx` — Animated sidebar expand/collapse transitions
- `src/components/sidebar/AgentItem.tsx` — Add pulsing status dot, richer info (PR title, +/- stats), hover preview
- `src/components/sidebar/StatusGroup.tsx` — Animated expand/collapse for groups, item count badge
- `src/stores/workspaceStore.ts` — Add `checkRuns` state per worktree, PR tab type
- `src/types.ts` — Add `CheckRun`, `CheckStatus` types, extend `TabType` with `"pr"`
- `src/api.ts` — Add `getCheckRuns()` invoke wrapper
- `src/styles/globals.css` — Add pulse animation keyframes for status dots
- `src-tauri/src/github_manager.rs` — Add `get_check_runs()` method using octocrab checks API
- `src-tauri/src/commands/mod.rs` — Register checks module
- `src-tauri/src/lib.rs` — Register new check_runs command handler
- `src-tauri/src/types.rs` — Add `CheckRun` Rust type

---

### Task 1: Status Dot Pulse Animation

**Files:**
- Modify: `src/styles/globals.css`
- Modify: `src/components/sidebar/AgentItem.tsx`

- [ ] **Step 1: Add pulse keyframes to globals.css**

Add after the existing `@keyframes card-in` block in `src/styles/globals.css`:

```css
@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.4); }
}
```

And register in the `@theme` block:

```css
--animate-pulse-dot: pulse-dot 2s ease-in-out infinite;
```

- [ ] **Step 2: Apply pulse to busy and waiting dots in AgentItem**

In `src/components/sidebar/AgentItem.tsx`, update the status dot `<span>` to conditionally apply the animation:

```tsx
const shouldPulse = worktree.agentStatus === "busy" || worktree.agentStatus === "waitingForInput";

<span
  className={[
    "mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0",
    getDotColor(worktree.agentStatus),
    shouldPulse ? "animate-pulse-dot" : "",
  ].join(" ")}
/>
```

- [ ] **Step 3: Apply same pulse to collapsed sidebar dots**

In `src/components/sidebar/Sidebar.tsx`, update the collapsed dot buttons to use the same animation. Add pulse for `busy` and `waitingForInput` statuses:

```tsx
const shouldPulse = wt.agentStatus === "busy" || wt.agentStatus === "waitingForInput";

<button
  ...
  className={[
    "h-2.5 w-2.5 rounded-full transition-all cursor-pointer",
    "hover:scale-125",
    statusDotColor[wt.agentStatus] ?? "bg-text-tertiary",
    shouldPulse ? "animate-pulse-dot" : "",
    wt.id === activeWorktreeId ? "ring-1 ring-offset-1 ring-accent-primary ring-offset-bg-secondary" : "",
  ].join(" ")}
/>
```

- [ ] **Step 4: Verify the app builds**

Run: `cd /Users/chloe/dev/alfredo && npm run dev`
Expected: App starts without errors, status dots pulse when agents are busy/waiting.

- [ ] **Step 5: Commit**

```bash
git add src/styles/globals.css src/components/sidebar/AgentItem.tsx src/components/sidebar/Sidebar.tsx
git commit -m "feat: add pulsing status dots for busy and waiting agent states"
```

### Visual Verify:
- connect: 1420
- region: .flex.flex-col.w-\\[260px\\]
- screenshot: /tmp/verify-pulse-dot.png
- assert: Status dots next to agent items should be visible. If any agents are busy or waiting, their dots should appear to animate (pulse).

---

### Task 2: Sidebar Expand/Collapse Animation

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx`
- Modify: `src/components/layout/AppShell.tsx`

- [ ] **Step 1: Animate sidebar width with Framer Motion in AppShell**

In `src/components/layout/AppShell.tsx`, replace the `<motion.div>` wrapper around `<Sidebar>` with a proper width animation:

```tsx
import { AnimatePresence, motion } from "framer-motion";

// In the return, replace the existing motion.div:
const sidebarCollapsed = useWorkspaceStore((s) => s.sidebarCollapsed);

<motion.div
  className="flex-shrink-0 h-full overflow-hidden"
  animate={{ width: sidebarCollapsed ? 48 : 260 }}
  transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
>
  <Sidebar hasRepo={!!repoPath} />
</motion.div>
```

Keep the onboarding-to-normal transition logic (`wasOnboarding`, `shouldAnimateSidebar` refs) — it controls the initial sidebar entrance animation when the first worktree is created. Only replace the expand/collapse behavior. The `sidebarAnimation` spread props should still apply for the initial entrance, but ongoing collapse/expand uses the Framer Motion `animate` prop. Merge both: use `initial={shouldAnimateSidebar.current ? { x: -260, opacity: 0 } : false}` alongside the width animation.

- [ ] **Step 2: Verify smooth sidebar toggle**

Run: `cd /Users/chloe/dev/alfredo && npm run dev`
Expected: Clicking the collapse/expand button smoothly animates the sidebar width instead of snapping.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/AppShell.tsx
git commit -m "feat: animate sidebar expand/collapse with framer-motion"
```

### Visual Verify:
- connect: 1420
- screenshot: /tmp/verify-sidebar-expanded.png
- assert: Sidebar should be visible at ~260px width with agent items listed
- action: click | [aria-label="Collapse sidebar"]
- screenshot: /tmp/verify-sidebar-collapsed.png
- assert: Sidebar should be narrow (~48px) showing only dots and icons

---

### Task 3: StatusGroup Animated Expand/Collapse

**Files:**
- Modify: `src/components/sidebar/StatusGroup.tsx`

- [ ] **Step 1: Wrap group items in AnimatePresence + motion.div**

In `src/components/sidebar/StatusGroup.tsx`, replace the conditional rendering of items with an animated version:

```tsx
import { AnimatePresence, motion } from "framer-motion";

// Replace the existing conditional rendering of worktree items:
<AnimatePresence initial={false}>
  {!isCollapsed && (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
      className="overflow-hidden"
    >
      {worktrees.map((wt) => (
        <AgentItem
          key={wt.id}
          worktree={wt}
          isSelected={wt.id === activeWorktreeId}
          onClick={() => onSelectWorktree(wt.id)}
        />
      ))}
    </motion.div>
  )}
</AnimatePresence>
```

- [ ] **Step 2: Replace existing item count with styled badge**

The existing StatusGroup header already shows a count (lines 79-81 in `StatusGroup.tsx`). Replace it with a styled version:

```tsx
// Replace the existing count span:
//   {worktrees.length > 0 && (
//     <span className="text-[11px] font-medium">{worktrees.length}</span>
//   )}
// With:
<span className="ml-auto text-[10px] text-text-tertiary tabular-nums">
  {worktrees.length}
</span>
```

Place this before the chevron icon so the count appears on the right side of the header. Remove the old count span to avoid duplication.

- [ ] **Step 3: Verify animated group toggle**

Run: `cd /Users/chloe/dev/alfredo && npm run dev`
Expected: Clicking a status group header smoothly animates the content expanding/collapsing. Count badge shows number of items.

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar/StatusGroup.tsx
git commit -m "feat: animate status group expand/collapse, add item count badge"
```

### Visual Verify:
- connect: 1420
- region: .flex.flex-col.w-\\[260px\\]
- screenshot: /tmp/verify-status-group.png
- assert: Status groups should show column headers with item count badges (e.g., "In Progress 2")

---

### Task 4: Tab Bar Transition Polish

**Files:**
- Modify: `src/components/layout/AppShell.tsx`

- [ ] **Step 1: Add animated underline indicator to TabBar**

Replace the static `border-b-2` on active tabs with a `motion.div` layoutId underline:

```tsx
import { motion } from "framer-motion";

// Inside the tab button, replace border-b-2 styling:
// Remove: isActive ? "border-b-2 border-b-accent-primary" : "border-b-2 border-b-transparent"
// Add: always "border-b-2 border-b-transparent" for spacing, plus:

{isActive && (
  <motion.div
    layoutId={`tab-underline-${activeWorktreeId}`}
    className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-primary"
    transition={{ type: "spring", stiffness: 500, damping: 35 }}
  />
)}
```

Ensure the tab button has `relative` in its className (already there).

- [ ] **Step 2: Animate the add-tab dropdown**

Replace the raw dropdown div with a motion.div for the popup menu:

```tsx
import { AnimatePresence, motion } from "framer-motion";

// Replace the menuOpen && (...) block:
<AnimatePresence>
  {menuOpen && (
    <>
      <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
      <motion.div
        initial={{ opacity: 0, y: -4, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.95 }}
        transition={{ duration: 0.12 }}
        className="absolute top-full left-0 mt-1 bg-bg-secondary border border-border-default rounded-[var(--radius-md)] shadow-lg py-1 z-20 min-w-[160px]"
      >
        {/* existing menu items */}
      </motion.div>
    </>
  )}
</AnimatePresence>
```

- [ ] **Step 3: Verify tab transitions**

Run: `cd /Users/chloe/dev/alfredo && npm run dev`
Expected: Switching tabs shows a smooth sliding underline. The add-tab menu animates open/close.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/AppShell.tsx
git commit -m "feat: animated tab underline and dropdown transitions"
```

### Visual Verify:
- connect: 1420
- region: .flex.items-center.h-9.bg-bg-secondary
- screenshot: /tmp/verify-tab-bar.png
- assert: Tab bar should show tabs (Claude, Shell, Changes) with an accent-colored underline under the active tab

---

### Task 5: Richer AgentItem with PR Title and Diff Stats

**Files:**
- Modify: `src/components/sidebar/AgentItem.tsx`
- Modify: `src/types.ts`
- Modify: `src-tauri/src/types.rs`
- Modify: `src-tauri/src/commands/worktree.rs`
- Modify: `src/api.ts`

- [ ] **Step 1: Add diffStats to Worktree type (Rust)**

In `src-tauri/src/types.rs`, add to the `Worktree` struct:

```rust
pub additions: Option<u32>,
pub deletions: Option<u32>,
```

- [ ] **Step 2: Add diffStats to Worktree type (TypeScript)**

In `src/types.ts`, add to the `Worktree` interface:

```typescript
additions: number | null;
deletions: number | null;
```

- [ ] **Step 3: Add `get_diff_stats` to git_manager.rs**

In `src-tauri/src/git_manager.rs`, add this function:

```rust
/// Get diff stats (additions, deletions) for uncommitted changes in a worktree.
pub fn get_diff_stats(worktree_path: &str) -> Result<(u32, u32), AppError> {
    let repo = Repository::open(worktree_path)
        .map_err(|e| AppError::Git(format!("failed to open repo for diff stats: {e}")))?;

    let head_tree = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_tree().ok());

    let diff = repo
        .diff_tree_to_workdir_with_index(head_tree.as_ref(), None)
        .map_err(|e| AppError::Git(format!("failed to compute diff: {e}")))?;

    let stats = diff
        .stats()
        .map_err(|e| AppError::Git(format!("failed to get diff stats: {e}")))?;

    Ok((stats.insertions() as u32, stats.deletions() as u32))
}
```

- [ ] **Step 4: Populate diff stats in list_worktrees**

In `src-tauri/src/git_manager.rs`, update `list_worktrees` (line 94) to include diff stats. The `Worktree` struct is constructed at line 94-103 — add the new fields:

```rust
let (additions, deletions) = match get_diff_stats(&wt_path.to_string_lossy()) {
    Ok((a, d)) => (Some(a), Some(d)),
    Err(_) => (None, None),
};

worktrees.push(Worktree {
    id: name.to_string(),
    name: name.to_string(),
    path: wt_path.to_string_lossy().to_string(),
    branch,
    pr_status: None,
    agent_status: AgentState::NotRunning,
    column: KanbanColumn::InProgress,
    is_branch_mode: false,
    additions,
    deletions,
});
```

**Important:** Also update ALL other places that construct a `Worktree` in the Rust codebase to include `additions: None, deletions: None`. These are the known construction sites:
- `src-tauri/src/commands/worktree.rs` — `create_worktree` function (~line 57-66)
- `src-tauri/src/branch_manager.rs` — `list_branches` (~line 34) and `create_branch` (~line 70)
- Verify with `grep -n "Worktree {" src-tauri/src/` to catch any others

Note: `create_worktree_from_pr` and `create_worktree_from_linear` delegate to `create_worktree()` and don't construct `Worktree` directly — no changes needed there.

- [ ] **Step 5: Update AgentItem to show richer content**

In `src/components/sidebar/AgentItem.tsx`, add PR title (truncated) and diff stats:

```tsx
{/* Content */}
<div className="flex-1 min-w-0">
  <div className="flex items-center justify-between gap-2">
    <span className="text-sm font-medium text-text-primary truncate">
      {worktree.branch}
    </span>
    {worktree.prStatus && (
      <span className="text-[10px] text-text-tertiary flex-shrink-0">
        #{worktree.prStatus.number}
      </span>
    )}
  </div>
  {/* PR title - new */}
  {worktree.prStatus && (
    <div className="text-[11px] text-text-tertiary truncate mt-0.5">
      {worktree.prStatus.title}
    </div>
  )}
  <div className="flex items-center gap-2 mt-0.5">
    <span className="text-xs text-text-tertiary truncate">
      {getStatusText(worktree.agentStatus)}
    </span>
    {/* Diff stats - new */}
    {(worktree.additions != null || worktree.deletions != null) && (
      <span className="flex items-center gap-1 text-[10px] ml-auto flex-shrink-0">
        {worktree.additions != null && worktree.additions > 0 && (
          <span className="text-diff-added">+{worktree.additions}</span>
        )}
        {worktree.deletions != null && worktree.deletions > 0 && (
          <span className="text-diff-removed">-{worktree.deletions}</span>
        )}
      </span>
    )}
  </div>
</div>
```

- [ ] **Step 6: Verify richer agent items**

Run: `cd /Users/chloe/dev/alfredo && npm run dev`
Expected: Sidebar items show branch name, PR title (if PR exists), status text, and +/- diff stats.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/types.rs src/types.ts src-tauri/src/commands/worktree.rs src-tauri/src/git_manager.rs src-tauri/src/branch_manager.rs src/components/sidebar/AgentItem.tsx src/api.ts
git commit -m "feat: show PR title and diff stats in sidebar agent items"
```

### Visual Verify:
- connect: 1420
- region: .flex.flex-col.w-\\[260px\\]
- screenshot: /tmp/verify-rich-agent-item.png
- assert: Agent items should show branch name, PR title below it (if PR exists), status text, and green/red diff stats (+N/-N)

---

### Task 6: Enriched Status Bar

**Depends on:** Task 5 (adds `additions` and `deletions` fields to the Worktree type)

**Files:**
- Modify: `src/components/layout/StatusBar.tsx`

- [ ] **Step 1: Add clickable PR link and CI status indicator to StatusBar**

Rewrite `StatusBar.tsx` to show more information:

```tsx
import { ExternalLink } from "lucide-react";
import { open } from "@tauri-apps/plugin-opener";
import type { Worktree } from "../../types";

interface StatusBarProps {
  worktree: Worktree | undefined;
  annotationCount: number;
}

function StatusBar({ worktree, annotationCount }: StatusBarProps) {
  if (!worktree) {
    return (
      <div className="h-7 bg-bg-secondary border-t border-border-default flex-shrink-0" />
    );
  }

  const pr = worktree.prStatus;

  return (
    <div className="h-7 flex items-center justify-between px-4 bg-bg-secondary border-t border-border-default text-xs text-text-tertiary flex-shrink-0">
      {/* Left side */}
      <div className="flex items-center gap-3">
        <span className="font-medium text-text-secondary">{worktree.branch}</span>
        {worktree.additions != null && worktree.additions > 0 && (
          <span className="text-diff-added">+{worktree.additions}</span>
        )}
        {worktree.deletions != null && worktree.deletions > 0 && (
          <span className="text-diff-removed">-{worktree.deletions}</span>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {pr && (
          <button
            type="button"
            onClick={() => open(pr.url)}
            className="flex items-center gap-1 hover:text-text-secondary transition-colors cursor-pointer"
          >
            <span className={pr.draft ? "text-status-busy" : "text-status-idle"}>
              {pr.draft ? "Draft" : "Open"} PR #{pr.number}
            </span>
            <ExternalLink size={10} />
          </button>
        )}
        {annotationCount > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-accent-primary/15 text-accent-primary text-[10px] font-medium">
            <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-accent-primary text-text-on-accent text-[9px] font-semibold">
              {annotationCount}
            </span>
            {annotationCount === 1 ? "annotation" : "annotations"}
          </span>
        )}
      </div>
    </div>
  );
}

export { StatusBar };
export type { StatusBarProps };
```

- [ ] **Step 2: Verify status bar**

Run: `cd /Users/chloe/dev/alfredo && npm run dev`
Expected: Status bar shows branch name, diff stats, clickable PR link that opens in browser.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/StatusBar.tsx
git commit -m "feat: enrich status bar with diff stats and clickable PR link"
```

### Visual Verify:
- connect: 1420
- region: .h-7.flex.items-center.justify-between
- screenshot: /tmp/verify-status-bar.png
- assert: Status bar should show branch name on left, diff stats (+N/-N in green/red), and PR link on right (if PR exists)

---

### Task 7: GitHub Check Runs Backend

**Files:**
- Create: `src-tauri/src/commands/checks.rs`
- Modify: `src-tauri/src/github_manager.rs`
- Modify: `src-tauri/src/types.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add CheckRun type to Rust types**

In `src-tauri/src/types.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckRun {
    pub id: u64,
    pub name: String,
    pub status: String,       // "queued", "in_progress", "completed"
    pub conclusion: Option<String>, // "success", "failure", "neutral", "cancelled", "skipped", "timed_out", "action_required"
    pub html_url: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}
```

- [ ] **Step 2: Add get_check_runs to GithubManager**

In `src-tauri/src/github_manager.rs`, add. Note: octocrab 0.41 (the version in Cargo.toml) uses `client.get()` for raw API requests. The exact method signature may vary — check the octocrab source if it doesn't compile and adapt accordingly. The key is to call `GET /repos/{owner}/{repo}/commits/{ref}/check-runs`:

```rust
pub async fn get_check_runs(
    &self,
    owner: &str,
    repo: &str,
    git_ref: &str,
) -> Result<Vec<CheckRun>, AppError> {
    let url = format!("/repos/{owner}/{repo}/commits/{git_ref}/check-runs");
    let response: serde_json::Value = self
        .client
        .get(url, None::<&()>)
        .await
        .map_err(|e| AppError::Github(format!("failed to fetch check runs: {e}")))?;

    let empty_vec = vec![];
    let check_runs = response["check_runs"]
        .as_array()
        .unwrap_or(&empty_vec)
        .iter()
        .filter_map(|cr| {
            Some(CheckRun {
                id: cr["id"].as_u64()?,
                name: cr["name"].as_str()?.to_string(),
                status: cr["status"].as_str()?.to_string(),
                conclusion: cr["conclusion"].as_str().map(String::from),
                html_url: cr["html_url"].as_str().unwrap_or("").to_string(),
                started_at: cr["started_at"].as_str().map(String::from),
                completed_at: cr["completed_at"].as_str().map(String::from),
            })
        })
        .collect();

    Ok(check_runs)
}
```

**Fallback:** If `self.client.get()` doesn't work with octocrab 0.41, use reqwest directly instead:

```rust
let url = format!("https://api.github.com/repos/{owner}/{repo}/commits/{git_ref}/check-runs");
let response: serde_json::Value = reqwest::Client::new()
    .get(&url)
    .header("Authorization", format!("Bearer {}", self.token))
    .header("User-Agent", "alfredo")
    .header("Accept", "application/vnd.github+json")
    .send()
    .await
    .map_err(|e| AppError::Github(format!("failed to fetch check runs: {e}")))?
    .json()
    .await
    .map_err(|e| AppError::Github(format!("failed to parse check runs: {e}")))?;
```

This requires storing the token in `GithubManager` as a field (add `token: String` to the struct).

- [ ] **Step 3: Create checks command**

Create `src-tauri/src/commands/checks.rs`.

**Important:** `resolve_owner_repo` lives in `commands/github.rs` and is currently private (`async fn`, no `pub`). Before creating this file, make it public: change `async fn resolve_owner_repo` to `pub async fn resolve_owner_repo` in `commands/github.rs` (line 8).

```rust
use crate::config_manager;
use crate::github_manager::GithubManager;
use crate::commands::github::resolve_owner_repo;
use crate::types::{AppError, CheckRun};

type Result<T> = std::result::Result<T, AppError>;

#[tauri::command]
pub async fn get_check_runs(
    repo_path: String,
    branch: String,
) -> Result<Vec<CheckRun>> {
    let config = config_manager::load_config(&repo_path).await?;

    let token = config
        .github_token
        .filter(|t| !t.is_empty())
        .ok_or_else(|| AppError::Github("no GitHub token configured".into()))?;

    let manager = GithubManager::new(&token)?;
    let (owner, repo) = resolve_owner_repo(&repo_path).await?;

    manager.get_check_runs(&owner, &repo, &branch).await
}
```

- [ ] **Step 4: Register command**

In `src-tauri/src/commands/mod.rs`, add `pub mod checks;`.

In `src-tauri/src/lib.rs`, add `commands::checks::get_check_runs` to the `invoke_handler` list.

- [ ] **Step 5: Verify Rust builds**

Run: `cd /Users/chloe/dev/alfredo/src-tauri && cargo check`
Expected: No compilation errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/checks.rs src-tauri/src/github_manager.rs src-tauri/src/types.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add get_check_runs backend command for GitHub Actions CI status"
```

---

### Task 8: Frontend Types and API for Check Runs

**Files:**
- Modify: `src/types.ts`
- Modify: `src/api.ts`
- Modify: `src/stores/workspaceStore.ts`

- [ ] **Step 1: Add CheckRun TypeScript type**

In `src/types.ts`:

```typescript
export interface CheckRun {
  id: number;
  name: string;
  status: string;       // "queued" | "in_progress" | "completed"
  conclusion: string | null; // "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out" | "action_required"
  htmlUrl: string;
  startedAt: string | null;
  completedAt: string | null;
}
```

Also extend `TabType`:

```typescript
export type TabType = "claude" | "shell" | "changes" | "pr";
```

**Cascading changes needed for the new `"pr"` tab type:**
1. In `src/stores/workspaceStore.ts`, update the `addTab` label switch (~line 201-206) to handle `"pr"`:
   ```typescript
   const label =
     type === "claude" ? (count > 0 ? `Claude ${count + 1}` : "Claude")
     : type === "shell" ? (count > 0 ? `Terminal ${count + 1}` : "Terminal")
     : type === "pr" ? "PR"
     : "Changes";
   ```
2. The `"pr"` tab should be closeable (unlike `"changes"`), so no changes needed to `removeTab` or `canClose` logic.
3. The `"changes"` tab should remain always-last. PR tabs should be inserted before Changes, same as other tabs (the existing `splice` logic at line 213-216 handles this).

- [ ] **Step 2: Add API wrapper**

In `src/api.ts`:

```typescript
export function getCheckRuns(repoPath: string, branch: string): Promise<CheckRun[]> {
  return invoke("get_check_runs", { repoPath, branch });
}
```

- [ ] **Step 3: Add checkRuns state to workspace store**

In `src/stores/workspaceStore.ts`, add to the state interface:

```typescript
checkRuns: Record<string, CheckRun[]>; // keyed by worktreeId
setCheckRuns: (worktreeId: string, runs: CheckRun[]) => void;
```

And the implementation:

```typescript
checkRuns: {},
setCheckRuns: (worktreeId, runs) =>
  set((state) => ({
    checkRuns: { ...state.checkRuns, [worktreeId]: runs },
  })),
```

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/api.ts src/stores/workspaceStore.ts
git commit -m "feat: add CheckRun types, API wrapper, and store state"
```

---

### Task 9: PR Detail Panel Component

**Files:**
- Create: `src/components/pr/PrHeader.tsx`
- Create: `src/components/pr/CheckRunItem.tsx`
- Create: `src/components/pr/PrDetailPanel.tsx`

- [ ] **Step 1: Create PrHeader component**

Create `src/components/pr/PrHeader.tsx`:

```tsx
import { ExternalLink, GitPullRequest, GitPullRequestDraft } from "lucide-react";
import { open } from "@tauri-apps/plugin-opener";
import { Badge } from "../ui";
import type { PrStatus } from "../../types";

interface PrHeaderProps {
  pr: PrStatus;
}

function PrHeader({ pr }: PrHeaderProps) {
  const Icon = pr.draft ? GitPullRequestDraft : GitPullRequest;
  const stateVariant = pr.merged ? "idle" : pr.draft ? "busy" : "waiting";
  const stateLabel = pr.merged ? "Merged" : pr.draft ? "Draft" : "Open";

  return (
    <div className="px-4 py-3 border-b border-border-default">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={16} className="text-text-tertiary flex-shrink-0" />
        <span className="text-sm font-semibold text-text-primary truncate">
          {pr.title}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={stateVariant}>{stateLabel}</Badge>
        <span className="text-xs text-text-tertiary">#{pr.number}</span>
        <button
          type="button"
          onClick={() => open(pr.url)}
          className="ml-auto flex items-center gap-1 text-xs text-text-tertiary hover:text-accent-primary transition-colors cursor-pointer"
        >
          Open on GitHub
          <ExternalLink size={11} />
        </button>
      </div>
    </div>
  );
}

export { PrHeader };
```

- [ ] **Step 2: Create CheckRunItem component**

Create `src/components/pr/CheckRunItem.tsx`:

```tsx
import { CheckCircle2, XCircle, Circle, Loader2, MinusCircle, SkipForward } from "lucide-react";
import { open } from "@tauri-apps/plugin-opener";
import type { CheckRun } from "../../types";

interface CheckRunItemProps {
  run: CheckRun;
}

function getCheckIcon(run: CheckRun) {
  if (run.status !== "completed") {
    return <Loader2 size={14} className="text-status-busy animate-spin" />;
  }
  switch (run.conclusion) {
    case "success":
      return <CheckCircle2 size={14} className="text-status-idle" />;
    case "failure":
    case "timed_out":
      return <XCircle size={14} className="text-status-error" />;
    case "cancelled":
      return <MinusCircle size={14} className="text-text-tertiary" />;
    case "skipped":
      return <SkipForward size={14} className="text-text-tertiary" />;
    default:
      return <Circle size={14} className="text-text-tertiary" />;
  }
}

function formatDuration(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt || !completedAt) return null;
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function CheckRunItem({ run }: CheckRunItemProps) {
  const duration = formatDuration(run.startedAt, run.completedAt);

  return (
    <button
      type="button"
      onClick={() => run.htmlUrl && open(run.htmlUrl)}
      className="w-full flex items-center gap-2.5 px-4 py-2 hover:bg-bg-hover transition-colors cursor-pointer"
    >
      {getCheckIcon(run)}
      <span className="text-sm text-text-primary truncate flex-1">{run.name}</span>
      {duration && (
        <span className="text-[10px] text-text-tertiary flex-shrink-0">{duration}</span>
      )}
    </button>
  );
}

export { CheckRunItem };
```

- [ ] **Step 3: Create PrDetailPanel component**

Create `src/components/pr/PrDetailPanel.tsx`:

```tsx
import { useEffect, useCallback } from "react";
import { PrHeader } from "./PrHeader";
import { CheckRunItem } from "./CheckRunItem";
import { getCheckRuns } from "../../api";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { Worktree } from "../../types";
import { RefreshCw } from "lucide-react";
import { IconButton } from "../ui";

interface PrDetailPanelProps {
  worktree: Worktree;
  repoPath: string;
}

function PrDetailPanel({ worktree, repoPath }: PrDetailPanelProps) {
  const checkRuns = useWorkspaceStore((s) => s.checkRuns[worktree.id]) ?? [];
  const setCheckRuns = useWorkspaceStore((s) => s.setCheckRuns);

  const fetchChecks = useCallback(async () => {
    try {
      const runs = await getCheckRuns(repoPath, worktree.branch);
      setCheckRuns(worktree.id, runs);
    } catch (err) {
      console.error("Failed to fetch check runs:", err);
    }
  }, [repoPath, worktree.branch, worktree.id, setCheckRuns]);

  useEffect(() => {
    if (worktree.prStatus) {
      fetchChecks();
    }
  }, [worktree.prStatus, fetchChecks]);

  if (!worktree.prStatus) {
    return (
      <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
        No pull request for this branch
      </div>
    );
  }

  const successCount = checkRuns.filter((r) => r.conclusion === "success").length;
  const failureCount = checkRuns.filter((r) => r.conclusion === "failure" || r.conclusion === "timed_out").length;
  const pendingCount = checkRuns.filter((r) => r.status !== "completed").length;

  return (
    <div className="flex flex-col h-full">
      <PrHeader pr={worktree.prStatus} />

      {/* Checks section */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-default">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">
            Checks
          </span>
          {checkRuns.length > 0 && (
            <span className="text-[10px] text-text-tertiary">
              {successCount} passed
              {failureCount > 0 && `, ${failureCount} failed`}
              {pendingCount > 0 && `, ${pendingCount} pending`}
            </span>
          )}
        </div>
        <IconButton size="sm" label="Refresh checks" onClick={fetchChecks}>
          <RefreshCw />
        </IconButton>
      </div>

      <div className="flex-1 overflow-y-auto">
        {checkRuns.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-text-tertiary text-sm">
            No checks found
          </div>
        ) : (
          checkRuns.map((run) => <CheckRunItem key={run.id} run={run} />)
        )}
      </div>
    </div>
  );
}

export { PrDetailPanel };
```

- [ ] **Step 4: Commit**

```bash
git add src/components/pr/
git commit -m "feat: add PR detail panel with check runs display"
```

---

### Task 10: Wire PR Tab into AppShell

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/stores/workspaceStore.ts`

- [ ] **Step 1: Add PR tab icon and rendering to AppShell**

In `src/components/layout/AppShell.tsx`:

Add `GitPullRequest` to the lucide imports.

Add to `TAB_ICONS`:

```tsx
const TAB_ICONS: Record<TabType, typeof Terminal> = {
  claude: Sparkles,
  shell: Terminal,
  changes: GitCompareArrows,
  pr: GitPullRequest,
};
```

Add `PrDetailPanel` import:

```tsx
import { PrDetailPanel } from "../pr/PrDetailPanel";
```

In the main area rendering, add a case for the PR tab:

```tsx
{activeTab?.type === "pr" && activeWorktreeId && worktree ? (
  <PrDetailPanel
    worktree={worktree}
    repoPath={worktree.path}
  />
) : activeTab?.type === "changes" && activeWorktreeId ? (
  // ... existing changes view
```

- [ ] **Step 2: Auto-create PR tab when worktree has a PR**

In `src/stores/workspaceStore.ts`, update the `applyPrUpdates` action to dynamically add PR tabs when a worktree gains a PR. Add this logic after the worktree mapping loop (after `return { worktrees, columnOverrides, ... }`):

```typescript
// Inside applyPrUpdates, after updating worktrees:
const newTabs = { ...state.tabs };
for (const wt of worktrees) {
  const existingTabs = newTabs[wt.id] ?? [];
  const hasPrTab = existingTabs.some((t) => t.type === "pr");

  if (wt.prStatus && !hasPrTab) {
    // Worktree gained a PR — add PR tab before Changes
    const prTab: WorkspaceTab = { id: `${wt.id}:pr`, type: "pr", label: "PR" };
    const changesIdx = existingTabs.findIndex((t) => t.type === "changes");
    const tabs = [...existingTabs];
    if (changesIdx >= 0) {
      tabs.splice(changesIdx, 0, prTab);
    } else {
      tabs.push(prTab);
    }
    newTabs[wt.id] = tabs;
  }
}

return {
  worktrees,
  columnOverrides: newOverrides,
  lastPrState: newLastPrState,
  tabs: newTabs,
};
```

Note: Don't modify `ensureDefaultTabs` — it only runs once when tabs are first initialized (exits early if tabs exist at line 180). The `applyPrUpdates` handler is the right place to dynamically add PR tabs when PRs are detected.

- [ ] **Step 3: Add PR tab to the add-tab menu**

In the TabBar's add menu, add a PR option:

```tsx
<button
  type="button"
  onClick={() => handleAddTab("pr")}
  className="w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-tertiary flex items-center gap-2 cursor-pointer"
>
  <GitPullRequest size={14} />
  PR & Checks
</button>
```

- [ ] **Step 4: Verify PR tab works end-to-end**

Run: `cd /Users/chloe/dev/alfredo && npm run dev`
Expected: Worktrees with PRs show a "PR" tab. Clicking it shows PR details and CI check runs. Clicking a check run opens it on GitHub.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/AppShell.tsx src/stores/workspaceStore.ts
git commit -m "feat: wire PR detail panel as a tab in the main workspace"
```

### Visual Verify:
- connect: 1420
- screenshot: /tmp/verify-pr-tab.png
- assert: If a worktree has a PR, a "PR" tab should be visible in the tab bar. When selected, it should show PR title, state badge, and a list of CI checks with status icons.

---

### Task 11: Main Content Area Transition

**Files:**
- Modify: `src/components/layout/AppShell.tsx`

- [ ] **Step 1: Add crossfade animation when switching tab content**

Add crossfade animation for non-terminal tabs only. **Do NOT wrap terminal tabs in AnimatePresence** — unmounting xterm.js destroys the canvas and causes flicker/state loss. Instead, use a CSS opacity transition for the terminal and AnimatePresence only for Changes and PR tabs:

```tsx
import { AnimatePresence, motion } from "framer-motion";

// In the <main> section:
<main className="flex-1 min-h-0 relative">
  {/* Terminal tabs: always rendered, toggled via visibility to preserve xterm state */}
  {(activeTab?.type === "claude" || activeTab?.type === "shell") && (
    <TerminalView tabId={activeTab.id} tabType={activeTab.type} />
  )}

  {/* Non-terminal tabs: animate with crossfade */}
  <AnimatePresence mode="wait">
    {activeTab?.type === "pr" && activeWorktreeId && worktree ? (
      <motion.div
        key="pr"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.1 }}
        className="h-full"
      >
        <PrDetailPanel worktree={worktree} repoPath={worktree.path} />
      </motion.div>
    ) : activeTab?.type === "changes" && activeWorktreeId ? (
      <motion.div
        key="changes"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.1 }}
        className="h-full"
      >
        <ChangesView worktreeId={activeWorktreeId} repoPath={worktree?.path ?? "."} />
      </motion.div>
    ) : null}
  </AnimatePresence>
</main>
```

- [ ] **Step 2: Verify content transitions**

Run: `cd /Users/chloe/dev/alfredo && npm run dev`
Expected: Switching between tabs has a subtle crossfade. Terminal sessions don't flicker or lose state.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/AppShell.tsx
git commit -m "feat: add crossfade transition for tab content switching"
```

---

### Task 12: Final Verification

Re-read the goal and verify each holds true.

### Acceptance Criteria checklist:

- [ ] **Status dots pulse** — Busy and waiting agent states have pulsing dots in both expanded and collapsed sidebar
- [ ] **Sidebar animates** — Expand/collapse is smooth, not instant
- [ ] **Status groups animate** — Expand/collapse of kanban groups is smooth, shows item count
- [ ] **Tab bar is polished** — Sliding underline indicator, animated dropdown menu
- [ ] **Agent items are richer** — Show PR title and diff stats alongside branch/status
- [ ] **Status bar is informative** — Shows branch, diff stats, clickable PR link
- [ ] **Check runs backend works** — `get_check_runs` Tauri command returns GitHub Actions data
- [ ] **PR tab works** — Shows PR header, state badge, and CI check runs list
- [ ] **Check runs are clickable** — Clicking opens the check on GitHub
- [ ] **Content transitions** — Tab switching has subtle crossfade
- [ ] **No regressions** — Existing features (terminal, drag-and-drop, annotations, notifications) still work

### Run full build:

```bash
cd /Users/chloe/dev/alfredo && npm run build
cd /Users/chloe/dev/alfredo/src-tauri && cargo check
```

If any checkbox fails, fix before marking complete.

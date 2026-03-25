# Worktree Lifecycle & Session Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add worktree deletion (context menu + force remove + branch delete), session persistence across app restarts, and an auto-archive section for merged worktrees.

**Architecture:** Three features sharing infrastructure: (1) Rust backend gains force-delete + branch delete, (2) a new `SessionPersistence` service saves/restores terminal scrollback to `.alfredo/sessions/` JSON files, (3) the sidebar gains a ContextMenu on AgentItem and a new ArchiveSection below kanban columns. The GitHub sync loop is extended to fetch merged PRs so auto-archive can compute timing.

**Tech Stack:** Tauri v2, Rust (git2, octocrab, tokio), React 19, Zustand, Radix UI (ContextMenu, Dialog), xterm.js, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-25-worktree-lifecycle-and-session-persistence-design.md`

---

### Task 1: Update Rust backend — force delete worktree + delete branch

**Files:**
- Modify: `src-tauri/src/git_manager.rs:44-70`
- Modify: `src-tauri/src/commands/worktree.rs:72-76`
- Test: `src-tauri/src/git_manager.rs` (existing test module)

- [ ] **Step 1: Write failing test for force delete + branch delete**

Add to the existing `mod tests` in `git_manager.rs`:

```rust
#[tokio::test]
async fn test_delete_worktree_force_and_branch() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();

    // Create a worktree
    let wt_path = create_worktree(repo_path, "test-branch", "main").await.unwrap();
    assert!(wt_path.exists());

    // Make it dirty so non-force would fail
    std::fs::write(wt_path.join("dirty.txt"), "dirty").unwrap();

    // Force delete should succeed and also remove the branch
    delete_worktree(repo_path, "test-branch", true).await.unwrap();

    // Worktree directory should be gone
    assert!(!wt_path.exists());

    // Branch should also be gone
    let repo = Repository::open(repo_path).unwrap();
    let branch = repo.find_branch("test-branch", git2::BranchType::Local);
    assert!(branch.is_err());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test test_delete_worktree_force_and_branch -- --nocapture`
Expected: FAIL — `delete_worktree` doesn't accept a `force` parameter

- [ ] **Step 3: Update `git_manager::delete_worktree` to accept `force` and delete branch**

In `src-tauri/src/git_manager.rs`, replace the `delete_worktree` function (lines 44-70):

```rust
/// Delete a worktree by shelling out to `git worktree remove`.
/// If `force` is true, uses `--force` to remove even with uncommitted changes.
/// Also deletes the local branch after removing the worktree.
pub async fn delete_worktree(repo_path: &str, worktree_name: &str, force: bool) -> Result<(), AppError> {
    let worktree_path = Path::new(repo_path)
        .parent()
        .unwrap_or(Path::new(repo_path))
        .join(worktree_name);

    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    let wt_path_str = worktree_path.to_str().unwrap_or_default();
    args.push(wt_path_str);

    let output = Command::new("git")
        .args(&args)
        .current_dir(repo_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to spawn git: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("git worktree remove failed: {stderr}")));
    }

    // Delete the local branch (git branch -D)
    let branch_output = Command::new("git")
        .args(["branch", "-D", worktree_name])
        .current_dir(repo_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to spawn git: {e}")))?;

    if !branch_output.status.success() {
        let stderr = String::from_utf8_lossy(&branch_output.stderr);
        // Don't fail if branch doesn't exist — it may have been deleted already
        if !stderr.contains("not found") {
            return Err(AppError::Git(format!("git branch -D failed: {stderr}")));
        }
    }

    Ok(())
}
```

- [ ] **Step 4: Update the command handler to pass `force`**

In `src-tauri/src/commands/worktree.rs`, update `delete_worktree` (lines 72-76):

```rust
/// Delete a worktree by name, optionally forcing removal.
#[tauri::command]
pub async fn delete_worktree(repo_path: String, worktree_name: String, force: bool) -> Result<()> {
    git_manager::delete_worktree(&repo_path, &worktree_name, force).await
}
```

- [ ] **Step 5: Update the frontend API wrapper**

In `src/api.ts`, update `deleteWorktree` (lines 77-82):

```typescript
export function deleteWorktree(
  repoPath: string,
  worktreeName: string,
  force: boolean = true,
): Promise<void> {
  return invoke("delete_worktree", { repoPath, worktreeName, force });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd src-tauri && cargo test test_delete_worktree_force_and_branch -- --nocapture`
Expected: PASS

- [ ] **Step 7: Run all existing tests to check for regressions**

Run: `cd src-tauri && cargo test`
Expected: All pass. Note: existing `git_manager` calls to `delete_worktree` in other parts of the code don't pass `force` — check if there are any and update them.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/git_manager.rs src-tauri/src/commands/worktree.rs src/api.ts
git commit -m "feat: force-delete worktree and local branch on removal"
```

---

### Task 2: Add `merged_at` to PrStatus and fetch merged PRs in sync loop

**Files:**
- Modify: `src-tauri/src/types.rs:97-109` (PrStatus struct)
- Modify: `src-tauri/src/github_manager.rs:20-53` (sync_prs method)
- Modify: `src-tauri/src/github_sync.rs:19-30` (PrStatusWithColumn struct)
- Modify: `src/types.ts:57-65` (PrStatus interface)

- [ ] **Step 1: Add `merged_at` field to Rust `PrStatus`**

In `src-tauri/src/types.rs`, add to the `PrStatus` struct (after line 108):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrStatus {
    pub number: u64,
    pub state: String,
    pub title: String,
    pub url: String,
    pub draft: bool,
    pub merged: bool,
    #[serde(default)]
    pub branch: String,
    /// ISO 8601 timestamp of when the PR was merged, if applicable.
    #[serde(default)]
    pub merged_at: Option<String>,
}
```

- [ ] **Step 2: Update `sync_prs` to fetch `State::All` and populate `merged_at`**

In `src-tauri/src/github_manager.rs`, replace the `sync_prs` method (lines 21-53):

```rust
/// Fetch open and recently-merged PRs for the given owner/repo.
pub async fn sync_prs(&self, owner: &str, repo: &str) -> Result<Vec<PrStatus>, AppError> {
    // Fetch open PRs
    let open_page = self
        .client
        .pulls(owner, repo)
        .list()
        .state(octocrab::params::State::Open)
        .per_page(100)
        .send()
        .await
        .map_err(|e| AppError::Github(format!("failed to fetch open PRs: {e}")))?;

    // Fetch recently closed PRs (includes merged)
    let closed_page = self
        .client
        .pulls(owner, repo)
        .list()
        .state(octocrab::params::State::Closed)
        .sort(octocrab::params::pulls::Sort::Updated)
        .direction(octocrab::params::Direction::Descending)
        .per_page(30)
        .send()
        .await
        .map_err(|e| AppError::Github(format!("failed to fetch closed PRs: {e}")))?;

    let mut prs: Vec<PrStatus> = open_page
        .items
        .into_iter()
        .map(|pr| PrStatus {
            number: pr.number,
            state: pr
                .state
                .map(|s| format!("{s:?}").to_lowercase())
                .unwrap_or_else(|| "open".to_string()),
            title: pr.title.unwrap_or_default(),
            url: pr
                .html_url
                .map(|u| u.to_string())
                .unwrap_or_default(),
            draft: pr.draft.unwrap_or(false),
            merged: false,
            branch: pr.head.ref_field,
            merged_at: None,
        })
        .collect();

    // Add merged PRs (filter out closed-but-not-merged)
    for pr in closed_page.items {
        if pr.merged_at.is_some() {
            prs.push(PrStatus {
                number: pr.number,
                state: "closed".to_string(),
                title: pr.title.unwrap_or_default(),
                url: pr
                    .html_url
                    .map(|u| u.to_string())
                    .unwrap_or_default(),
                draft: pr.draft.unwrap_or(false),
                merged: true,
                branch: pr.head.ref_field,
                merged_at: pr.merged_at.map(|dt| dt.to_rfc3339()),
            });
        }
    }

    Ok(prs)
}
```

- [ ] **Step 3: Add `merged_at` to `PrStatusWithColumn` in `github_sync.rs`**

In `src-tauri/src/github_sync.rs`, update the struct (lines 19-30) and the `From` impl (lines 32-49):

```rust
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrStatusWithColumn {
    pub number: u64,
    pub state: String,
    pub title: String,
    pub url: String,
    pub draft: bool,
    pub merged: bool,
    pub branch: String,
    pub auto_column: String,
    pub merged_at: Option<String>,
}

impl From<&PrStatus> for PrStatusWithColumn {
    fn from(pr: &PrStatus) -> Self {
        let column = determine_column(Some(pr));
        Self {
            number: pr.number,
            state: pr.state.clone(),
            title: pr.title.clone(),
            url: pr.url.clone(),
            draft: pr.draft,
            merged: pr.merged,
            branch: pr.branch.clone(),
            auto_column: serde_json::to_value(&column)
                .ok()
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_else(|| "inProgress".to_string()),
            merged_at: pr.merged_at.clone(),
        }
    }
}
```

- [ ] **Step 4: Update frontend TypeScript types**

In `src/types.ts`, add `mergedAt` to `PrStatus` (after line 64):

```typescript
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
```

And add `mergedAt` to `PrStatusWithColumn` (after line 81):

```typescript
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
```

- [ ] **Step 5: Update existing test expectations**

The `github_manager` tests construct `PrStatus` without `merged_at`. Add `merged_at: None` to each test's `PrStatus` construction in `src-tauri/src/github_manager.rs` (lines 168-206) and `src-tauri/src/github_sync.rs` (lines 172-214).

- [ ] **Step 6: Run all Rust tests**

Run: `cd src-tauri && cargo test`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/types.rs src-tauri/src/github_manager.rs src-tauri/src/github_sync.rs src/types.ts
git commit -m "feat: fetch merged PRs in sync loop and expose mergedAt timestamp"
```

---

### Task 3: Add `archived` field and store cleanup to workspace store

**Files:**
- Modify: `src/types.ts:29-40` (Worktree interface)
- Modify: `src/stores/workspaceStore.ts:12-51,78-83,126-198`

- [ ] **Step 1: Add `archived` to the Worktree type**

In `src/types.ts`, add `archived` to the `Worktree` interface:

```typescript
export interface Worktree {
  id: string;
  name: string;
  path: string;
  branch: string;
  prStatus: PrStatus | null;
  agentStatus: AgentState;
  column: KanbanColumn;
  isBranchMode: boolean;
  additions: number | null;
  deletions: number | null;
  archived?: boolean;
}
```

- [ ] **Step 2: Add `archiveAfterDays` to `AppConfig`**

In `src/types.ts`, add to `AppConfig` (after line 109):

```typescript
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
}
```

- [ ] **Step 3: Add `archive_after_days` to Rust `AppConfig`**

In `src-tauri/src/types.rs`, add to `AppConfig` (after line 166):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub repo_path: String,
    pub setup_scripts: Vec<SetupScript>,
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
    #[serde(default = "default_archive_days")]
    pub archive_after_days: Option<u32>,
}
```

Add the default function:

```rust
fn default_archive_days() -> Option<u32> { Some(2) }
```

- [ ] **Step 4: Extend `removeWorktree` to clean up all related state**

In `src/stores/workspaceStore.ts`, replace `removeWorktree` (lines 78-83):

```typescript
removeWorktree: (id) =>
  set((state) => {
    const { [id]: _tabs, ...restTabs } = state.tabs;
    const { [id]: _activeTab, ...restActiveTabId } = state.activeTabId;
    const { [id]: _annotations, ...restAnnotations } = state.annotations;
    const { [id]: _checkRuns, ...restCheckRuns } = state.checkRuns;
    const { [id]: _override, ...restOverrides } = state.columnOverrides;
    const { [id]: _prState, ...restPrState } = state.lastPrState;
    const newSeen = new Set(state.seenWorktrees);
    newSeen.delete(id);
    return {
      worktrees: state.worktrees.filter((wt) => wt.id !== id),
      activeWorktreeId: state.activeWorktreeId === id ? null : state.activeWorktreeId,
      tabs: restTabs,
      activeTabId: restActiveTabId,
      annotations: restAnnotations,
      checkRuns: restCheckRuns,
      columnOverrides: restOverrides,
      lastPrState: restPrState,
      seenWorktrees: newSeen,
    };
  }),
```

- [ ] **Step 5: Add `archiveWorktree` action**

In `src/stores/workspaceStore.ts`, add to the interface (after line 46):

```typescript
archiveWorktree: (id: string) => void;
```

And implement in the store:

```typescript
archiveWorktree: (id) =>
  set((state) => ({
    worktrees: state.worktrees.map((wt) =>
      wt.id === id ? { ...wt, archived: true } : wt,
    ),
  })),
```

- [ ] **Step 6: Update `applyPrUpdates` to pass `mergedAt` through to `prStatus`**

In `src/stores/workspaceStore.ts`, inside `applyPrUpdates` (around line 156), update the `prStatus` construction to include `mergedAt`:

```typescript
const prStatus = {
  number: pr.number,
  state: pr.state,
  title: pr.title,
  url: pr.url,
  draft: pr.draft,
  merged: pr.merged,
  branch: pr.branch,
  mergedAt: pr.mergedAt,
};
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/stores/workspaceStore.ts src-tauri/src/types.rs
git commit -m "feat: add archived field to worktree, full store cleanup on delete"
```

---

### Task 4: Create ContextMenu UI component

**Files:**
- Create: `src/components/ui/ContextMenu.tsx`

- [ ] **Step 1: Install `@radix-ui/react-context-menu`**

Run: `npm install @radix-ui/react-context-menu`

- [ ] **Step 2: Create ContextMenu component**

Create `src/components/ui/ContextMenu.tsx` following the existing DropdownMenu pattern (`src/components/ui/DropdownMenu.tsx`):

```tsx
import * as RadixContextMenu from "@radix-ui/react-context-menu";
import { forwardRef } from "react";

const ContextMenu = RadixContextMenu.Root;
const ContextMenuTrigger = RadixContextMenu.Trigger;

const ContextMenuContent = forwardRef<
  HTMLDivElement,
  RadixContextMenu.ContextMenuContentProps
>(({ className = "", children, ...props }, ref) => (
  <RadixContextMenu.Portal>
    <RadixContextMenu.Content
      ref={ref}
      className={[
        "z-50 min-w-[160px] p-1",
        "bg-bg-elevated border border-border-default",
        "rounded-[var(--radius-lg)] shadow-lg",
        "animate-in fade-in-0 zoom-in-95",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </RadixContextMenu.Content>
  </RadixContextMenu.Portal>
));

ContextMenuContent.displayName = "ContextMenuContent";

const ContextMenuItem = forwardRef<
  HTMLDivElement,
  RadixContextMenu.ContextMenuItemProps
>(({ className = "", ...props }, ref) => (
  <RadixContextMenu.Item
    ref={ref}
    className={[
      "flex items-center gap-2 px-2 py-1.5",
      "text-sm text-text-primary",
      "rounded-[var(--radius-sm)] cursor-pointer",
      "outline-none",
      "data-[highlighted]:bg-bg-hover data-[highlighted]:text-text-primary",
      "transition-colors duration-[var(--transition-fast)]",
      className,
    ].join(" ")}
    {...props}
  />
));

ContextMenuItem.displayName = "ContextMenuItem";

function ContextMenuSeparator({ className = "" }: { className?: string }) {
  return (
    <RadixContextMenu.Separator
      className={["h-px my-1 bg-border-default", className].join(" ")}
    />
  );
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
};
```

- [ ] **Step 3: Export from ui barrel**

Check `src/components/ui/index.ts` and add the ContextMenu exports.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/ContextMenu.tsx src/components/ui/index.ts package.json package-lock.json
git commit -m "feat: add ContextMenu UI component (Radix)"
```

---

### Task 5: Add context menu to AgentItem with delete confirmation

**Files:**
- Modify: `src/components/sidebar/AgentItem.tsx`

- [ ] **Step 1: Wrap AgentItem in ContextMenu with delete option + archive for Done**

Replace `src/components/sidebar/AgentItem.tsx`:

```tsx
import { useDraggable } from "@dnd-kit/core";
import { useState } from "react";
import { Archive, Trash2 } from "lucide-react";
import type { AgentState, Worktree } from "../../types";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ui/ContextMenu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/Dialog";
import { Button } from "../ui";

interface AgentItemProps {
  worktree: Worktree;
  isSelected: boolean;
  onClick: () => void;
  onDelete?: (worktreeId: string) => void;
  onArchive?: (worktreeId: string) => void;
}

const statusDotColor: Record<string, string> = {
  waitingForInput: "bg-status-waiting",
  busy: "bg-status-busy",
  idle: "bg-status-idle",
  error: "bg-status-error",
  notRunning: "bg-text-tertiary",
};

const statusText: Record<string, string> = {
  waitingForInput: "Waiting for input",
  busy: "Thinking...",
  idle: "Idle",
  error: "Error",
  notRunning: "Not running",
};

function getDotColor(status: AgentState | string): string {
  return statusDotColor[status] ?? "bg-text-tertiary";
}

function getStatusText(status: AgentState | string): string {
  return statusText[status] ?? "Not running";
}

function AgentItem({ worktree, isSelected, onClick, onDelete, onArchive }: AgentItemProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const isWaiting = worktree.agentStatus === "waitingForInput";
  const shouldPulse = worktree.agentStatus === "busy" || worktree.agentStatus === "waitingForInput";
  const isDone = worktree.column === "done";
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: worktree.id,
  });

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            ref={setNodeRef}
            type="button"
            onClick={onClick}
            {...attributes}
            {...listeners}
            className={[
              "w-full text-left px-3 py-3 flex items-start gap-2",
              "mx-2 rounded-lg mb-1",
              "transition-colors duration-[var(--transition-fast)]",
              isDragging ? "opacity-50 cursor-grabbing" : "cursor-grab",
              isSelected
                ? "border-l-2 border-l-accent-primary bg-[rgba(147,51,234,0.08)]"
                : "border-l-2 border-l-transparent bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.06)]",
              isWaiting && !isSelected ? "bg-[color-mix(in_srgb,var(--status-waiting)_8%,transparent)]" : "",
            ].join(" ")}
          >
            {/* Status dot */}
            <span
              className={[
                "mt-1 h-[7px] w-[7px] rounded-full flex-shrink-0",
                getDotColor(worktree.agentStatus),
                shouldPulse ? "animate-pulse-dot" : "",
              ].join(" ")}
            />
            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-body font-medium text-text-primary truncate">
                  {worktree.branch}
                </span>
                {worktree.prStatus && (
                  <span className="text-micro text-text-tertiary flex-shrink-0">
                    #{worktree.prStatus.number}
                  </span>
                )}
              </div>
              {worktree.prStatus && (
                <div className="text-caption text-text-tertiary truncate mt-1">
                  {worktree.prStatus.title}
                </div>
              )}
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-text-tertiary truncate">
                  {getStatusText(worktree.agentStatus)}
                </span>
                {(worktree.additions != null || worktree.deletions != null) && (
                  <span className="flex items-center gap-1 text-micro ml-auto flex-shrink-0">
                    {worktree.additions != null && worktree.additions > 0 && (
                      <span className="text-text-tertiary">+{worktree.additions}</span>
                    )}
                    {worktree.deletions != null && worktree.deletions > 0 && (
                      <span className="text-text-tertiary">-{worktree.deletions}</span>
                    )}
                  </span>
                )}
              </div>
            </div>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {isDone && onArchive && (
            <>
              <ContextMenuItem onSelect={() => onArchive(worktree.id)}>
                <Archive className="h-4 w-4" />
                Archive
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem
            className="text-red-400 data-[highlighted]:text-red-300"
            onSelect={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            Delete worktree...
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete worktree</DialogTitle>
            <DialogDescription>
              Delete worktree and local branch <code className="text-text-secondary font-mono text-caption">{worktree.branch}</code>? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setDeleteDialogOpen(false);
                onDelete?.(worktree.id);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export { AgentItem };
export type { AgentItemProps };
```

- [ ] **Step 2: Wire up `onDelete` and `onArchive` callbacks in StatusGroup**

In `src/components/sidebar/StatusGroup.tsx`, pass the new props through to AgentItem (around line 101-107):

```tsx
{worktrees.map((wt) => (
  <AgentItem
    key={wt.id}
    worktree={wt}
    isSelected={wt.id === activeWorktreeId}
    onClick={() => onSelectWorktree(wt.id)}
    onDelete={onDeleteWorktree}
    onArchive={onArchiveWorktree}
  />
))}
```

Add the props to `StatusGroupProps`:

```typescript
interface StatusGroupProps {
  column: KanbanColumn;
  worktrees: Worktree[];
  activeWorktreeId: string | null;
  onSelectWorktree: (id: string) => void;
  onDeleteWorktree?: (id: string) => void;
  onArchiveWorktree?: (id: string) => void;
  forceVisible?: boolean;
}
```

- [ ] **Step 3: Wire up the delete/archive handlers in Sidebar**

In `src/components/sidebar/Sidebar.tsx`, create the delete handler and pass it to StatusGroup. The handler should:
1. Remove from store first
2. Close PTY session
3. Call `deleteWorktree` API
4. Delete session file (Task 7 will add this)

```typescript
import { deleteWorktree } from "../../api";
import { sessionManager } from "../../services/sessionManager";
import { useRepoPath } from "../../hooks/useRepoPath";

// Inside Sidebar component:
const { repoPath } = useRepoPath();
const removeWorktree = useWorkspaceStore((s) => s.removeWorktree);
const archiveWorktree = useWorkspaceStore((s) => s.archiveWorktree);

async function handleDeleteWorktree(id: string) {
  const wt = worktrees.find((w) => w.id === id);
  if (!wt || !repoPath) return;

  // 1. Remove from store first (prevents sync loop race)
  removeWorktree(id);

  // 2. Close any PTY sessions for this worktree's tabs
  const worktreeTabs = allTabs[id] ?? [];
  for (const tab of worktreeTabs) {
    await sessionManager.closeSession(tab.id);
  }

  // 3. Force-delete worktree + branch
  try {
    await deleteWorktree(repoPath, wt.name, true);
  } catch (e) {
    console.error("Failed to delete worktree:", e);
  }
}
```

You'll need to also pull `allTabs` from the store:
```typescript
const allTabs = useWorkspaceStore((s) => s.tabs);
```

Then pass to each `StatusGroup`:
```tsx
<StatusGroup
  key={col}
  column={col}
  worktrees={grouped[col]}
  activeWorktreeId={activeWorktreeId}
  onSelectWorktree={setActiveWorktree}
  onDeleteWorktree={handleDeleteWorktree}
  onArchiveWorktree={archiveWorktree}
  forceVisible={isDragging}
/>
```

- [ ] **Step 4: Verify the app compiles**

Run: `npm run build`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/AgentItem.tsx src/components/sidebar/StatusGroup.tsx src/components/sidebar/Sidebar.tsx
git commit -m "feat: add right-click context menu with delete confirmation to worktree items"
```

---

### Task 6: Create Rust session file commands + SessionPersistence service

**Files:**
- Create: `src-tauri/src/commands/session.rs`
- Modify: `src-tauri/src/lib.rs` (register new commands)
- Create: `src/services/SessionPersistence.ts`
- Modify: `src/services/sessionManager.ts:174-192`
- Modify: `src/api.ts` (add session file API wrappers)

**Note:** We use custom Rust `invoke` commands for file I/O instead of `@tauri-apps/plugin-fs` — this is consistent with the rest of the codebase and avoids adding a new plugin dependency.

- [ ] **Step 1: Create Rust session file commands**

Create `src-tauri/src/commands/session.rs`:

```rust
use crate::types::AppError;
use std::path::Path;

type Result<T> = std::result::Result<T, AppError>;

/// Ensure the .alfredo/sessions/ directory exists under the repo path.
async fn ensure_sessions_dir(repo_path: &str) -> Result<()> {
    let dir = Path::new(repo_path).join(".alfredo/sessions");
    tokio::fs::create_dir_all(&dir).await?;
    Ok(())
}

/// Save session data (JSON string) for a worktree.
#[tauri::command]
pub async fn save_session_file(repo_path: String, worktree_id: String, data: String) -> Result<()> {
    ensure_sessions_dir(&repo_path).await?;
    let path = Path::new(&repo_path).join(format!(".alfredo/sessions/{worktree_id}.json"));
    tokio::fs::write(&path, data).await?;
    Ok(())
}

/// Load session data for a worktree. Returns null if no file exists.
#[tauri::command]
pub async fn load_session_file(repo_path: String, worktree_id: String) -> Result<Option<String>> {
    let path = Path::new(&repo_path).join(format!(".alfredo/sessions/{worktree_id}.json"));
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Delete session file for a worktree.
#[tauri::command]
pub async fn delete_session_file(repo_path: String, worktree_id: String) -> Result<()> {
    let path = Path::new(&repo_path).join(format!(".alfredo/sessions/{worktree_id}.json"));
    match tokio::fs::remove_file(&path).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// Ensure .alfredo/ is in the repo's .gitignore.
#[tauri::command]
pub async fn ensure_alfredo_gitignore(repo_path: String) -> Result<()> {
    let gitignore_path = Path::new(&repo_path).join(".gitignore");
    let content = tokio::fs::read_to_string(&gitignore_path).await.unwrap_or_default();
    if !content.lines().any(|line| line.trim() == ".alfredo/" || line.trim() == ".alfredo") {
        let entry = if content.ends_with('\n') || content.is_empty() {
            ".alfredo/\n"
        } else {
            "\n.alfredo/\n"
        };
        tokio::fs::write(&gitignore_path, format!("{content}{entry}")).await?;
    }
    Ok(())
}
```

- [ ] **Step 2: Register commands and add session module**

In `src-tauri/src/lib.rs`, add `session` to the `use commands::` line and register the new commands in `invoke_handler`:

```rust
use commands::{branch, checks, config, diff, github, linear, pty, repo, session, worktree};
```

Add to the `invoke_handler` array:
```rust
// Session persistence
session::save_session_file,
session::load_session_file,
session::delete_session_file,
session::ensure_alfredo_gitignore,
```

In `src-tauri/src/commands/mod.rs` (or wherever commands are declared), add `pub mod session;`.

- [ ] **Step 3: Add frontend API wrappers**

In `src/api.ts`, add:

```typescript
// ── Session Persistence ──────────────────────────────────────────

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
```

- [ ] **Step 4: Add `getBufferedOutputBase64` and `getSessionKeys` to sessionManager**

In `src/services/sessionManager.ts`, add these methods to the `SessionManager` class:

```typescript
/** Get all active session keys. */
getSessionKeys(): string[] {
  return [...this.sessions.keys()];
}

/** Get buffered output for a session as a base64 string for persistence. */
getBufferedOutputBase64(sessionKey: string): string {
  const bytes = this.getBufferedOutput(sessionKey);
  return btoa(String.fromCharCode(...bytes));
}
```

- [ ] **Step 5: Create SessionPersistence service**

Create `src/services/SessionPersistence.ts`:

```typescript
import { saveSessionFile, loadSessionFile, deleteSessionFile } from "../api";
import type { WorkspaceTab } from "../types";

export interface SessionData {
  tabs: WorkspaceTab[];
  activeTabId: string;
  terminals: Record<string, { scrollback: string }>; // base64-encoded
  savedAt: string;
}

/** Save session data for a worktree. */
export async function saveSession(
  repoPath: string,
  worktreeId: string,
  data: SessionData,
): Promise<void> {
  await saveSessionFile(repoPath, worktreeId, JSON.stringify(data, null, 2));
}

/** Load session data for a worktree. Returns null if no saved session exists. */
export async function loadSession(
  repoPath: string,
  worktreeId: string,
): Promise<SessionData | null> {
  const content = await loadSessionFile(repoPath, worktreeId);
  if (!content) return null;
  try {
    return JSON.parse(content) as SessionData;
  } catch {
    return null;
  }
}

/** Delete session data for a worktree. */
export async function deleteSession(
  repoPath: string,
  worktreeId: string,
): Promise<void> {
  await deleteSessionFile(repoPath, worktreeId);
}

/** Save all sessions from the workspace store and session manager. */
export async function saveAllSessions(
  repoPath: string,
  worktreeIds: string[],
  getTabs: (worktreeId: string) => WorkspaceTab[],
  getActiveTabId: (worktreeId: string) => string,
  getScrollback: (tabId: string) => string, // base64
): Promise<void> {
  const saves = worktreeIds.map((wtId) => {
    const tabs = getTabs(wtId);
    const terminals: Record<string, { scrollback: string }> = {};
    for (const tab of tabs) {
      if (tab.type === "claude" || tab.type === "shell") {
        const scrollback = getScrollback(tab.id);
        if (scrollback) {
          terminals[tab.id] = { scrollback };
        }
      }
    }
    const data: SessionData = {
      tabs,
      activeTabId: getActiveTabId(wtId),
      terminals,
      savedAt: new Date().toISOString(),
    };
    return saveSession(repoPath, wtId, data);
  });
  await Promise.allSettled(saves);
}
```

- [ ] **Step 6: Verify everything compiles**

Run: `cd src-tauri && cargo check` then `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/session.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src/services/SessionPersistence.ts src/services/sessionManager.ts src/api.ts
git commit -m "feat: add session persistence service with Rust file I/O commands"
```

---

### Task 7: Wire up session save on quit + debounced auto-save

**Files:**
- Modify: `src/components/layout/AppShell.tsx`

- [ ] **Step 1: Add save-on-close handler to AppShell**

In `src/components/layout/AppShell.tsx`, add an effect that:
1. Listens for window close via `@tauri-apps/api/window`
2. Saves all sessions before allowing close

Add after the existing `useEffect` blocks (around line 259):

```typescript
import { getCurrentWindow } from "@tauri-apps/api/window";
import { saveAllSessions } from "../../services/SessionPersistence";
import { sessionManager } from "../../services/sessionManager";

// Save sessions on app quit
useEffect(() => {
  if (!repoPath) return;

  const currentWindow = getCurrentWindow();
  const unlisten = currentWindow.onCloseRequested(async (event) => {
    event.preventDefault();
    const state = useWorkspaceStore.getState();
    const worktreeIds = state.worktrees.map((wt) => wt.id);

    await saveAllSessions(
      repoPath,
      worktreeIds,
      (wtId) => state.tabs[wtId] ?? [],
      (wtId) => state.activeTabId[wtId] ?? "",
      (tabId) => sessionManager.getBufferedOutputBase64(tabId),
    );

    await currentWindow.destroy();
  });

  return () => {
    unlisten.then((fn) => fn());
  };
}, [repoPath]);
```

- [ ] **Step 2: Add debounced auto-save (every 30 seconds)**

Add another effect in AppShell:

```typescript
import { deleteSession } from "../../services/SessionPersistence";

// Debounced auto-save every 30s
useEffect(() => {
  if (!repoPath) return;

  const interval = setInterval(() => {
    const state = useWorkspaceStore.getState();
    const worktreeIds = state.worktrees.map((wt) => wt.id);

    saveAllSessions(
      repoPath,
      worktreeIds,
      (wtId) => state.tabs[wtId] ?? [],
      (wtId) => state.activeTabId[wtId] ?? "",
      (tabId) => sessionManager.getBufferedOutputBase64(tabId),
    ).catch((err) => console.error("Auto-save failed:", err));
  }, 30_000);

  return () => clearInterval(interval);
}, [repoPath]);
```

- [ ] **Step 3: Add session file cleanup to the delete handler**

In `Sidebar.tsx`, update `handleDeleteWorktree` to also delete the session file:

```typescript
import { deleteSession } from "../../services/SessionPersistence";

// Add at the end of handleDeleteWorktree:
try {
  await deleteSession(repoPath, id);
} catch {
  // Non-critical — session file may not exist
}
```

- [ ] **Step 4: Ensure `.alfredo/` is in the user's repo `.gitignore` on startup**

In `AppShell.tsx`, call `ensureAlfredoGitignore` once when the repo path is set. Add to the existing worktree-loading effect:

```typescript
import { ensureAlfredoGitignore } from "../../api";

// Inside the useEffect that loads worktrees:
ensureAlfredoGitignore(repoPath).catch(() => {});
```

This writes to the **user's repo** `.gitignore`, not Alfredo's source repo.

- [ ] **Step 5: Verify the app compiles**

Run: `npm run build`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/AppShell.tsx src/components/sidebar/Sidebar.tsx
git commit -m "feat: save terminal sessions on quit and auto-save every 30s"
```

---

### Task 8: Restore sessions on startup

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/stores/workspaceStore.ts`

- [ ] **Step 1: Add `restoreTabs` action to workspace store**

In `src/stores/workspaceStore.ts`, add to the interface:

```typescript
restoreTabs: (worktreeId: string, tabs: WorkspaceTab[], activeTabId: string) => void;
```

Implement:

```typescript
restoreTabs: (worktreeId, tabs, activeTabId) =>
  set((state) => ({
    tabs: { ...state.tabs, [worktreeId]: tabs },
    activeTabId: { ...state.activeTabId, [worktreeId]: activeTabId },
  })),
```

- [ ] **Step 2: Restore sessions after loading worktrees**

In `src/components/layout/AppShell.tsx`, modify the worktree loading effect (lines 178-187) to also restore sessions:

```typescript
import { loadSession } from "../../services/SessionPersistence";

const restoreTabs = useWorkspaceStore((s) => s.restoreTabs);

// Load worktrees from git when repo path is available
useEffect(() => {
  if (!repoPath) return;
  listWorktrees(repoPath).then(async (wts) => {
    if (wts.length > 0) {
      setWorktrees(wts);

      // Restore saved sessions for each worktree
      for (const wt of wts) {
        const session = await loadSession(repoPath, wt.id);
        if (session) {
          restoreTabs(wt.id, session.tabs, session.activeTabId);
        }
      }
    }
  }).catch(() => {
    // Silently ignore
  });
}, [repoPath, setWorktrees, restoreTabs]);
```

- [ ] **Step 3: Replay saved scrollback when terminal tab is opened**

**Key insight:** The scrollback must be written to the xterm Terminal *before* the PTY is spawned, to avoid interleaving saved output with live output. The current flow in `sessionManager.getOrSpawn()` (at `src/services/sessionManager.ts:47-129`) creates the Terminal, wires the channel, *then* calls `spawnPty`. We need to inject scrollback between Terminal creation and PTY spawn.

Modify `sessionManager.getOrSpawn()` to accept an optional `initialScrollback` parameter:

```typescript
async getOrSpawn(
  sessionKey: string,
  worktreeId: string,
  worktreePath: string,
  mode: "claude" | "shell" = "claude",
  initialScrollback?: string, // base64-encoded saved output
): Promise<ManagedSession> {
  const existing = this.sessions.get(sessionKey);
  if (existing) return existing;

  const terminal = new Terminal({
    allowProposedApi: true,
    scrollback: 10_000,
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  // Replay saved scrollback BEFORE spawning the PTY
  if (initialScrollback) {
    const bytes = Uint8Array.from(atob(initialScrollback), (c) => c.charCodeAt(0));
    terminal.write(bytes);
  }

  // ... rest of the method unchanged (channel setup, spawnPty, etc.)
```

Then update `usePty.ts` (at `src/hooks/usePty.ts:52-54`) to pass saved scrollback:

```typescript
// In usePty's attach() function, before getOrSpawn:
interface UsePtyOptions {
  sessionKey: string;
  worktreeId: string;
  worktreePath: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  mode?: "claude" | "shell";
  initialScrollback?: string; // base64 from saved session
}

// In attach():
const session = await sessionManager.getOrSpawn(
  sessionKey, worktreeId, worktreePath, mode, initialScrollback
);
```

And in `TerminalView.tsx`, look up the saved scrollback and pass it:

```typescript
// In TerminalView, before calling usePty:
const [savedScrollback, setSavedScrollback] = useState<string | undefined>();
const { repoPath } = useRepoPath();

useEffect(() => {
  if (!repoPath || !activeWorktreeId || !tabId) return;
  loadSession(repoPath, activeWorktreeId).then((session) => {
    const scrollback = session?.terminals[tabId]?.scrollback;
    if (scrollback) setSavedScrollback(scrollback);
  });
}, [repoPath, activeWorktreeId, tabId]);

const { agentState } = usePty({
  sessionKey,
  worktreeId: activeWorktreeId ?? "",
  worktreePath: worktree?.path ?? "",
  containerRef,
  mode,
  initialScrollback: savedScrollback,
});
```

This ensures scrollback is replayed once into xterm before the PTY starts streaming, avoiding any race condition.

- [ ] **Step 4: Verify the app compiles**

Run: `npm run build`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/AppShell.tsx src/stores/workspaceStore.ts src/components/terminal/
git commit -m "feat: restore saved sessions and terminal scrollback on app startup"
```

---

### Task 9: Create ArchiveSection component

**Files:**
- Create: `src/components/sidebar/ArchiveSection.tsx`

- [ ] **Step 1: Create the ArchiveSection component**

Create `src/components/sidebar/ArchiveSection.tsx`:

```tsx
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Archive, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "../ui";
import type { Worktree } from "../../types";

interface ArchiveSectionProps {
  worktrees: Worktree[];
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
  deletingCount?: { current: number; total: number } | null;
}

function ArchiveSection({ worktrees, onDelete, onDeleteAll, deletingCount }: ArchiveSectionProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);

  if (worktrees.length === 0) return null;

  return (
    <div className="mt-4 border-t border-border-subtle pt-2">
      {/* Header */}
      <button
        onClick={() => setIsCollapsed((prev) => !prev)}
        className="flex w-full items-center gap-2 px-4 pt-3 pb-2 cursor-pointer select-none text-text-tertiary opacity-60"
      >
        <Archive className="h-3.5 w-3.5" />
        <span className="text-caption font-semibold uppercase tracking-wider">
          Archive
        </span>
        <span className="ml-auto text-micro text-text-tertiary tabular-nums">
          {worktrees.length}
        </span>
        <ChevronRight
          className={[
            "h-3.5 w-3.5 transition-transform duration-150",
            isCollapsed ? "rotate-0" : "rotate-90",
          ].join(" ")}
        />
      </button>

      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            {/* Delete all button */}
            <div className="px-4 pb-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-red-400 hover:text-red-300 text-caption w-full"
                onClick={onDeleteAll}
                disabled={!!deletingCount}
              >
                {deletingCount
                  ? `Deleting ${deletingCount.current}/${deletingCount.total}...`
                  : "Delete all"}
              </Button>
            </div>

            {/* Archived items — simplified rendering */}
            {worktrees.map((wt) => (
              <div
                key={wt.id}
                className="group w-full text-left px-3 py-2 mx-2 rounded-lg mb-1 flex items-center gap-2 bg-[rgba(255,255,255,0.02)]"
              >
                <span className="text-body text-text-tertiary truncate flex-1">
                  {wt.branch}
                </span>
                <button
                  type="button"
                  onClick={() => onDelete(wt.id)}
                  className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-red-400 transition-opacity p-1 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export { ArchiveSection };
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/ArchiveSection.tsx
git commit -m "feat: add ArchiveSection sidebar component for merged worktrees"
```

---

### Task 10: Integrate ArchiveSection into Sidebar with auto-archive logic

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx`

- [ ] **Step 1: Add `archiveAfterDays` to workspace store**

In `src/stores/workspaceStore.ts`, add to the state interface and initial state:

```typescript
// In interface (after archiveWorktree):
archiveAfterDays: number;

// In initial state (after archiveWorktree implementation):
archiveAfterDays: 2,
```

**Important:** This must come before Step 2, which references `state.archiveAfterDays`.

- [ ] **Step 2: Split worktrees into active and archived in Sidebar**

In `src/components/sidebar/Sidebar.tsx`, add archive logic:

```typescript
import { ArchiveSection } from "./ArchiveSection";

// Inside Sidebar component, after existing hooks:

// Split worktrees into active and archived
const activeWorktrees = worktrees.filter((wt) => !wt.archived);
const archivedWorktrees = worktrees.filter((wt) => wt.archived);
const grouped = groupByColumn(activeWorktrees); // Only group active worktrees
```

- [ ] **Step 3: Add auto-archive check to the GitHub sync handler**

In `src/hooks/useGithubSync.ts`, add auto-archive logic after applying PR updates. Use a single batched `set()` call instead of calling `archiveWorktree` in a loop to avoid multiple re-renders:

```typescript
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { PrUpdatePayload } from "../types";
import { useWorkspaceStore } from "../stores/workspaceStore";

export function useGithubSync() {
  const applyPrUpdates = useWorkspaceStore((s) => s.applyPrUpdates);

  useEffect(() => {
    const unlisten = listen<PrUpdatePayload>("github:pr-update", (event) => {
      applyPrUpdates(event.payload.prs);

      // Auto-archive check: batch-archive Done worktrees with expired mergedAt
      const state = useWorkspaceStore.getState();
      const archiveAfterMs = state.archiveAfterDays * 24 * 60 * 60 * 1000;
      const now = Date.now();

      const toArchive = state.worktrees
        .filter((wt) =>
          wt.column === "done" &&
          !wt.archived &&
          wt.prStatus?.mergedAt &&
          now - new Date(wt.prStatus.mergedAt).getTime() >= archiveAfterMs
        )
        .map((wt) => wt.id);

      if (toArchive.length > 0) {
        // Batch update in a single set() call
        useWorkspaceStore.setState((s) => ({
          worktrees: s.worktrees.map((wt) =>
            toArchive.includes(wt.id) ? { ...wt, archived: true } : wt,
          ),
        }));
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [applyPrUpdates]);
}
```

- [ ] **Step 4: Wire up archive delete handlers in Sidebar**

In `src/components/sidebar/Sidebar.tsx`, add handlers and render ArchiveSection:

```typescript
const [deletingCount, setDeletingCount] = useState<{ current: number; total: number } | null>(null);

async function handleDeleteAllArchived() {
  if (!repoPath) return;
  const total = archivedWorktrees.length;
  for (let i = 0; i < archivedWorktrees.length; i++) {
    setDeletingCount({ current: i + 1, total });
    await handleDeleteWorktree(archivedWorktrees[i].id);
  }
  setDeletingCount(null);
}
```

Then render after the SidebarDragContext:

```tsx
<ArchiveSection
  worktrees={archivedWorktrees}
  onDelete={handleDeleteWorktree}
  onDeleteAll={handleDeleteAllArchived}
  deletingCount={deletingCount}
/>
```

- [ ] **Step 5: Verify the app compiles**

Run: `npm run build`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/components/sidebar/Sidebar.tsx src/hooks/useGithubSync.ts src/stores/workspaceStore.ts
git commit -m "feat: integrate archive section with auto-archive logic for merged worktrees"
```

---

### Task 11: Manual testing and polish

- [ ] **Step 1: Start the app**

Run: `npm run tauri dev`

- [ ] **Step 2: Test context menu on a worktree**

Right-click a worktree in the sidebar. Verify:
- Context menu appears with "Delete worktree..."
- For Done worktrees, "Archive" option also appears
- Delete confirmation dialog shows correct branch name
- Confirming delete removes the worktree from sidebar

- [ ] **Step 3: Test session persistence**

1. Open a Claude tab, type something, wait for output
2. Quit Alfredo (Cmd+Q)
3. Reopen Alfredo
4. Verify: tabs restore in the same layout, terminal shows previous scrollback

- [ ] **Step 4: Test archive section**

1. If you have a worktree with a merged PR, verify it appears in "Done"
2. Right-click → Archive → verify it moves to Archive section
3. Verify Archive section is collapsed by default
4. Expand it, verify items show branch name + trash icon on hover
5. Test one-click delete from archive
6. Test "Delete all"

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: polish worktree lifecycle and session persistence"
```

# Multi-Repo Onboarding & Sidebar Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support multiple repositories with per-repo worktree/branch mode, repo pills in the sidebar, and a redesigned onboarding flow.

**Architecture:** Backend-first approach — add app-level config (`app.json`) in Rust, then build frontend state management on top, then replace onboarding UI. The workspace store swaps entirely on repo switch (clear + reload). GitHub sync runs only for the active repo; activity dots use PTY session state.

**Tech Stack:** Rust (Tauri v2 commands, serde, tokio), React, Zustand, Tailwind CSS, Framer Motion

**Spec:** `docs/superpowers/specs/2026-03-25-multi-repo-onboarding-design.md`

**Design references:** `designs/multi-repo-sidebar.html`, `designs/multi-repo-pills-vs-rail.html`

---

## File Structure

### New files (Rust):
- `src-tauri/src/app_config_manager.rs` — CRUD for `app.json` (app-level state: repos, activeRepo, theme, notifications)
- `src-tauri/src/commands/app_config.rs` — Tauri commands: `get_app_config`, `save_app_config`, `add_app_repo`, `remove_app_repo`, `set_active_repo`, `has_active_sessions`

### New files (Frontend):
- `src/hooks/useAppConfig.ts` — Hook to load/save app-level config, manage repos list and active repo
- `src/components/sidebar/RepoPills.tsx` — Horizontal scrollable pill row with activity dots
- `src/components/onboarding/RepoWelcomeScreen.tsx` — Full-screen "Add your first repository" empty state
- `src/components/onboarding/AddRepoModal.tsx` — Modal overlay for adding subsequent repos (reuses RepoWelcomeScreen internals)
- `src/components/onboarding/RepoSetupDialog.tsx` — Per-repo config modal (GitHub, Linear, worktree path, scripts)
- `src/components/sidebar/BranchModeView.tsx` — Sidebar content for branch-mode repos
- `src/components/sidebar/RemoveRepoDialog.tsx` — Confirmation dialog for repo removal

### Modified files (Rust):
- `src-tauri/src/types.rs` — Add `GlobalAppConfig`, `RepoEntry` types
- `src-tauri/src/lib.rs` — Register new commands, add `GlobalAppConfig` managed state
- `src-tauri/src/commands/mod.rs` — Export `app_config` module

### Modified files (Frontend):
- `src/api.ts` — Add wrappers for new app config commands
- `src/types.ts` — Add `GlobalAppConfig`, `RepoEntry` TypeScript types
- `src/components/layout/AppShell.tsx` — Replace `useRepoPath` with `useAppConfig`, handle multi-repo lifecycle
- `src/components/sidebar/Sidebar.tsx` — Add RepoPills, remove collapse/expand, scope to active repo
- `src/stores/workspaceStore.ts` — Add `clearStore()` action for repo switching
- `src/components/settings/GlobalSettingsDialog.tsx` — Use `getAppConfig`/`saveAppConfig` for theme and notifications
- `src/components/settings/WorkspaceSettingsDialog.tsx` — Remove worktree base path from repo tab (moved to RepoSetupDialog)

### Removed files:
- `src/hooks/useRepoPath.ts` — Replaced by `useAppConfig`
- `src/components/onboarding/OnboardingScreen.tsx` — Replaced by RepoWelcomeScreen + RepoSetupDialog

---

## Task 1: App-Level Config — Rust Types & Manager

**Files:**
- Modify: `src-tauri/src/types.rs:153-173`
- Create: `src-tauri/src/app_config_manager.rs`

- [ ] **Step 1: Add new types to `types.rs`**

Add after the `AppConfig` struct (line 173):

```rust
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
}
```

- [ ] **Step 2: Create `app_config_manager.rs`**

```rust
use std::path::PathBuf;

use crate::types::{AppConfig, AppError, GlobalAppConfig, RepoEntry, RepoMode};

/// Resolve the path to `app.json` in the Tauri app data directory.
pub fn config_path(app_data_dir: &std::path::Path) -> PathBuf {
    app_data_dir.join("app.json")
}

/// Load the global app config from `app.json`.
/// Returns defaults if the file doesn't exist.
pub async fn load(app_data_dir: &std::path::Path) -> Result<GlobalAppConfig, AppError> {
    let path = config_path(app_data_dir);

    if !path.exists() {
        return Ok(GlobalAppConfig {
            repos: vec![],
            active_repo: None,
            theme: None,
            notifications: None,
        });
    }

    let contents = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| AppError::Config(format!("failed to read app.json: {e}")))?;

    serde_json::from_str(&contents)
        .map_err(|e| AppError::Config(format!("failed to parse app.json: {e}")))
}

/// Save the global app config to `app.json`.
pub async fn save(
    app_data_dir: &std::path::Path,
    config: &GlobalAppConfig,
) -> Result<(), AppError> {
    let path = config_path(app_data_dir);

    // Ensure directory exists
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| AppError::Config(format!("failed to create app data dir: {e}")))?;
    }

    let json = serde_json::to_string_pretty(config)
        .map_err(|e| AppError::Config(format!("failed to serialize app config: {e}")))?;

    tokio::fs::write(&path, json)
        .await
        .map_err(|e| AppError::Config(format!("failed to write app.json: {e}")))
}

/// Add a repo to the config. Returns error if duplicate.
pub fn add_repo(config: &mut GlobalAppConfig, path: String, mode: RepoMode) -> Result<(), AppError> {
    if config.repos.iter().any(|r| r.path == path) {
        return Err(AppError::Config("This repository is already in Alfredo".into()));
    }
    config.repos.push(RepoEntry { path: path.clone(), mode });
    if config.active_repo.is_none() {
        config.active_repo = Some(path);
    }
    Ok(())
}

/// Remove a repo from the config.
pub fn remove_repo(config: &mut GlobalAppConfig, path: &str) {
    config.repos.retain(|r| r.path != path);
    if config.active_repo.as_deref() == Some(path) {
        config.active_repo = config.repos.first().map(|r| r.path.clone());
    }
}

/// Migrate from legacy single-repo state.
/// Checks for tauri-plugin-store's app-settings.json and existing .alfredo.json.
pub async fn migrate_if_needed(
    app_data_dir: &std::path::Path,
    store_path: &std::path::Path,
) -> Result<Option<GlobalAppConfig>, AppError> {
    let app_json = config_path(app_data_dir);
    if app_json.exists() {
        return Ok(None); // Already migrated
    }

    // Try to read the old tauri-plugin-store file
    let store_file = store_path.join("app-settings.json");
    if !store_file.exists() {
        return Ok(None);
    }

    let contents = tokio::fs::read_to_string(&store_file)
        .await
        .map_err(|e| AppError::Config(format!("failed to read legacy store: {e}")))?;

    // The store format is a JSON object with key-value pairs
    let store: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|e| AppError::Config(format!("failed to parse legacy store: {e}")))?;

    let repo_path = store.get("repoPath")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let Some(repo_path) = repo_path else {
        return Ok(None);
    };

    // Try to load existing .alfredo.json for migration data
    let repo_config = crate::config_manager::load_config(&repo_path).await.ok();

    let mode = match repo_config.as_ref() {
        Some(c) if c.branch_mode => RepoMode::Branch,
        _ => RepoMode::Worktree,
    };

    let mut global = GlobalAppConfig {
        repos: vec![RepoEntry { path: repo_path.clone(), mode }],
        active_repo: Some(repo_path),
        theme: repo_config.as_ref().and_then(|c| c.theme.clone()),
        notifications: repo_config.as_ref().and_then(|c| c.notifications.clone()),
    };

    save(app_data_dir, &global).await?;
    Ok(Some(global))
}
```

- [ ] **Step 3: Run `cargo check` to verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles successfully (warnings about unused code are OK)

- [ ] **Step 4: Write tests for `app_config_manager`**

Add to the bottom of `app_config_manager.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_load_missing_returns_defaults() {
        let dir = tempfile::TempDir::new().unwrap();
        let config = load(dir.path()).await.unwrap();
        assert!(config.repos.is_empty());
        assert!(config.active_repo.is_none());
    }

    #[tokio::test]
    async fn test_save_and_load() {
        let dir = tempfile::TempDir::new().unwrap();
        let config = GlobalAppConfig {
            repos: vec![RepoEntry {
                path: "/tmp/test-repo".into(),
                mode: RepoMode::Worktree,
            }],
            active_repo: Some("/tmp/test-repo".into()),
            theme: Some("warm-dark".into()),
            notifications: None,
        };
        save(dir.path(), &config).await.unwrap();
        let loaded = load(dir.path()).await.unwrap();
        assert_eq!(loaded.repos.len(), 1);
        assert_eq!(loaded.active_repo, Some("/tmp/test-repo".into()));
    }

    #[tokio::test]
    async fn test_add_repo_duplicate_errors() {
        let mut config = GlobalAppConfig {
            repos: vec![RepoEntry {
                path: "/tmp/repo".into(),
                mode: RepoMode::Worktree,
            }],
            active_repo: Some("/tmp/repo".into()),
            theme: None,
            notifications: None,
        };
        let result = add_repo(&mut config, "/tmp/repo".into(), RepoMode::Branch);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_remove_repo_switches_active() {
        let mut config = GlobalAppConfig {
            repos: vec![
                RepoEntry { path: "/tmp/a".into(), mode: RepoMode::Worktree },
                RepoEntry { path: "/tmp/b".into(), mode: RepoMode::Branch },
            ],
            active_repo: Some("/tmp/a".into()),
            theme: None,
            notifications: None,
        };
        remove_repo(&mut config, "/tmp/a");
        assert_eq!(config.repos.len(), 1);
        assert_eq!(config.active_repo, Some("/tmp/b".into()));
    }
}
```

- [ ] **Step 5: Run tests**

Run: `cd src-tauri && cargo test app_config_manager`
Expected: All 4 tests pass

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/types.rs src-tauri/src/app_config_manager.rs
git commit -m "feat: add GlobalAppConfig types and app_config_manager module"
```

---

## Task 2: App Config — Tauri Commands

**Files:**
- Create: `src-tauri/src/commands/app_config.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create `commands/app_config.rs`**

```rust
use tauri::AppHandle;
use tauri::Manager;

use crate::app_config_manager;
use crate::types::{AppError, GlobalAppConfig, RepoMode};
use crate::pty_manager::PtyManager;

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::Config(format!("failed to resolve app data dir: {e}")))
}

#[tauri::command]
pub async fn get_app_config(app: AppHandle) -> Result<GlobalAppConfig, AppError> {
    let dir = app_data_dir(&app)?;
    app_config_manager::load(&dir).await
}

#[tauri::command]
pub async fn save_app_config(app: AppHandle, config: GlobalAppConfig) -> Result<(), AppError> {
    let dir = app_data_dir(&app)?;
    app_config_manager::save(&dir, &config).await
}

#[tauri::command]
pub async fn add_app_repo(app: AppHandle, path: String, mode: RepoMode) -> Result<GlobalAppConfig, AppError> {
    let dir = app_data_dir(&app)?;
    let mut config = app_config_manager::load(&dir).await?;
    app_config_manager::add_repo(&mut config, path, mode)?;
    app_config_manager::save(&dir, &config).await?;
    Ok(config)
}

#[tauri::command]
pub async fn remove_app_repo(app: AppHandle, path: String) -> Result<GlobalAppConfig, AppError> {
    let dir = app_data_dir(&app)?;
    let mut config = app_config_manager::load(&dir).await?;
    app_config_manager::remove_repo(&mut config, &path);
    app_config_manager::save(&dir, &config).await?;
    Ok(config)
}

#[tauri::command]
pub async fn set_active_repo(app: AppHandle, path: String) -> Result<(), AppError> {
    let dir = app_data_dir(&app)?;
    let mut config = app_config_manager::load(&dir).await?;
    if !config.repos.iter().any(|r| r.path == path) {
        return Err(AppError::Config("Repository not found".into()));
    }
    config.active_repo = Some(path);
    app_config_manager::save(&dir, &config).await
}

/// Check if any PTY sessions are running for worktrees under a given repo's worktree base path.
#[tauri::command]
pub async fn has_active_sessions(app: AppHandle, repo_path: String) -> Result<bool, AppError> {
    let pty_manager = app.state::<PtyManager>();
    let sessions = pty_manager.list().unwrap_or_default();

    // Build the set of worktree names that belong to this repo
    let worktrees = crate::git_manager::list_worktrees(&repo_path, None)
        .await
        .unwrap_or_default();
    let repo_worktree_ids: std::collections::HashSet<String> =
        worktrees.iter().map(|wt| wt.id.clone()).collect();

    Ok(sessions.iter().any(|s| {
        repo_worktree_ids.contains(&s.worktree_id)
            && matches!(
                s.status,
                crate::types::SessionStatus::Running
                    | crate::types::SessionStatus::Idle
                    | crate::types::SessionStatus::WaitingForInput
            )
    }))
}
```

- [ ] **Step 2: Add module export to `commands/mod.rs`**

Add to `src-tauri/src/commands/mod.rs`:

```rust
pub mod app_config;
```

- [ ] **Step 3: Register commands and add migration in `lib.rs`**

Update `src-tauri/src/lib.rs`:
- Add `mod app_config_manager;` to module declarations
- Add `use commands::app_config;` to imports
- Add migration call in `.setup()` before the sync loop
- Add new commands to `invoke_handler`

```rust
// In .setup():
let app_data = app.path().app_data_dir().expect("app data dir");
let store_path = app_data.clone(); // tauri-plugin-store writes here too
tauri::async_runtime::block_on(async {
    app_config_manager::migrate_if_needed(&app_data, &store_path).await.ok();
});
```

Add to the invoke_handler list:
```rust
// App Config
app_config::get_app_config,
app_config::save_app_config,
app_config::add_app_repo,
app_config::remove_app_repo,
app_config::set_active_repo,
app_config::has_active_sessions,
```

- [ ] **Step 4: Run `cargo check`**

Run: `cd src-tauri && cargo check`
Expected: Compiles successfully

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/app_config.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add Tauri commands for app-level config CRUD"
```

---

## Task 3: Frontend Types & API Wrappers

**Files:**
- Modify: `src/types.ts`
- Modify: `src/api.ts`

- [ ] **Step 1: Add TypeScript types to `types.ts`**

```typescript
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
```

- [ ] **Step 2: Add API wrappers to `api.ts`**

```typescript
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

export function hasActiveSessions(repoPath: string): Promise<boolean> {
  return invoke("has_active_sessions", { repoPath });
}
```

Add the new type imports at the top of `api.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts src/api.ts
git commit -m "feat: add frontend types and API wrappers for app config"
```

---

## Task 4: `useAppConfig` Hook (Replaces `useRepoPath`)

**Files:**
- Create: `src/hooks/useAppConfig.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useState, useEffect, useCallback } from "react";
import {
  getAppConfig,
  saveAppConfig,
  addRepo as addRepoApi,
  removeRepo as removeRepoApi,
  setActiveRepo as setActiveRepoApi,
  validateGitRepo,
} from "../api";
import type { GlobalAppConfig, RepoMode } from "../types";

export function useAppConfig() {
  const [config, setConfig] = useState<GlobalAppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAppConfig()
      .then((c) => {
        if (!cancelled) {
          setConfig(c);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load app config");
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const activeRepo = config?.activeRepo ?? null;
  const repos = config?.repos ?? [];

  const addRepo = useCallback(async (path: string, mode: RepoMode = "branch") => {
    setError(null);
    const valid = await validateGitRepo(path);
    if (!valid) {
      setError("This folder isn't a git repository.");
      return null;
    }
    try {
      const updated = await addRepoApi(path, mode);
      setConfig(updated);
      return updated;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  const removeRepo = useCallback(async (path: string) => {
    const updated = await removeRepoApi(path);
    setConfig(updated);
    return updated;
  }, []);

  const switchRepo = useCallback(async (path: string) => {
    await setActiveRepoApi(path);
    setConfig((prev) =>
      prev ? { ...prev, activeRepo: path } : prev,
    );
  }, []);

  const updateRepoMode = useCallback(async (path: string, mode: RepoMode) => {
    if (!config) return;
    const updated = {
      ...config,
      repos: config.repos.map((r) =>
        r.path === path ? { ...r, mode } : r,
      ),
    };
    await saveAppConfig(updated);
    setConfig(updated);
  }, [config]);

  const updateGlobalSettings = useCallback(async (patch: Partial<Pick<GlobalAppConfig, "theme" | "notifications">>) => {
    if (!config) return;
    const updated = { ...config, ...patch };
    await saveAppConfig(updated);
    setConfig(updated);
  }, [config]);

  const clearError = useCallback(() => setError(null), []);

  return {
    config,
    loading,
    error,
    clearError,
    activeRepo,
    repos,
    addRepo,
    removeRepo,
    switchRepo,
    updateRepoMode,
    updateGlobalSettings,
  } as const;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useAppConfig.ts
git commit -m "feat: add useAppConfig hook replacing useRepoPath"
```

---

## Task 5: Workspace Store — Add `clearStore` Action

**Files:**
- Modify: `src/stores/workspaceStore.ts`

- [ ] **Step 1: Add `clearStore` action to the store interface and implementation**

Add to the `WorkspaceState` interface:

```typescript
clearStore: () => void;
```

Add to the store implementation:

```typescript
clearStore: () =>
  set({
    worktrees: [],
    activeWorktreeId: null,
    columnOverrides: {},
    lastPrState: {},
    seenWorktrees: new Set<string>(),
    tabs: {},
    activeTabId: {},
    annotations: {},
    sidebarCollapsed: false,
    archiveAfterDays: 2,
    checkRuns: {},
  }),
```

- [ ] **Step 2: Commit**

```bash
git add src/stores/workspaceStore.ts
git commit -m "feat: add clearStore action to workspace store for repo switching"
```

---

## Task 6: RepoWelcomeScreen & AddRepoModal

**Files:**
- Create: `src/components/onboarding/RepoWelcomeScreen.tsx`
- Create: `src/components/onboarding/AddRepoModal.tsx`

These components share core logic — a drag-and-drop zone for selecting a git repo folder. `RepoWelcomeScreen` renders full-screen (first launch), `AddRepoModal` renders as a dialog (subsequent repos).

- [ ] **Step 1: Create `RepoWelcomeScreen.tsx`**

This replaces the current OnboardingScreen step 1. Reuse the drag-and-drop + file picker pattern from the existing `OnboardingScreen.tsx`. Use the design-to-code skill with `designs/multi-repo-sidebar.html` as reference for styling.

Key requirements:
- Full-screen, no sidebar visible
- Alfredo logo at top
- Heading: "Add your first repository"
- Large drag-and-drop zone (use Tauri webview drag-drop events, same as current onboarding)
- "Open a repository" button (uses Tauri dialog plugin `open()`)
- Error state for invalid git repos
- Props: `onRepoSelected: (path: string) => void`, `error: string | null`, `onClearError: () => void`

- [ ] **Step 2: Create `AddRepoModal.tsx`**

Same drag-and-drop + file picker, but rendered inside a `Dialog` component:
- Heading: "Add a repository"
- Same drop zone and button
- Same error handling
- Props: `open: boolean`, `onOpenChange: (open: boolean) => void`, `onRepoSelected: (path: string) => void`, `error: string | null`, `onClearError: () => void`

- [ ] **Step 3: Commit**

```bash
git add src/components/onboarding/RepoWelcomeScreen.tsx src/components/onboarding/AddRepoModal.tsx
git commit -m "feat: add RepoWelcomeScreen and AddRepoModal components"
```

---

## Task 7: RepoSetupDialog

**Files:**
- Create: `src/components/onboarding/RepoSetupDialog.tsx`

This is the per-repo configuration modal that opens after selecting a repo.

- [ ] **Step 1: Create `RepoSetupDialog.tsx`**

Single scrollable modal with these sections, reusing existing patterns from `OnboardingScreen.tsx`:

1. **GitHub connection** — Reuse the device auth flow from current onboarding (calls `githubAuthStart`, `githubAuthPoll`, `githubAuthUser`). For subsequent repos, check if any existing repo has a token (passed as prop `existingGithubToken`), show "Connected as @username — use this account?" with reuse/change options.

2. **Linear connection** — API key input field. Pre-fill from `existingLinearKey` prop if available.

3. **Worktree base path** — Text input + folder picker (uses Tauri dialog `open({ directory: true })`). Default to repo parent directory.

4. **Setup scripts** — Single command input (like current onboarding).

5. **Actions:**
   - Primary: "Save & create first worktree" → calls `saveConfig(repoPath, config)` + `onConfigured("worktree")`
   - Secondary: "Skip — just use branches" → calls `saveConfig(repoPath, config)` + `onConfigured("branch")`

Props:
```typescript
interface RepoSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoPath: string;
  existingGithubToken?: string | null;
  existingLinearKey?: string | null;
  onConfigured: (mode: "worktree" | "branch") => void;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/onboarding/RepoSetupDialog.tsx
git commit -m "feat: add RepoSetupDialog for per-repo configuration"
```

---

## Task 8: RepoPills Component

**Files:**
- Create: `src/components/sidebar/RepoPills.tsx`

- [ ] **Step 1: Create `RepoPills.tsx`**

Use the design-to-code skill with `designs/multi-repo-sidebar.html` as reference.

Requirements:
- Horizontal scrollable row of pills (use `overflow-x: auto`, hide scrollbar with CSS)
- Active pill: accent background + border (`bg-accent-primary/20 border border-accent-primary/35`), bold text
- Inactive pills: subtle background (`bg-bg-tertiary/40`), muted text
- Activity dot: small green circle on pills with running agents (check via `hasActiveSessions` API)
- "+" button: subtle, muted, at the end — smaller than pill height, no border
- Click pill → call `onSwitch(path)`
- Click "+" → call `onAddRepo()`
- Right-click pill → context menu with "Remove repository" → call `onRemoveRepo(path)`

Props:
```typescript
interface RepoPillsProps {
  repos: RepoEntry[];
  activeRepo: string | null;
  onSwitch: (path: string) => void;
  onAddRepo: () => void;
  onRemoveRepo: (path: string) => void;
}
```

Activity dot: poll `hasActiveSessions(repo.path)` every 5s for non-active repos. Active repo uses store state directly.

- [ ] **Step 2: Commit**

```bash
git add src/components/sidebar/RepoPills.tsx
git commit -m "feat: add RepoPills sidebar component for multi-repo switching"
```

---

## Task 9: BranchModeView & RemoveRepoDialog

**Files:**
- Create: `src/components/sidebar/BranchModeView.tsx`
- Create: `src/components/sidebar/RemoveRepoDialog.tsx`

- [ ] **Step 1: Create `BranchModeView.tsx`**

Sidebar content for repos in branch mode. Use the design-to-code skill with `designs/multi-repo-sidebar.html` as reference (right panel mockup).

Requirements:
- Folder icon (Lucide `FolderOpen`)
- "Branch mode" heading
- Description: "This repo is using branches directly. Enable worktrees for parallel development."
- "Enable worktrees" button → calls `onEnableWorktrees()`
- Divider
- "Current branch" label with branch name (calls `getActiveBranch(repoPath)`)
- "Workspace settings" link at bottom

Props:
```typescript
interface BranchModeViewProps {
  repoPath: string;
  onEnableWorktrees: () => void;
}
```

- [ ] **Step 2: Create `RemoveRepoDialog.tsx`**

Simple confirmation dialog using the existing `Dialog` component:
- Title: "Remove repository"
- Body: "Remove {repoName} from Alfredo? This won't delete any files."
- Cancel button, Confirm button (destructive style)

Props:
```typescript
interface RemoveRepoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoName: string;
  onConfirm: () => void;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/BranchModeView.tsx src/components/sidebar/RemoveRepoDialog.tsx
git commit -m "feat: add BranchModeView and RemoveRepoDialog components"
```

---

## Task 10: Wire Up AppShell — Multi-Repo Lifecycle

**Files:**
- Modify: `src/components/layout/AppShell.tsx`

This is the integration task — replace `useRepoPath` with `useAppConfig` and wire up the full multi-repo lifecycle.

- [ ] **Step 1: Replace `useRepoPath` with `useAppConfig`**

Remove `import { useRepoPath }` and add `import { useAppConfig }`. Replace the hook call:

```typescript
const {
  config: appConfig,
  loading,
  error,
  clearError,
  activeRepo: repoPath,
  repos,
  addRepo,
  removeRepo,
  switchRepo,
  updateRepoMode,
} = useAppConfig();
```

- [ ] **Step 2: Add repo switching logic**

Add session save + store clear + reload on repo switch:

```typescript
const handleSwitchRepo = useCallback(async (path: string) => {
  if (repoPath && hasWorktrees) {
    // Save current repo's sessions before switching
    const state = useWorkspaceStore.getState();
    await saveAllSessions(
      repoPath,
      state.worktrees.map((wt) => wt.id),
      (wtId) => state.tabs[wtId] ?? [],
      (wtId) => state.activeTabId[wtId] ?? "",
      (tabId) => sessionManager.getBufferedOutputBase64(tabId),
    );
  }
  // Clear store and switch
  clearStore();
  await switchRepo(path);
  // Worktree loading will happen via the existing repoPath useEffect
}, [repoPath, hasWorktrees, switchRepo, clearStore]);
```

- [ ] **Step 3: Update the GitHub sync repo path on switch**

In the existing worktree-loading `useEffect`, add `setSyncRepoPath(repoPath)` call so the background sync follows the active repo.

- [ ] **Step 4: Update rendering logic**

Replace the onboarding check:
```typescript
// Old: const isOnboarding = !loading && worktrees.length === 0;
// New: show welcome screen when no repos exist
const hasNoRepos = !loading && repos.length === 0;
const activeRepoEntry = repos.find((r) => r.path === repoPath);
```

Rendering:
- If `hasNoRepos` → show `RepoWelcomeScreen`
- If repos exist → show sidebar + main workspace
- If active repo is branch mode → sidebar shows `BranchModeView` instead of worktree list

- [ ] **Step 5: Add state for dialogs**

```typescript
const [addRepoModalOpen, setAddRepoModalOpen] = useState(false);
const [setupDialogOpen, setSetupDialogOpen] = useState(false);
const [setupRepoPath, setSetupRepoPath] = useState<string | null>(null);
const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
const [removeRepoPath, setRemoveRepoPath] = useState<string | null>(null);
```

Wire handlers for the full flow:
1. `RepoWelcomeScreen.onRepoSelected` / `AddRepoModal.onRepoSelected` → `addRepo(path)` then open `RepoSetupDialog`
2. `RepoSetupDialog.onConfigured` → `updateRepoMode(path, mode)`, if worktree mode open `CreateWorktreeDialog`
3. `RepoPills.onRemoveRepo` → open `RemoveRepoDialog`
4. `RemoveRepoDialog.onConfirm` → `removeRepo(path)`

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/AppShell.tsx
git commit -m "feat: wire AppShell to multi-repo lifecycle with useAppConfig"
```

---

## Task 11: Update Sidebar for Multi-Repo

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx`

- [ ] **Step 1: Add RepoPills to sidebar**

Add `RepoPills` below the header row, above the worktree list. Pass repos, activeRepo, and handlers from props (passed down from AppShell).

- [ ] **Step 2: Remove collapse/expand**

Remove `sidebarCollapsed` references, `toggleSidebar`, and the collapsed view rendering. The sidebar is always expanded.

- [ ] **Step 3: Update header row**

Replace the current header with:
- Repo color avatar (generate deterministic color from repo name hash, show first letter)
- Repo name (folder name extracted from path)
- Settings gear icon
- No collapse button

- [ ] **Step 4: Conditionally render BranchModeView**

If the active repo's mode is `"branch"`, render `BranchModeView` instead of the status groups and worktree list.

- [ ] **Step 5: Remove "New worktree" button for branch-mode repos**

Only show the "New worktree" button when the active repo is in worktree mode.

- [ ] **Step 6: Commit**

```bash
git add src/components/sidebar/Sidebar.tsx
git commit -m "feat: update sidebar with RepoPills and multi-repo support"
```

---

## Task 12: Update Settings Dialogs

**Files:**
- Modify: `src/components/settings/GlobalSettingsDialog.tsx`
- Modify: `src/components/settings/WorkspaceSettingsDialog.tsx`

- [ ] **Step 1: Update GlobalSettingsDialog to use app config**

Replace `getConfig(".")`/`saveConfig(".", ...)` with `getAppConfig()`/`saveAppConfig(...)` for theme and notifications. These are now app-level settings, not per-repo.

- [ ] **Step 2: Update WorkspaceSettingsDialog**

The workspace settings dialog should continue reading per-repo config via `getConfig(repoPath)` for scripts and other repo-specific settings. Accept `repoPath` as a prop instead of using `"."`.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/GlobalSettingsDialog.tsx src/components/settings/WorkspaceSettingsDialog.tsx
git commit -m "feat: split global vs workspace settings between app.json and .alfredo.json"
```

---

## Task 13: Clean Up — Remove Old Onboarding & useRepoPath

**Files:**
- Delete: `src/hooks/useRepoPath.ts`
- Delete: `src/components/onboarding/OnboardingScreen.tsx`

- [ ] **Step 1: Delete old files**

```bash
rm src/hooks/useRepoPath.ts
rm src/components/onboarding/OnboardingScreen.tsx
```

- [ ] **Step 2: Remove any remaining imports of deleted files**

Search for `useRepoPath` and `OnboardingScreen` across the codebase and remove any remaining references.

- [ ] **Step 3: Run `npm run build` to verify no broken imports**

Run: `npm run build`
Expected: Builds successfully with no errors

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove legacy OnboardingScreen and useRepoPath hook"
```

---

## Task 14: Visual Polish — Design-to-Code Pass

**Files:**
- All new UI components from Tasks 6-9

- [ ] **Step 1: Use design-to-code skill**

Invoke `design-to-code` with:
- `designs/multi-repo-sidebar.html` as the visual reference
- Target components: `RepoWelcomeScreen`, `AddRepoModal`, `RepoSetupDialog`, `RepoPills`, `BranchModeView`, `RemoveRepoDialog`

Ensure all components use Nightingale UI primitives (Button, Input, Dialog) and follow the app's existing styling patterns (Tailwind CSS, theme variables).

- [ ] **Step 2: Verify all themes work**

Manually test each new component across at least 2 themes (light + dark) to ensure theme variables are used correctly.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "style: polish multi-repo UI components with design-to-code pass"
```

---

## Task 15: Integration Testing & Final Verification

- [ ] **Step 1: Run Rust tests**

Run: `cd src-tauri && cargo test`
Expected: All tests pass including new app_config_manager tests

- [ ] **Step 2: Run frontend build**

Run: `npm run build`
Expected: Builds successfully

- [ ] **Step 3: Run Tauri dev for manual testing**

Run: `npm run tauri dev`

Manual test checklist:
- [ ] First launch shows welcome screen with "Add your first repository"
- [ ] Selecting a folder adds it and opens setup dialog
- [ ] Setup dialog shows GitHub, Linear, worktree path, scripts fields
- [ ] "Save & create first worktree" → saves config, opens create worktree dialog
- [ ] "Skip — just use branches" → saves in branch mode, shows branch mode view
- [ ] Repo pill appears in sidebar
- [ ] "+" pill opens add repo modal
- [ ] Adding second repo pre-fills credentials from first
- [ ] Clicking repo pills switches between repos
- [ ] Switching repos saves sessions and loads new repo's worktrees
- [ ] Right-click pill → "Remove repository" → confirmation → removes
- [ ] Removing last repo shows welcome screen
- [ ] Branch mode view shows current branch and "Enable worktrees" button
- [ ] Global settings (theme) persists across repos
- [ ] Workspace settings are per-repo

- [ ] **Step 4: Commit any fixes from testing**

```bash
git add -A
git commit -m "fix: address issues found during integration testing"
```

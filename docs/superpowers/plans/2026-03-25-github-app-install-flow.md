# GitHub App Installation Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OAuth device flow with a single-step GitHub App installation flow using Tauri deep links.

**Architecture:** User clicks "Connect to GitHub" → browser opens GitHub App install page → user installs on org → GitHub redirects to `alfredo://github/callback?code=CODE&installation_id=ID` → Tauri intercepts deep link → backend exchanges code for token → done. All in one browser trip.

**Tech Stack:** Tauri v2, tauri-plugin-deep-link, Rust (reqwest), React, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-25-github-app-install-flow-design.md`

---

### Task 1: Add deep-link plugin and configuration

**Files:**
- Modify: `src-tauri/Cargo.toml:17` (add dependency)
- Modify: `src-tauri/tauri.conf.json` (add plugins section)
- Modify: `src-tauri/capabilities/default.json` (add permission)

- [ ] **Step 1: Add `tauri-plugin-deep-link` to Cargo.toml**

In `src-tauri/Cargo.toml`, add to `[dependencies]`:

```toml
tauri-plugin-deep-link = "2"
```

- [ ] **Step 2: Add deep-link plugin config to tauri.conf.json**

Add a `plugins` key at the top level of `src-tauri/tauri.conf.json`:

```json
"plugins": {
  "deep-link": {
    "desktop": {
      "schemes": ["alfredo"]
    }
  }
}
```

The full file should look like:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Alfredo",
  "version": "0.1.0",
  "identifier": "com.alfredo.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "Alfredo",
        "width": 1200,
        "height": 800,
        "minWidth": 900,
        "minHeight": 600
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  },
  "plugins": {
    "deep-link": {
      "desktop": {
        "schemes": ["alfredo"]
      }
    }
  }
}
```

- [ ] **Step 3: Add deep-link permission to capabilities**

In `src-tauri/capabilities/default.json`, add `"deep-link:default"` to the permissions array:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "shell:allow-execute",
    "shell:allow-open",
    "dialog:default",
    "store:default",
    "deep-link:default"
  ]
}
```

- [ ] **Step 4: Install the JS package**

Run:
```bash
npm install @tauri-apps/plugin-deep-link
```

- [ ] **Step 5: Verify it compiles**

Run:
```bash
cd src-tauri && cargo check
```

Expected: compiles successfully (may take a while to download the new crate).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json src-tauri/capabilities/default.json package.json package-lock.json
git commit -m "feat: add tauri-plugin-deep-link for GitHub App auth"
```

---

### Task 2: Add `installation_id` to config

**Files:**
- Modify: `src-tauri/src/types.rs:153-171`
- Modify: `src-tauri/src/config_manager.rs:16-35` (ConfigFile struct)
- Modify: `src-tauri/src/config_manager.rs:38-76` (load_config)
- Modify: `src-tauri/src/config_manager.rs:78-102` (save_config)

- [ ] **Step 1: Add `installation_id` to `AppConfig` in types.rs**

In `src-tauri/src/types.rs`, add after the `github_token` field (line 158):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub repo_path: String,
    pub setup_scripts: Vec<SetupScript>,
    pub github_token: Option<String>,
    pub github_installation_id: Option<u64>,
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

- [ ] **Step 2: Add `installation_id` to `ConfigFile` in config_manager.rs**

In `src-tauri/src/config_manager.rs`, add after `github_token` in the `ConfigFile` struct (line 20):

```rust
struct ConfigFile {
    #[serde(default)]
    pub setup_scripts: Vec<SetupScript>,
    #[serde(default)]
    pub github_token: Option<String>,
    #[serde(default)]
    pub github_installation_id: Option<u64>,
    #[serde(default)]
    pub linear_api_key: Option<String>,
    #[serde(default)]
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

- [ ] **Step 3: Update `load_config` to include `installation_id`**

In the defaults return (line 43-54), add `github_installation_id: None`:

```rust
return Ok(AppConfig {
    repo_path: repo_path.to_string(),
    setup_scripts: vec![],
    github_token: None,
    github_installation_id: None,
    linear_api_key: None,
    branch_mode: false,
    column_overrides: HashMap::new(),
    theme: None,
    notifications: None,
    worktree_base_path: None,
    archive_after_days: Some(2),
});
```

In the file-loaded return (line 64-75), add the mapping:

```rust
Ok(AppConfig {
    repo_path: repo_path.to_string(),
    setup_scripts: file.setup_scripts,
    github_token: file.github_token,
    github_installation_id: file.github_installation_id,
    linear_api_key: file.linear_api_key,
    branch_mode: file.branch_mode,
    column_overrides: file.column_overrides,
    theme: file.theme,
    notifications: file.notifications,
    worktree_base_path: file.worktree_base_path,
    archive_after_days: file.archive_after_days,
})
```

- [ ] **Step 4: Update `save_config` to include `installation_id`**

In `save_config` (line 82-92), add the field:

```rust
let file = ConfigFile {
    setup_scripts: config.setup_scripts.clone(),
    github_token: config.github_token.clone(),
    github_installation_id: config.github_installation_id,
    linear_api_key: config.linear_api_key.clone(),
    branch_mode: config.branch_mode,
    column_overrides: config.column_overrides.clone(),
    theme: config.theme.clone(),
    notifications: config.notifications.clone(),
    worktree_base_path: config.worktree_base_path.clone(),
    archive_after_days: config.archive_after_days,
};
```

- [ ] **Step 5: Update test fixtures**

In `test_save_and_load_config` (line 171-186), add the field to the test `AppConfig`:

```rust
let mut config = AppConfig {
    repo_path: path.to_string(),
    setup_scripts: vec![SetupScript {
        name: "install".into(),
        command: "npm install".into(),
        run_on: "create".into(),
    }],
    github_token: Some("ghp_test".into()),
    github_installation_id: Some(12345),
    linear_api_key: None,
    branch_mode: true,
    column_overrides: HashMap::new(),
    theme: None,
    notifications: None,
    worktree_base_path: None,
    archive_after_days: Some(2),
};
```

And add an assertion after the load:

```rust
assert_eq!(loaded.github_installation_id, Some(12345));
```

- [ ] **Step 6: Verify tests pass**

Run:
```bash
cd src-tauri && cargo test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/types.rs src-tauri/src/config_manager.rs
git commit -m "feat: add github_installation_id to config"
```

---

### Task 3: Replace device flow with code exchange in `github_auth.rs`

**Files:**
- Modify: `src-tauri/src/commands/github_auth.rs` (replace entire file)

- [ ] **Step 1: Replace `github_auth.rs` with the new implementation**

Replace the contents of `src-tauri/src/commands/github_auth.rs` with:

```rust
use crate::config_manager;
use crate::types::AppError;

type Result<T> = std::result::Result<T, AppError>;

const CLIENT_ID: &str = "Iv23liW7PqCMQFlyKwXR";
const CLIENT_SECRET: &str = "03ce5ab9c818172a1f7d1a166f3fe7afd0f90f1d";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";

/// Exchange an authorization code (from GitHub App installation callback)
/// for a user access token.
#[tauri::command]
pub async fn github_auth_exchange(code: String) -> Result<String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(ACCESS_TOKEN_URL)
        .header("Accept", "application/json")
        .form(&[
            ("client_id", CLIENT_ID),
            ("client_secret", CLIENT_SECRET),
            ("code", code.as_str()),
        ])
        .send()
        .await
        .map_err(|e| AppError::Github(format!("failed to exchange code: {e}")))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Github(format!(
            "GitHub token exchange failed: {body}"
        )));
    }

    #[derive(serde::Deserialize)]
    struct TokenResponse {
        #[serde(default)]
        access_token: Option<String>,
        #[serde(default)]
        error: Option<String>,
        #[serde(default)]
        error_description: Option<String>,
    }

    let body: TokenResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Github(format!("failed to parse token response: {e}")))?;

    if let Some(error) = body.error {
        let desc = body.error_description.unwrap_or_default();
        return Err(AppError::Github(format!("GitHub auth error: {error} — {desc}")));
    }

    body.access_token
        .ok_or_else(|| AppError::Github("no access_token in response".into()))
}

/// Fetch the authenticated user's login name from the token.
#[tauri::command]
pub async fn github_auth_user(token: String) -> Result<String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", "alfredo-desktop")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| AppError::Github(format!("failed to fetch user: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Github("invalid token — could not fetch user".into()));
    }

    let user: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Github(format!("failed to parse user response: {e}")))?;

    user.get("login")
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| AppError::Github("no login field in user response".into()))
}

/// Disconnect GitHub: clear the token and installation ID from config.
#[tauri::command]
pub async fn github_auth_disconnect(repo_path: String) -> Result<()> {
    let mut config = config_manager::load_config(&repo_path).await?;
    config.github_token = None;
    config.github_installation_id = None;
    config_manager::save_config(&repo_path, &config).await?;
    Ok(())
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
cd src-tauri && cargo check
```

Expected: compile error because `lib.rs` still references `github_auth::github_auth_start` and `github_auth::github_auth_poll`. That's expected — we'll fix it in Task 5.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/github_auth.rs
git commit -m "feat: replace device flow with code exchange in github_auth"
```

---

### Task 4: Register deep-link plugin and handler in `lib.rs`

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Update lib.rs with deep-link plugin, handler, and updated command registration**

Replace the contents of `src-tauri/src/lib.rs` with:

```rust
mod agent_detector;
mod app_config_manager;
mod branch_manager;
mod commands;
mod config_manager;
mod git_manager;
mod github_manager;
mod github_sync;
mod linear_manager;
mod pty_manager;
mod state_server;
mod types;

use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;

use commands::{app_config, branch, checks, config, diff, github, github_auth, linear, pty, repo, session, worktree};
use github_sync::SyncState;
use pty_manager::PtyManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_deep_link::init())
        .manage(PtyManager::new())
        .manage(SyncState {
            repo_path: std::sync::Mutex::new(None),
        })
        .setup(|app| {
            // Migrate legacy single-repo config to app.json
            let app_data = app.path().app_data_dir().expect("app data dir");
            let store_path = app_data.clone();
            tauri::async_runtime::block_on(async {
                app_config_manager::migrate_if_needed(&app_data, &store_path).await.ok();
            });

            // Handle deep links (GitHub App installation callback)
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    if url.scheme() == "alfredo" && url.path() == "/callback" {
                        let code = url.query_pairs()
                            .find(|(k, _)| k == "code")
                            .map(|(_, v)| v.to_string());
                        let installation_id = url.query_pairs()
                            .find(|(k, _)| k == "installation_id")
                            .map(|(_, v)| v.to_string());

                        if let Some(code) = code {
                            let _ = handle.emit("github-auth-callback", serde_json::json!({
                                "code": code,
                                "installationId": installation_id,
                            }));
                        } else {
                            let _ = handle.emit("github-auth-callback-error", serde_json::json!({
                                "error": "Missing authorization code in callback URL",
                            }));
                        }
                    }
                }
            });

            // Start the background GitHub PR sync loop
            github_sync::start_sync_loop(app.handle().clone());

            // Start the agent state HTTP server for hook callbacks
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state_handle = state_server::start().await;
                eprintln!("[alfredo] state server listening on port {}", state_handle.port);
                handle.manage(state_handle);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // App Config
            app_config::get_app_config,
            app_config::save_app_config,
            app_config::add_app_repo,
            app_config::remove_app_repo,
            app_config::set_active_repo,
            app_config::has_active_sessions,
            // PTY
            pty::spawn_pty,
            pty::write_pty,
            pty::resize_pty,
            pty::close_pty,
            pty::list_sessions,
            // Worktree
            worktree::create_worktree_from,
            worktree::create_worktree,
            worktree::delete_worktree,
            worktree::list_worktrees,
            worktree::get_worktree_diff_stats,
            worktree::get_worktree_status,
            worktree::set_worktree_column,
            // GitHub
            github::sync_pr_status,
            github::get_pr_for_branch,
            checks::get_check_runs,
            github_sync::set_sync_repo_path,
            // GitHub Auth
            github_auth::github_auth_exchange,
            github_auth::github_auth_user,
            github_auth::github_auth_disconnect,
            // Config
            config::get_config,
            config::save_config,
            config::run_setup_scripts,
            // Repo
            repo::validate_git_repo,
            // Branch mode
            branch::list_branches,
            branch::get_active_branch,
            branch::create_branch,
            branch::switch_branch,
            branch::delete_branch,
            // Linear
            linear::search_linear_issues,
            linear::get_linear_issue,
            linear::list_linear_teams,
            // Diff
            diff::get_diff,
            diff::get_commits,
            diff::get_diff_for_commit,
            // Session persistence
            session::save_session_file,
            session::load_session_file,
            session::delete_session_file,
            session::ensure_alfredo_gitignore,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Key changes from the original:
- Added `use tauri_plugin_deep_link::DeepLinkExt;`
- Added `.plugin(tauri_plugin_deep_link::init())`
- Added `on_open_url` handler that parses `alfredo://github/callback?code=X&installation_id=Y` and emits `github-auth-callback` event
- Replaced `github_auth_start` and `github_auth_poll` with `github_auth_exchange` in the invoke handler

- [ ] **Step 2: Verify it compiles**

Run:
```bash
cd src-tauri && cargo check
```

Expected: compiles successfully.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: register deep-link plugin and GitHub callback handler"
```

---

### Task 5: Update frontend API layer

**Files:**
- Modify: `src/api.ts:156-183`

- [ ] **Step 1: Replace device flow API functions with `githubAuthExchange`**

In `src/api.ts`, find the GitHub Auth section (around line 156-183). Replace `githubAuthStart` and `githubAuthPoll` with `githubAuthExchange`. Also remove the `DeviceCodeResponse` type if it exists.

Find this block:

```typescript
export function githubAuthStart(): Promise<DeviceCodeResponse> {
  return invoke("github_auth_start");
}

export function githubAuthPoll(deviceCode: string, initialInterval: number): Promise<string> {
  return invoke("github_auth_poll", { deviceCode, initialInterval });
}
```

Replace with:

```typescript
export function githubAuthExchange(code: string): Promise<string> {
  return invoke("github_auth_exchange", { code });
}
```

Also find and remove the `DeviceCodeResponse` interface (search for it in the file — it's the type used by `githubAuthStart`).

Keep `githubAuthUser` and `githubAuthDisconnect` unchanged.

- [ ] **Step 2: Commit**

```bash
git add src/api.ts
git commit -m "feat: replace device flow API with githubAuthExchange"
```

---

### Task 6: Update `GithubSettings.tsx` with new auth flow

**Files:**
- Modify: `src/components/settings/GithubSettings.tsx` (replace entire file)

- [ ] **Step 1: Replace GithubSettings with the new deep-link flow**

Replace the contents of `src/components/settings/GithubSettings.tsx` with:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Github, Check, Loader2, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import {
  githubAuthExchange,
  githubAuthUser,
  githubAuthDisconnect,
  saveConfig,
  getConfig,
} from "../../api";

const INSTALL_URL = "https://github.com/apps/alfredo-desktop/installations/new";
const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface GithubSettingsProps {
  githubToken: string;
  linearApiKey: string;
  onGithubTokenChange: (value: string) => void;
  onLinearApiKeyChange: (value: string) => void;
}

type AuthState =
  | { step: "idle" }
  | { step: "waiting" }
  | { step: "connected"; username: string };

function GithubSettings({
  githubToken,
  linearApiKey,
  onGithubTokenChange,
  onLinearApiKeyChange,
}: GithubSettingsProps) {
  const [auth, setAuth] = useState<AuthState>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On mount, check if we already have a token and resolve username
  useEffect(() => {
    if (!githubToken) return;
    githubAuthUser(githubToken)
      .then((username) => setAuth({ step: "connected", username }))
      .catch(() => setAuth({ step: "idle" }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup listeners and timeouts on unmount
  useEffect(() => {
    return () => {
      unlistenRef.current?.();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const startAuth = useCallback(async () => {
    setError(null);
    setAuth({ step: "waiting" });

    try {
      // Listen for the deep link callback from Tauri
      unlistenRef.current?.();
      const unlisten = await listen<{ code: string; installationId?: string }>(
        "github-auth-callback",
        async (event) => {
          try {
            const { code, installationId } = event.payload;
            const token = await githubAuthExchange(code);

            onGithubTokenChange(token);
            const username = await githubAuthUser(token);
            setAuth({ step: "connected", username });

            // Persist immediately so sync loop picks it up
            const config = await getConfig(".");
            config.githubToken = token;
            if (installationId) {
              config.githubInstallationId = Number(installationId);
            }
            await saveConfig(".", config);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setAuth({ step: "idle" });
          } finally {
            unlisten();
            unlistenRef.current = null;
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
          }
        }
      );
      unlistenRef.current = unlisten;

      // Also listen for errors
      const unlistenError = await listen<{ error: string }>(
        "github-auth-callback-error",
        (event) => {
          setError(event.payload.error);
          setAuth({ step: "idle" });
          unlisten();
          unlistenError();
          unlistenRef.current = null;
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
        }
      );

      // Timeout after 5 minutes
      timeoutRef.current = setTimeout(() => {
        unlisten();
        unlistenError();
        unlistenRef.current = null;
        setError("Timed out waiting for GitHub authorization. Please try again.");
        setAuth({ step: "idle" });
      }, AUTH_TIMEOUT_MS);

      // Open the GitHub App installation page
      await openUrl(INSTALL_URL);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setAuth({ step: "idle" });
    }
  }, [onGithubTokenChange]);

  const cancelAuth = useCallback(() => {
    unlistenRef.current?.();
    unlistenRef.current = null;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setAuth({ step: "idle" });
    setError(null);
  }, []);

  const disconnect = useCallback(async () => {
    onGithubTokenChange("");
    setAuth({ step: "idle" });
    setError(null);
    try {
      await githubAuthDisconnect(".");
    } catch {
      // Best effort
    }
  }, [onGithubTokenChange]);

  return (
    <div className="space-y-5">
      {/* GitHub Connection */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-text-primary">GitHub</label>

        {auth.step === "idle" && (
          <div className="space-y-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={startAuth}
            >
              <Github className="h-3.5 w-3.5 mr-1.5" />
              Connect to GitHub
            </Button>
            <p className="text-xs text-text-tertiary">
              Installs the Alfredo app on your GitHub account to access repos and PRs.
            </p>
            {error && (
              <p className="text-xs text-red-400">{error}</p>
            )}
          </div>
        )}

        {auth.step === "waiting" && (
          <div className="rounded-[var(--radius-md)] border border-border-default bg-bg-secondary p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Waiting for GitHub authorization...
              </div>
              <Button variant="secondary" size="sm" onClick={cancelAuth}>
                <X className="h-3.5 w-3.5 mr-1" />
                Cancel
              </Button>
            </div>
            <p className="text-xs text-text-tertiary">
              Complete the installation in your browser, then return here.
            </p>
          </div>
        )}

        {auth.step === "connected" && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border-default bg-bg-secondary px-3 h-8 text-sm">
              <Check className="h-3.5 w-3.5 text-green-400" />
              <span className="text-text-primary font-medium">
                @{auth.username}
              </span>
            </div>
            <Button variant="secondary" size="sm" onClick={disconnect}>
              <X className="h-3.5 w-3.5 mr-1" />
              Disconnect
            </Button>
          </div>
        )}
      </div>

      {/* Linear API Key */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-text-primary">
          Linear API Key
        </label>
        <Input
          type="password"
          placeholder="lin_api_xxxxxxxxxxxx"
          value={linearApiKey}
          onChange={(e) => onLinearApiKeyChange(e.target.value)}
        />
        <p className="text-xs text-text-tertiary">
          Used for creating worktrees from Linear tickets.
        </p>
      </div>
    </div>
  );
}

export { GithubSettings };
```

Key changes:
- Imports `listen` from `@tauri-apps/api/event` instead of device flow APIs
- Opens `https://github.com/apps/alfredo-desktop/installations/new` directly
- Listens for `github-auth-callback` Tauri event (emitted by the deep link handler in `lib.rs`)
- Exchanges the `code` for a token via `githubAuthExchange`
- Saves `installationId` to config alongside the token
- Simplified `waiting` state: spinner + cancel button (no device code display)
- 5-minute timeout with auto-reset to idle
- Proper cleanup of listeners and timeouts on unmount

- [ ] **Step 2: Verify the frontend compiles**

Run:
```bash
npm run build
```

Expected: compiles successfully.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/GithubSettings.tsx
git commit -m "feat: update GithubSettings to use GitHub App installation flow"
```

---

### Task 7: Update `RepoSetupDialog.tsx` with new auth flow

`RepoSetupDialog.tsx` also uses the device flow for onboarding new repos. It needs the same deep-link treatment.

**Files:**
- Modify: `src/components/onboarding/RepoSetupDialog.tsx`

- [ ] **Step 1: Update imports**

In `src/components/onboarding/RepoSetupDialog.tsx`, replace the import line (line 15):

```typescript
import { getConfig, saveConfig, githubAuthStart, githubAuthPoll, githubAuthUser } from "../../api";
```

with:

```typescript
import { getConfig, saveConfig, githubAuthExchange, githubAuthUser } from "../../api";
```

Add the `listen` import at the top of the file:

```typescript
import { listen } from "@tauri-apps/api/event";
```

Remove `ExternalLink` from the lucide-react import (no longer needed for the "Open GitHub" button) — but only if it's not used elsewhere in the file. Check first.

- [ ] **Step 2: Simplify the auth state type**

Replace the `githubAuthState` type (lines 43-47):

```typescript
const [githubAuthState, setGithubAuthState] = useState<
  | { step: "idle" }
  | { step: "loading" }
  | { step: "waiting"; userCode: string; deviceCode: string; verificationUri: string }
>({ step: "idle" });
```

with:

```typescript
const [githubAuthState, setGithubAuthState] = useState<
  | { step: "idle" }
  | { step: "waiting" }
>({ step: "idle" });
```

- [ ] **Step 3: Replace the `startGithubAuth` callback**

Replace the `startGithubAuth` callback (lines 110-134) with:

```typescript
const startGithubAuth = useCallback(async () => {
  setGithubError(null);
  setUsingExistingGithub(false);
  setGithubAuthState({ step: "waiting" });

  try {
    const unlisten = await listen<{ code: string; installationId?: string }>(
      "github-auth-callback",
      async (event) => {
        try {
          const { code } = event.payload;
          const token = await githubAuthExchange(code);
          setGithubToken(token);
          const username = await githubAuthUser(token);
          setGithubConnected(username);
          setGithubAuthState({ step: "idle" });
        } catch (e) {
          setGithubError(e instanceof Error ? e.message : String(e));
          setGithubAuthState({ step: "idle" });
        } finally {
          unlisten();
        }
      }
    );

    await openUrl("https://github.com/apps/alfredo-desktop/installations/new");
  } catch (e) {
    setGithubError(e instanceof Error ? e.message : String(e));
    setGithubAuthState({ step: "idle" });
  }
}, []);
```

- [ ] **Step 4: Update the waiting UI**

Replace the waiting state UI block (lines 210-230) — the section that shows `githubAuthState.userCode` and the "Open GitHub" button — with a simple spinner:

```tsx
) : githubAuthState.step === "waiting" ? (
  <div className="flex items-center gap-1.5 text-2xs text-text-tertiary">
    <Loader2 className="h-3 w-3 animate-spin" />
    Waiting for GitHub authorization...
  </div>
```

Also update the "Connect to GitHub" button (lines 256-268) — remove the `disabled` check for `"loading"` state since that state no longer exists:

```tsx
<Button
  variant="secondary"
  size="sm"
  onClick={startGithubAuth}
  disabled={githubAuthState.step === "waiting"}
>
  {githubAuthState.step === "waiting" ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
  ) : (
    <Github className="h-3.5 w-3.5 mr-1.5" />
  )}
  Connect to GitHub
</Button>
```

- [ ] **Step 5: Verify the frontend compiles**

Run:
```bash
npm run build
```

Expected: compiles successfully with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/onboarding/RepoSetupDialog.tsx
git commit -m "feat: update RepoSetupDialog to use GitHub App installation flow"
```

---

### Task 8: Configure GitHub App callback URL

This is a manual step — no code changes.

- [ ] **Step 1: Set the callback URL in GitHub App settings**

1. Go to https://github.com/settings/apps/alfredo-desktop
2. Under "Callback URL", set: `alfredo://github/callback`
3. Make sure "Request user authorization (OAuth) during installation" is checked (already confirmed)
4. Save changes

---

### Task 9: End-to-end test

- [ ] **Step 1: Build and run the app**

Run:
```bash
npm run tauri dev
```

- [ ] **Step 2: Test the connect flow**

1. Open Settings → GitHub tab
2. Click "Connect to GitHub"
3. Browser should open to `https://github.com/apps/alfredo-desktop/installations/new`
4. Install the app on the `team-florence` org (or your personal account)
5. After installation, GitHub should redirect to `alfredo://github/callback?code=...&installation_id=...`
6. The app should intercept the deep link, exchange the code, and show the connected state with your username

- [ ] **Step 3: Verify the token works**

1. Check that `.alfredo.json` in the Florence repo now has both `githubToken` and `githubInstallationId`
2. Verify the PR sync works — the "[github_sync] poll error" should be gone
3. Check the kanban board shows PR status

- [ ] **Step 4: Test disconnect**

1. Click "Disconnect" in settings
2. Verify token is cleared from `.alfredo.json`
3. Verify re-connecting works (should skip installation since app is already installed, just re-authorize)

# Alfredo

Tauri v2 desktop app for managing Claude Code / Codex agents across git worktrees. Replaces Conductor.build as a personal tool. Stack: Rust backend, React + Vite + TS frontend.

## Commands

```bash
npm run tauri dev             # Full app (Vite + Rust backend)
npm run dev                   # Vite only (rare — usually want tauri dev)
npm run build                 # Production frontend build
npm test                      # Vitest
cd src-tauri && cargo check   # Rust typecheck without running
```

Package manager is **npm**, not pnpm or yarn. Lockfile is `package-lock.json`.

## Architecture

- `src/` — React frontend
  - `components/sidebar/` — worktree list (`AgentItem`, `StatusGroup`, `Sidebar`)
  - `components/kanban/` — kanban column UI
  - `hooks/useAppConfig.ts` — global config hook; dispatches a `config-changed` window event for cross-component refetch
  - `api.ts` — Tauri `invoke` wrappers, one function per backend command
  - `stores/workspaceStore.ts` — Zustand store for worktree state
- `src-tauri/src/` — Rust backend
  - `lib.rs` — all `#[tauri::command]`s registered in one `invoke_handler!` macro
  - `commands/app_config.rs` — global config mutation commands (pattern to mirror for new config fields)
  - `types.rs` — `GlobalAppConfig` struct; new fields need `#[serde(default)]`
  - `app_config_manager.rs` — load/save `app.json`; has multiple default-construction sites that all need updating when adding a config field
  - `git_manager.rs` — libgit2-based worktree ops
  - `pty_manager.rs` — terminal session management

## Adding a new global config field

1. Add field on `GlobalAppConfig` in `types.rs` with `#[serde(default)]`.
2. Update **every** `GlobalAppConfig { .. }` construction in `app_config_manager.rs` (defaults + 3 test sites). `cargo check` will catch any you miss.
3. New `#[tauri::command]` in `commands/app_config.rs` returning `GlobalAppConfig`.
4. Register the command in `lib.rs` `invoke_handler!`.
5. Frontend wrapper in `src/api.ts`, hook method in `hooks/useAppConfig.ts`.
6. Mirror the `repo_display_names` / `worktree_labels` plumbing if it needs to reach the sidebar UI.

## Testing

No test infrastructure exists yet. Do NOT create new test files speculatively. Rust has inline `#[cfg(test)]` modules (see `app_config_manager.rs`); add to existing ones if relevant.

## Gotchas

- If the UI looks stale after a restart, clear `~/Library/Caches/com.alfredo.app/WebKit`.
- Sidebar row `<button>` has dnd-kit `useSortable` listeners spread on it. Any nested interactive element must stop pointer/mouse/click/keydown propagation, or swap the outer element to a `<div>` while interactive.
- `#[serde(default)]` is required on new `GlobalAppConfig` fields or existing `app.json` files fail to deserialize.
- Windows build is disabled in CI (broken). macOS + Linux only.
- Releases: use the `release-alfredo` skill, do not bump versions manually.

## Links

- Repo: https://github.com/chloehkwong1/alfredo
- Release workflow: `.github/workflows/release.yml`

# Open Worktree in Editor/Terminal — Design Spec

## Overview

Two new actions — "Open in Editor" and "Open in Terminal" — that launch a worktree's directory in the user's preferred external editor or terminal app.

## UI Placement

### Settings Status Bar (primary)

Plain icon + text buttons on the right side of `SettingsStatusBar` (`src/components/terminal/SettingsStatusBar.tsx`). Positioned after the existing Effort/Permissions/Output chips, right-aligned.

- **"Editor"** — pen/edit icon + "Editor" text
- **"Terminal"** — terminal prompt icon + "Terminal" text
- Style: `text-text-tertiary` default, `hover:text-text-secondary` on hover. No background/chip styling.
- Opens the currently active worktree's path.

### Sidebar Context Menu (secondary)

New items in the right-click context menu on worktree cards (`src/components/sidebar/AgentItem.tsx`), above the existing Archive/Delete items:

- "Open in Editor" (with editor icon)
- "Open in Terminal" (with terminal icon)
- Separator below, before Archive/Delete

This allows opening any worktree, not just the active one.

## Settings

### Storage

Global preference in `app.json` (app-level config via `app_config_manager.rs`). Not per-repo.

New fields on the app config:

```typescript
{
  preferredEditor: string;   // "vscode" | "cursor" | "zed" | "vim" | "custom"
  customEditorPath?: string; // only when preferredEditor === "custom"
  preferredTerminal: string; // "iterm" | "terminal" | "warp" | "ghostty" | "custom"
  customTerminalPath?: string;
}
```

Defaults: `"vscode"` for editor, `"iterm"` for terminal.

### Settings UI

New **"External Tools"** section in the Global Settings dialog (`src/components/settings/GlobalSettingsDialog.tsx`). Can be added as a subsection within an existing tab or as a new tab — implementation discretion based on what fits best visually.

**Editor dropdown options:**
| Value | Label | Command |
|-------|-------|---------|
| `vscode` | VS Code | `code <path>` |
| `cursor` | Cursor | `cursor <path>` |
| `zed` | Zed | `zed <path>` |
| `vim` | Vim/Neovim | opens in terminal via `nvim <path>` |
| `custom` | Custom... | uses `customEditorPath` |

**Terminal dropdown options:**
| Value | Label | Command |
|-------|-------|---------|
| `iterm` | iTerm2 | `open -a iTerm <path>` |
| `terminal` | Terminal.app | `open -a Terminal <path>` |
| `warp` | Warp | `open -a Warp <path>` |
| `ghostty` | Ghostty | `open -a Ghostty <path>` |
| `custom` | Custom... | uses `customTerminalPath` |

When "Custom..." is selected, show a text input for the executable path/command.

## Backend

### Rust Commands

Two new Tauri commands in a new file `src-tauri/src/commands/external_tools.rs`:

**`open_in_editor(path: String, editor: String, custom_path: Option<String>)`**
- Maps `editor` value to the appropriate CLI command
- Spawns a detached process (fire-and-forget) via `std::process::Command`
- Returns `Result<(), AppError>` for error reporting

**`open_in_terminal(path: String, terminal: String, custom_path: Option<String>)`**
- Maps `terminal` value to the appropriate `open -a` command
- Spawns a detached process
- Returns `Result<(), AppError>` for error reporting

Both commands:
- Validate that the path exists before spawning
- Use `.spawn()` (not `.output()`) so the process runs independently
- Log errors but don't block the UI

### TypeScript API

New exports in `src/api.ts`:

```typescript
export function openInEditor(path: string, editor: string, customPath?: string): Promise<void>
export function openInTerminal(path: string, terminal: string, customPath?: string): Promise<void>
```

## Data Flow

1. User clicks "Editor" or "Terminal" button in status bar (or context menu on a worktree)
2. Frontend reads preferred editor/terminal from app config
3. Frontend calls `openInEditor(worktreePath, preferredEditor, customPath)` or `openInTerminal(...)`
4. Rust validates path exists, maps preference to CLI command, spawns detached process
5. Success: no UI feedback needed (editor/terminal window appears)
6. Error: toast notification with error message

## Scope Boundaries

- macOS only for now (commands use `open -a` for terminals). Cross-platform support deferred.
- No auto-detection of installed editors/terminals. User picks from the dropdown.
- No per-repo overrides. Global preference only.

# Open Worktree in Editor/Terminal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Open in Editor" and "Open in Terminal" buttons that launch the active worktree in the user's preferred external tools.

**Architecture:** New Rust commands spawn detached processes for editors/terminals. Preferences stored in GlobalAppConfig (app.json). Frontend buttons in SettingsStatusBar + sidebar context menu.

**Tech Stack:** Rust (std::process::Command), Tauri v2 commands, React, TypeScript

---

### Task 1: Add external tool preferences to GlobalAppConfig (Rust types)

**Files:**
- Modify: `src-tauri/src/types.rs:295-312` (GlobalAppConfig struct)

- [ ] **Step 1: Add fields to the Rust GlobalAppConfig struct**

In `src-tauri/src/types.rs`, add four new fields to `GlobalAppConfig` after `repo_display_names`:

```rust
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
    #[serde(default = "default_editor")]
    pub preferred_editor: String,
    #[serde(default)]
    pub custom_editor_path: Option<String>,
    #[serde(default = "default_terminal")]
    pub preferred_terminal: String,
    #[serde(default)]
    pub custom_terminal_path: Option<String>,
}

fn default_editor() -> String { "vscode".into() }
fn default_terminal() -> String { "iterm".into() }
```

- [ ] **Step 2: Update the default constructor in app_config_manager.rs**

In `src-tauri/src/app_config_manager.rs`, update the default return in the `load` function (line 16) to include the new fields:

```rust
return Ok(GlobalAppConfig {
    repos: vec![],
    active_repo: None,
    theme: None,
    notifications: None,
    selected_repos: vec![],
    display_name: None,
    repo_colors: std::collections::HashMap::new(),
    repo_display_names: std::collections::HashMap::new(),
    preferred_editor: "vscode".into(),
    custom_editor_path: None,
    preferred_terminal: "iterm".into(),
    custom_terminal_path: None,
});
```

Also update all `GlobalAppConfig { ... }` literals in the test functions (lines 159, 181, 199) to include the four new fields with their defaults.

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && cargo check -p alfredo`
Expected: compiles with no errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/types.rs src-tauri/src/app_config_manager.rs
git commit -m "feat: add external tool preferences to GlobalAppConfig"
```

---

### Task 2: Add TypeScript types and API functions

**Files:**
- Modify: `src/types.ts:300-309` (GlobalAppConfig interface)
- Modify: `src/api.ts` (add new invoke wrappers)

- [ ] **Step 1: Add fields to the TypeScript GlobalAppConfig interface**

In `src/types.ts`, add four new fields to the `GlobalAppConfig` interface:

```typescript
export interface GlobalAppConfig {
  repos: RepoEntry[];
  activeRepo: string | null;
  theme: string | null;
  notifications: NotificationConfig | null;
  selectedRepos: string[];
  displayName: string | null;
  repoColors: Record<string, string>;
  repoDisplayNames: Record<string, string>;
  preferredEditor: string;
  customEditorPath: string | null;
  preferredTerminal: string;
  customTerminalPath: string | null;
}
```

- [ ] **Step 2: Add API functions for opening in editor/terminal**

In `src/api.ts`, add these two functions at the end of the file:

```typescript
// ── External Tools ─────────────────────────────────────────────

export function openInEditor(
  path: string,
  editor: string,
  customPath?: string,
): Promise<void> {
  return invoke("open_in_editor", { path, editor, customPath: customPath ?? null });
}

export function openInTerminal(
  path: string,
  terminal: string,
  customPath?: string,
): Promise<void> {
  return invoke("open_in_terminal", { path, terminal, customPath: customPath ?? null });
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit`
Expected: no errors (the invoke targets don't exist yet, but TS won't check that)

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/api.ts
git commit -m "feat: add external tool types and API functions"
```

---

### Task 3: Implement Rust commands for opening editor/terminal

**Files:**
- Create: `src-tauri/src/commands/external_tools.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add module)
- Modify: `src-tauri/src/lib.rs` (register commands)

- [ ] **Step 1: Create the external_tools command module**

Create `src-tauri/src/commands/external_tools.rs`:

```rust
use std::process::Command;

use crate::types::AppError;

/// Map editor preference to the CLI command and args to open a directory.
fn editor_command(editor: &str, path: &str, custom_path: Option<&str>) -> Result<(String, Vec<String>), AppError> {
    match editor {
        "vscode" => Ok(("code".into(), vec![path.into()])),
        "cursor" => Ok(("cursor".into(), vec![path.into()])),
        "zed" => Ok(("zed".into(), vec![path.into()])),
        "vim" => Ok(("nvim".into(), vec![path.into()])),
        "custom" => {
            let cmd = custom_path
                .ok_or_else(|| AppError::Config("Custom editor path not set".into()))?;
            Ok((cmd.into(), vec![path.into()]))
        }
        _ => Err(AppError::Config(format!("Unknown editor: {editor}"))),
    }
}

/// Map terminal preference to the command and args to open a directory.
fn terminal_command(terminal: &str, path: &str, custom_path: Option<&str>) -> Result<(String, Vec<String>), AppError> {
    match terminal {
        "iterm" => Ok(("open".into(), vec!["-a".into(), "iTerm".into(), path.into()])),
        "terminal" => Ok(("open".into(), vec!["-a".into(), "Terminal".into(), path.into()])),
        "warp" => Ok(("open".into(), vec!["-a".into(), "Warp".into(), path.into()])),
        "ghostty" => Ok(("open".into(), vec!["-a".into(), "Ghostty".into(), path.into()])),
        "custom" => {
            let cmd = custom_path
                .ok_or_else(|| AppError::Config("Custom terminal path not set".into()))?;
            Ok((cmd.into(), vec![path.into()]))
        }
        _ => Err(AppError::Config(format!("Unknown terminal: {terminal}"))),
    }
}

#[tauri::command]
pub fn open_in_editor(
    path: String,
    editor: String,
    custom_path: Option<String>,
) -> Result<(), AppError> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(AppError::Config(format!("Path does not exist: {path}")));
    }

    let (cmd, args) = editor_command(&editor, &path, custom_path.as_deref())?;

    Command::new(&cmd)
        .args(&args)
        .spawn()
        .map_err(|e| AppError::Config(format!("Failed to open editor ({cmd}): {e}")))?;

    Ok(())
}

#[tauri::command]
pub fn open_in_terminal(
    path: String,
    terminal: String,
    custom_path: Option<String>,
) -> Result<(), AppError> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(AppError::Config(format!("Path does not exist: {path}")));
    }

    let (cmd, args) = terminal_command(&terminal, &path, custom_path.as_deref())?;

    Command::new(&cmd)
        .args(&args)
        .spawn()
        .map_err(|e| AppError::Config(format!("Failed to open terminal ({cmd}): {e}")))?;

    Ok(())
}
```

- [ ] **Step 2: Register the module in mod.rs**

In `src-tauri/src/commands/mod.rs`, add:

```rust
pub mod external_tools;
```

- [ ] **Step 3: Register commands in lib.rs**

In `src-tauri/src/lib.rs`, add the import at line 16:

```rust
use commands::{app_config, branch, checks, config, diff, github, github_auth, linear, pr_detail, pty, repo, session, worktree, external_tools};
```

Add the commands to the `invoke_handler` list, after the session commands:

```rust
            // External Tools
            external_tools::open_in_editor,
            external_tools::open_in_terminal,
```

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && cargo check -p alfredo`
Expected: compiles with no errors

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/external_tools.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add Rust commands for opening editor and terminal"
```

---

### Task 4: Add Editor/Terminal buttons to SettingsStatusBar

**Files:**
- Modify: `src/components/terminal/SettingsStatusBar.tsx`
- Modify: `src/components/terminal/TerminalView.tsx:230-236` (pass worktree path to SettingsStatusBar)

- [ ] **Step 1: Pass worktree path to SettingsStatusBar**

In `src/components/terminal/TerminalView.tsx`, update the SettingsStatusBar usage (around line 232) to pass the worktree path:

```tsx
<SettingsStatusBar
  branch={worktree.branch ?? ""}
  worktreePath={worktree.path ?? ""}
  onRestartSession={handleRestartSession}
/>
```

- [ ] **Step 2: Add external tool buttons to SettingsStatusBar**

In `src/components/terminal/SettingsStatusBar.tsx`:

Add imports at the top:

```typescript
import { RotateCcw, SquarePen, TerminalSquare } from "lucide-react";
import { openInEditor, openInTerminal, getAppConfig } from "../../api";
```

(Replace the existing `RotateCcw` import from lucide-react with the expanded one.)

Update the interface to accept `worktreePath`:

```typescript
interface SettingsStatusBarProps {
  branch: string;
  worktreePath: string;
  onRestartSession: () => void;
}
```

Update the function signature:

```typescript
function SettingsStatusBar({ branch, worktreePath, onRestartSession }: SettingsStatusBarProps) {
```

Add click handlers inside the component (after the `handleRestart` callback):

```typescript
const handleOpenEditor = useCallback(async () => {
  if (!worktreePath) return;
  try {
    const appCfg = await getAppConfig();
    await openInEditor(worktreePath, appCfg.preferredEditor, appCfg.customEditorPath ?? undefined);
  } catch (e) {
    console.error("Failed to open editor:", e);
  }
}, [worktreePath]);

const handleOpenTerminal = useCallback(async () => {
  if (!worktreePath) return;
  try {
    const appCfg = await getAppConfig();
    await openInTerminal(worktreePath, appCfg.preferredTerminal, appCfg.customTerminalPath ?? undefined);
  } catch (e) {
    console.error("Failed to open terminal:", e);
  }
}, [worktreePath]);
```

Add the buttons to the JSX, in the right side of the bar. Replace the existing return block with:

```tsx
return (
  <div className="flex items-center justify-between px-2 py-1 border-t border-border-default flex-shrink-0">
    <div className="flex items-center gap-1.5">
      <SettingsChip
        label={displayLabel(EFFORT_OPTIONS, resolved.effort, "Effort")}
        options={EFFORT_OPTIONS}
        value={resolved.effort ?? ""}
        isOpen={openDropdown === "effort"}
        onToggle={() => toggleDropdown("effort")}
        onChange={(v) => handleChange("effort", v)}
      />
      <SettingsChip
        label={displayLabel(PERMISSION_OPTIONS, resolved.permissionMode, "Permissions")}
        options={PERMISSION_OPTIONS}
        value={resolved.permissionMode ?? ""}
        isOpen={openDropdown === "permissionMode"}
        onToggle={() => toggleDropdown("permissionMode")}
        onChange={(v) => handleChange("permissionMode", v)}
      />
      <SettingsChip
        label={displayLabel(OUTPUT_OPTIONS, resolved.outputStyle, "Output")}
        options={OUTPUT_OPTIONS}
        value={resolved.outputStyle ?? ""}
        isOpen={openDropdown === "outputStyle"}
        onToggle={() => toggleDropdown("outputStyle")}
        onChange={(v) => handleChange("outputStyle", v)}
      />
    </div>

    <div className="flex items-center gap-2">
      {hasChanges && (
        <>
          <span className="text-xs text-text-tertiary">Settings changed</span>
          <Button size="sm" variant="secondary" onClick={handleRestart}>
            <RotateCcw size={10} />
            Restart
          </Button>
        </>
      )}
      <button
        type="button"
        onClick={handleOpenEditor}
        className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
        title="Open in editor"
      >
        <SquarePen size={13} />
        Editor
      </button>
      <button
        type="button"
        onClick={handleOpenTerminal}
        className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
        title="Open in terminal"
      >
        <TerminalSquare size={13} />
        Terminal
      </button>
    </div>
  </div>
);
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/components/terminal/SettingsStatusBar.tsx src/components/terminal/TerminalView.tsx
git commit -m "feat: add editor/terminal buttons to settings status bar"
```

---

### Task 5: Add context menu items to sidebar worktree cards

**Files:**
- Modify: `src/components/sidebar/AgentItem.tsx:271-288`

- [ ] **Step 1: Add imports and handlers**

In `src/components/sidebar/AgentItem.tsx`, add imports at the top:

```typescript
import { Archive, Trash2, CircleCheck, CircleX, Eye, MessageCircle, AlertTriangle, Clock, SquarePen, TerminalSquare } from "lucide-react";
import { openInEditor, openInTerminal, getAppConfig } from "../../api";
```

(Expand the existing lucide-react import to include `SquarePen` and `TerminalSquare`.)

- [ ] **Step 2: Add click handlers in AgentItem component**

Inside the `AgentItem` function component (after the `useDraggable` call around line 228), add:

```typescript
const handleOpenEditor = async () => {
  try {
    const appCfg = await getAppConfig();
    await openInEditor(worktree.path, appCfg.preferredEditor, appCfg.customEditorPath ?? undefined);
  } catch (e) {
    console.error("Failed to open editor:", e);
  }
};

const handleOpenTerminal = async () => {
  try {
    const appCfg = await getAppConfig();
    await openInTerminal(worktree.path, appCfg.preferredTerminal, appCfg.customTerminalPath ?? undefined);
  } catch (e) {
    console.error("Failed to open terminal:", e);
  }
};
```

- [ ] **Step 3: Add context menu items**

In `AgentItem`, update the `<ContextMenuContent>` block (line 271) to add the editor/terminal items before the existing items:

```tsx
<ContextMenuContent>
  <ContextMenuItem onSelect={handleOpenEditor}>
    <SquarePen className="h-4 w-4" />
    Open in Editor
  </ContextMenuItem>
  <ContextMenuItem onSelect={handleOpenTerminal}>
    <TerminalSquare className="h-4 w-4" />
    Open in Terminal
  </ContextMenuItem>
  <ContextMenuSeparator />
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
```

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/AgentItem.tsx
git commit -m "feat: add editor/terminal to sidebar context menu"
```

---

### Task 6: Add External Tools settings UI

**Files:**
- Create: `src/components/settings/ExternalToolsSettings.tsx`
- Modify: `src/components/settings/GlobalSettingsDialog.tsx`

- [ ] **Step 1: Create the ExternalToolsSettings component**

Create `src/components/settings/ExternalToolsSettings.tsx`:

```tsx
import type { GlobalAppConfig } from "../../types";

const EDITOR_OPTIONS = [
  { value: "vscode", label: "VS Code" },
  { value: "cursor", label: "Cursor" },
  { value: "zed", label: "Zed" },
  { value: "vim", label: "Vim / Neovim" },
  { value: "custom", label: "Custom..." },
];

const TERMINAL_OPTIONS = [
  { value: "iterm", label: "iTerm2" },
  { value: "terminal", label: "Terminal.app" },
  { value: "warp", label: "Warp" },
  { value: "ghostty", label: "Ghostty" },
  { value: "custom", label: "Custom..." },
];

interface ExternalToolsSettingsProps {
  config: GlobalAppConfig;
  onChange: (patch: Partial<GlobalAppConfig>) => void;
}

function ExternalToolsSettings({ config, onChange }: ExternalToolsSettingsProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-1">External Tools</h3>
        <p className="text-xs text-text-tertiary mb-4">
          Choose which editor and terminal to open worktrees in.
        </p>
      </div>

      {/* Editor */}
      <div className="space-y-2">
        <label className="text-sm text-text-secondary" htmlFor="editor-select">
          Editor
        </label>
        <select
          id="editor-select"
          value={config.preferredEditor ?? "vscode"}
          onChange={(e) => onChange({ preferredEditor: e.target.value })}
          className="w-full rounded-md border border-border-default bg-bg-secondary px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
        >
          {EDITOR_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {config.preferredEditor === "custom" && (
          <input
            type="text"
            placeholder="e.g. /usr/local/bin/subl"
            value={config.customEditorPath ?? ""}
            onChange={(e) => onChange({ customEditorPath: e.target.value || null })}
            className="w-full rounded-md border border-border-default bg-bg-secondary px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent-primary"
          />
        )}
      </div>

      {/* Terminal */}
      <div className="space-y-2">
        <label className="text-sm text-text-secondary" htmlFor="terminal-select">
          Terminal
        </label>
        <select
          id="terminal-select"
          value={config.preferredTerminal ?? "iterm"}
          onChange={(e) => onChange({ preferredTerminal: e.target.value })}
          className="w-full rounded-md border border-border-default bg-bg-secondary px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
        >
          {TERMINAL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {config.preferredTerminal === "custom" && (
          <input
            type="text"
            placeholder="e.g. /Applications/Alacritty.app"
            value={config.customTerminalPath ?? ""}
            onChange={(e) => onChange({ customTerminalPath: e.target.value || null })}
            className="w-full rounded-md border border-border-default bg-bg-secondary px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent-primary"
          />
        )}
      </div>
    </div>
  );
}

export { ExternalToolsSettings };
```

- [ ] **Step 2: Add "External Tools" tab to GlobalSettingsDialog**

In `src/components/settings/GlobalSettingsDialog.tsx`:

Add the import:

```typescript
import { ExternalToolsSettings } from "./ExternalToolsSettings";
```

Add `"tools"` to the `GlobalTab` type:

```typescript
type GlobalTab =
  | "appearance"
  | "terminal"
  | "agent"
  | "notifications"
  | "integrations"
  | "shortcuts"
  | "tools";
```

Add the tab entry to the `TABS` array:

```typescript
const TABS: { id: GlobalTab; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "terminal", label: "Terminal" },
  { id: "agent", label: "Agent" },
  { id: "notifications", label: "Notifications" },
  { id: "integrations", label: "Integrations" },
  { id: "tools", label: "External Tools" },
  { id: "shortcuts", label: "Shortcuts" },
];
```

- [ ] **Step 3: Add the tab content rendering**

Find the tab content rendering section in `GlobalSettingsDialog` (the area with `{tab === "appearance" && ...}` blocks). Add a new block for the tools tab:

```tsx
{tab === "tools" && appConfig && (
  <ExternalToolsSettings
    config={appConfig}
    onChange={(patch) => {
      setAppConfig((prev) => prev ? { ...prev, ...patch } : prev);
      setDirty(true);
    }}
  />
)}
```

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/ExternalToolsSettings.tsx src/components/settings/GlobalSettingsDialog.tsx
git commit -m "feat: add External Tools settings tab for editor/terminal preferences"
```

---

### Task 7: Manual testing and visual verification

**Files:** None (testing only)

- [ ] **Step 1: Build and run the app**

Run: `cd /Users/chloe/dev/alfredo && npm run tauri dev`

- [ ] **Step 2: Verify status bar buttons**

1. Select a worktree in the sidebar
2. Look at the bottom of the terminal area — the SettingsStatusBar should show "Editor" and "Terminal" buttons on the right side
3. Click "Editor" — VS Code should open with the worktree directory
4. Click "Terminal" — iTerm should open with the worktree directory

- [ ] **Step 3: Verify sidebar context menu**

1. Right-click a worktree in the sidebar
2. "Open in Editor" and "Open in Terminal" should appear at the top of the context menu
3. Click "Open in Editor" — VS Code should open
4. Click "Open in Terminal" — iTerm should open

- [ ] **Step 4: Verify settings UI**

1. Open Settings (gear icon in sidebar header)
2. Click the "External Tools" tab
3. Verify Editor and Terminal dropdowns are visible with correct options
4. Change editor to "Cursor", save settings
5. Click "Editor" in the status bar — Cursor should open instead of VS Code
6. Select "Custom..." — verify the text input appears
7. Change back to VS Code, save

- [ ] **Step 5: Visual verify — design reference**

Compare the status bar buttons against the design mockup at `designs/open-in-editor-terminal.html`. The buttons should be plain icon + text, `text-text-tertiary` by default, brightening on hover. No chip/background styling.

# Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the sidebar into a dense, scannable worktree dashboard with gradient-bleed attention states, multi-repo selection, and richer information density.

**Architecture:** Pure frontend redesign of the sidebar component tree. New CSS utilities for gradient bleed/glow effects. Data layer changes: add `lastActivityAt` to Worktree, change `activeRepo` to `selectedRepos[]` in GlobalAppConfig (Rust + TypeScript), add `displayName` and `repoColors` to config. New components: RepoSelector (dropdown), RepoTag, RelativeTime.

**Tech Stack:** React 19, Tailwind CSS v4, Zustand, Tauri v2 (Rust backend), Radix UI (Popover), Framer Motion, Lucide icons

**Mockups:** `designs/sidebar-redesign-attention.html`, `designs/sidebar-redesign-multi-repo.html`, `designs/sidebar-redesign-repo-selector.html`

---

## Section 1: CSS Foundation — Sidebar Background, Gradient Bleed & Dot Glow

### Task 1: Add sidebar CSS utilities to globals.css

**Files:**
- Modify: `src/styles/globals.css`

- [ ] **Step 1: Add sidebar background class**

Add after the `.text-2xs` block at the end of `src/styles/globals.css`:

```css
/* ── Sidebar visual system ───────────────────── */

.sidebar-bg {
  background: linear-gradient(180deg, var(--bg-sidebar) 0%, color-mix(in srgb, var(--bg-sidebar) 85%, black) 100%);
  box-shadow: 1px 0 20px -4px rgba(0, 0, 0, 0.6);
  position: relative;
}

.sidebar-bg::after {
  content: '';
  position: absolute;
  inset: 0;
  opacity: 0.012;
  background: repeating-conic-gradient(#fff 0% 25%, transparent 0% 50%) 0 0 / 2px 2px;
  pointer-events: none;
  z-index: 0;
}

.sidebar-bg > * {
  position: relative;
  z-index: 1;
}
```

- [ ] **Step 2: Add gradient bleed classes for attention states**

Append to `src/styles/globals.css`:

```css
/* Attention: gradient bleed from left border */
.bleed-waiting {
  border-left: 3px solid var(--status-waiting);
  background: linear-gradient(90deg, color-mix(in srgb, var(--status-waiting) 6%, transparent) 0%, transparent 60%);
}
.bleed-done {
  border-left: 3px solid var(--accent-primary);
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent-primary) 6%, transparent) 0%, transparent 60%);
}
.bleed-error {
  border-left: 3px solid var(--status-error);
  background: linear-gradient(90deg, color-mix(in srgb, var(--status-error) 6%, transparent) 0%, transparent 60%);
}

/* Light theme: higher opacity for bleed visibility */
html[data-theme="light"] .bleed-waiting {
  background: linear-gradient(90deg, color-mix(in srgb, var(--status-waiting) 10%, transparent) 0%, transparent 60%);
}
html[data-theme="light"] .bleed-done {
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent-primary) 10%, transparent) 0%, transparent 60%);
}
html[data-theme="light"] .bleed-error {
  background: linear-gradient(90deg, color-mix(in srgb, var(--status-error) 10%, transparent) 0%, transparent 60%);
}
```

- [ ] **Step 3: Add status dot glow classes**

Append to `src/styles/globals.css`:

```css
/* Status dot glow — color-matched ambient light */
.dot-glow-waiting { box-shadow: 0 0 8px 2px color-mix(in srgb, var(--status-waiting) 45%, transparent); }
.dot-glow-done    { box-shadow: 0 0 8px 2px color-mix(in srgb, var(--accent-primary) 40%, transparent); }
.dot-glow-error   { box-shadow: 0 0 8px 2px color-mix(in srgb, var(--status-error) 45%, transparent); }
.dot-glow-amber   { box-shadow: 0 0 8px 2px color-mix(in srgb, var(--status-busy) 35%, transparent); }

/* Light theme: reduce glow intensity */
html[data-theme="light"] .dot-glow-waiting { box-shadow: 0 0 6px 1px color-mix(in srgb, var(--status-waiting) 35%, transparent); }
html[data-theme="light"] .dot-glow-done    { box-shadow: 0 0 6px 1px color-mix(in srgb, var(--accent-primary) 30%, transparent); }
html[data-theme="light"] .dot-glow-error   { box-shadow: 0 0 6px 1px color-mix(in srgb, var(--status-error) 35%, transparent); }
html[data-theme="light"] .dot-glow-amber   { box-shadow: 0 0 6px 1px color-mix(in srgb, var(--status-busy) 25%, transparent); }
```

- [ ] **Step 4: Verify build passes**

Run: `npm run build 2>&1 | tail -3`
Expected: `✓ built in` with no CSS errors

- [ ] **Step 5: Commit**

```bash
git add src/styles/globals.css
git commit -m "style: add sidebar gradient bleed and dot glow CSS utilities"
```

### Visual Verify
Open the app and confirm the sidebar background gradient is visible and the grain texture is barely perceptible. Test with at least warm-dark and light themes.

---

## Section 2: Data Layer — lastActivityAt, Multi-Repo Selection, Workspace Name

### Task 2: Add lastActivityAt to Worktree type and populate it

**Files:**
- Modify: `src/types.ts`
- Modify: `src/stores/workspaceStore.ts`

- [ ] **Step 1: Add lastActivityAt to Worktree interface**

In `src/types.ts`, add to the `Worktree` interface after the `archived` field:

```typescript
  lastActivityAt?: number; // unix timestamp ms, updated on status/diff/pr changes
```

- [ ] **Step 2: Update workspaceStore to set lastActivityAt on state changes**

In `src/stores/workspaceStore.ts`, find the `setWorktrees` action (or wherever worktrees are updated from the backend). When worktree data arrives, compare each worktree's `agentStatus`, `additions`, `deletions`, and `prStatus` against the previous state. If any changed, set `lastActivityAt` to `Date.now()`.

Find the section where worktrees are set (look for `setWorktrees` or the equivalent). Add a helper before the store definition:

```typescript
function withActivityTimestamps(
  incoming: Worktree[],
  existing: Worktree[],
): Worktree[] {
  const existingMap = new Map(existing.map((w) => [w.id, w]));
  return incoming.map((wt) => {
    const prev = existingMap.get(wt.id);
    if (!prev) return { ...wt, lastActivityAt: Date.now() };
    const changed =
      prev.agentStatus !== wt.agentStatus ||
      prev.additions !== wt.additions ||
      prev.deletions !== wt.deletions ||
      prev.prStatus?.number !== wt.prStatus?.number ||
      prev.prStatus?.state !== wt.prStatus?.state;
    return {
      ...wt,
      lastActivityAt: changed ? Date.now() : (prev.lastActivityAt ?? Date.now()),
    };
  });
}
```

Then wrap the incoming worktrees through this function wherever `worktrees` state is set.

- [ ] **Step 3: Verify build passes**

Run: `npx tsc --noEmit && echo "OK"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/stores/workspaceStore.ts
git commit -m "feat: track lastActivityAt on worktrees for relative timestamps"
```

### Task 3: Add selectedRepos to GlobalAppConfig (Rust backend)

**Files:**
- Modify: `src-tauri/src/types.rs`
- Modify: `src-tauri/src/app_config_manager.rs`
- Modify: `src-tauri/src/commands/app_config.rs`

- [ ] **Step 1: Add selected_repos and display_name to GlobalAppConfig struct**

In `src-tauri/src/types.rs`, add to the `GlobalAppConfig` struct:

```rust
    #[serde(default)]
    pub selected_repos: Vec<String>,       // repo paths currently visible
    #[serde(default)]
    pub display_name: Option<String>,      // custom workspace name
    #[serde(default)]
    pub repo_colors: HashMap<String, String>, // repo path → color token
```

Add `use std::collections::HashMap;` at the top if not already imported.

- [ ] **Step 2: Add a Tauri command to toggle repo selection**

In `src-tauri/src/commands/app_config.rs`, add:

```rust
#[tauri::command]
pub fn set_selected_repos(app: AppHandle, paths: Vec<String>) -> Result<GlobalAppConfig, String> {
    let mut config = app_config_manager::load(&app).map_err(|e| e.to_string())?;
    config.selected_repos = paths;
    app_config_manager::save(&app, &config).map_err(|e| e.to_string())?;
    Ok(config)
}

#[tauri::command]
pub fn set_display_name(app: AppHandle, name: Option<String>) -> Result<GlobalAppConfig, String> {
    let mut config = app_config_manager::load(&app).map_err(|e| e.to_string())?;
    config.display_name = name;
    app_config_manager::save(&app, &config).map_err(|e| e.to_string())?;
    Ok(config)
}

#[tauri::command]
pub fn set_repo_color(app: AppHandle, repo_path: String, color: String) -> Result<GlobalAppConfig, String> {
    let mut config = app_config_manager::load(&app).map_err(|e| e.to_string())?;
    config.repo_colors.insert(repo_path, color);
    app_config_manager::save(&app, &config).map_err(|e| e.to_string())?;
    Ok(config)
}
```

- [ ] **Step 3: Register the new commands in lib.rs**

In `src-tauri/src/lib.rs`, add the new commands to the `.invoke_handler(tauri::generate_handler![...])` list:

```rust
app_config::set_selected_repos,
app_config::set_display_name,
app_config::set_repo_color,
```

- [ ] **Step 4: Auto-populate selected_repos on load**

In `src-tauri/src/app_config_manager.rs`, in the `load()` function, after loading the config, add migration logic: if `selected_repos` is empty but `active_repo` is set, initialize `selected_repos` with `[active_repo]`:

```rust
// After loading config:
if config.selected_repos.is_empty() {
    if let Some(ref active) = config.active_repo {
        config.selected_repos = vec![active.clone()];
    }
}
```

- [ ] **Step 5: Verify Rust compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: `Finished` with no errors

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/types.rs src-tauri/src/app_config_manager.rs src-tauri/src/commands/app_config.rs src-tauri/src/lib.rs
git commit -m "feat(rust): add selectedRepos, displayName, repoColors to GlobalAppConfig"
```

### Task 4: Update TypeScript types and API layer for multi-repo

**Files:**
- Modify: `src/types.ts`
- Modify: `src/api.ts`
- Modify: `src/hooks/useAppConfig.ts`

- [ ] **Step 1: Update GlobalAppConfig TypeScript type**

In `src/types.ts`, update the `GlobalAppConfig` interface:

```typescript
export interface GlobalAppConfig {
  repos: RepoEntry[];
  activeRepo: string | null;        // kept for backwards compat
  selectedRepos: string[];           // repo paths currently visible
  displayName: string | null;        // custom workspace name
  repoColors: Record<string, string>; // repo path → color token
  theme: string | null;
  notifications: NotificationConfig | null;
}
```

- [ ] **Step 2: Add API functions for new Tauri commands**

In `src/api.ts`, add:

```typescript
export async function setSelectedRepos(paths: string[]): Promise<GlobalAppConfig> {
  return invoke<GlobalAppConfig>("set_selected_repos", { paths });
}

export async function setDisplayName(name: string | null): Promise<GlobalAppConfig> {
  return invoke<GlobalAppConfig>("set_display_name", { name });
}

export async function setRepoColor(repoPath: string, color: string): Promise<GlobalAppConfig> {
  return invoke<GlobalAppConfig>("set_repo_color", { repoPath, color });
}
```

- [ ] **Step 3: Update useAppConfig hook**

In `src/hooks/useAppConfig.ts`, add methods for the new capabilities:

```typescript
// Add to the returned object:
const toggleRepo = useCallback(async (path: string) => {
  if (!config) return;
  const current = config.selectedRepos ?? [];
  const next = current.includes(path)
    ? current.filter((p) => p !== path)
    : [...current, path];
  // Don't allow deselecting all repos
  if (next.length === 0) return;
  const updated = await setSelectedReposApi(next);
  setConfig(updated);
}, [config]);

const setWorkspaceName = useCallback(async (name: string | null) => {
  const updated = await setDisplayNameApi(name);
  setConfig(updated);
}, []);
```

Add `toggleRepo` and `setWorkspaceName` to the return object. Also add `selectedRepos: config?.selectedRepos ?? []` to the return.

- [ ] **Step 4: Verify build passes**

Run: `npx tsc --noEmit && echo "OK"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/api.ts src/hooks/useAppConfig.ts
git commit -m "feat: add multi-repo selection, workspace name, and repo colors to frontend API"
```

### Visual Verify
N/A — data layer only, no visual changes yet.

---

## Section 3: RelativeTime Component

### Task 5: Create RelativeTime component

**Files:**
- Create: `src/components/ui/RelativeTime.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/ui/RelativeTime.tsx`:

```typescript
import { useState, useEffect } from "react";

function formatRelativeTime(timestamp: number | undefined): string {
  if (!timestamp) return "";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

interface RelativeTimeProps {
  timestamp: number | undefined;
  className?: string;
}

function RelativeTime({ timestamp, className }: RelativeTimeProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!timestamp) return;
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, [timestamp]);

  const text = formatRelativeTime(timestamp);
  if (!text) return null;

  return <span className={className}>{text}</span>;
}

export { RelativeTime, formatRelativeTime };
```

- [ ] **Step 2: Export from ui index**

In `src/components/ui/index.ts` (or wherever UI components are exported), add:

```typescript
export { RelativeTime } from "./RelativeTime";
```

- [ ] **Step 3: Verify build passes**

Run: `npx tsc --noEmit && echo "OK"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/RelativeTime.tsx src/components/ui/index.ts
git commit -m "feat: add RelativeTime component for sidebar timestamps"
```

---

## Section 4: RepoSelector Component

### Task 6: Create RepoSelector dropdown component

**Files:**
- Create: `src/components/sidebar/RepoSelector.tsx`

- [ ] **Step 1: Define the repo color palette**

Create `src/components/sidebar/RepoSelector.tsx`:

```typescript
import { useState, useRef, useEffect } from "react";
import { ChevronDown, Plus, Check } from "lucide-react";
import type { RepoEntry } from "../../types";

const REPO_COLOR_PALETTE = [
  { bg: "rgba(147,51,234,0.12)", border: "rgba(147,51,234,0.25)", text: "#a78bfa", id: "purple" },
  { bg: "rgba(96,165,250,0.12)", border: "rgba(96,165,250,0.2)", text: "#60a5fa", id: "blue" },
  { bg: "rgba(74,222,128,0.12)", border: "rgba(74,222,128,0.2)", text: "#4ade80", id: "green" },
  { bg: "rgba(251,191,36,0.12)", border: "rgba(251,191,36,0.2)", text: "#fbbf24", id: "amber" },
  { bg: "rgba(244,114,182,0.12)", border: "rgba(244,114,182,0.2)", text: "#f472b6", id: "pink" },
  { bg: "rgba(34,211,238,0.12)", border: "rgba(34,211,238,0.2)", text: "#22d3ee", id: "cyan" },
];

function getRepoColor(index: number) {
  return REPO_COLOR_PALETTE[index % REPO_COLOR_PALETTE.length];
}

function repoDisplayName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function repoAbbrev(path: string): string {
  const name = repoDisplayName(path);
  // If name is short enough, use it as-is
  if (name.length <= 14) return name;
  // Otherwise abbreviate: take first and last word
  const words = name.split(/[_-]/);
  if (words.length <= 1) return name.slice(0, 12) + "…";
  return words[0] + "_" + words[words.length - 1];
}
```

- [ ] **Step 2: Build the RepoSelector component**

Continue in the same file, add the component:

```typescript
interface RepoSelectorProps {
  repos: RepoEntry[];
  selectedRepos: string[];
  repoColors: Record<string, string>;
  onToggleRepo: (path: string) => void;
  onAddRepo: () => void;
  onRemoveRepo: (path: string) => void;
  worktreeCountByRepo: Record<string, number>;
}

function RepoSelector({
  repos,
  selectedRepos,
  repoColors,
  onToggleRepo,
  onAddRepo,
  onRemoveRepo,
  worktreeCountByRepo,
}: RepoSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function getColorForRepo(path: string) {
    const colorId = repoColors[path];
    const found = REPO_COLOR_PALETTE.find((c) => c.id === colorId);
    if (found) return found;
    // Fallback: assign by index
    const idx = repos.findIndex((r) => r.path === path);
    return getRepoColor(idx >= 0 ? idx : 0);
  }

  // Single repo: simple display
  if (repos.length <= 1) return null;

  return (
    <div ref={ref} className="relative px-3.5 py-2">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 rounded-[var(--radius-md)] border border-border-subtle bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-colors cursor-pointer"
      >
        <span className="flex gap-1 flex-1 flex-wrap items-center">
          {selectedRepos.length === 1 ? (
            <span className="text-xs text-text-secondary font-medium">
              {repoDisplayName(selectedRepos[0])}
            </span>
          ) : (
            selectedRepos.map((path) => {
              const color = getColorForRepo(path);
              return (
                <span
                  key={path}
                  className="text-[11px] font-medium px-1.5 py-px rounded-[3px]"
                  style={{
                    background: color.bg,
                    color: color.text,
                  }}
                >
                  {repoAbbrev(path)}
                </span>
              );
            })
          )}
        </span>
        {selectedRepos.length === 1 && (
          <span className="text-2xs text-text-tertiary">
            {selectedRepos.length} of {repos.length}
          </span>
        )}
        <ChevronDown
          className={[
            "h-3 w-3 text-text-tertiary transition-transform duration-150",
            open ? "rotate-180" : "",
          ].join(" ")}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-3.5 right-3.5 top-full mt-1 z-50 rounded-[var(--radius-md)] border border-border-default bg-bg-elevated shadow-lg overflow-hidden">
          {repos.map((repo) => {
            const isSelected = selectedRepos.includes(repo.path);
            const color = getColorForRepo(repo.path);
            const count = worktreeCountByRepo[repo.path] ?? 0;
            return (
              <button
                key={repo.path}
                type="button"
                onClick={() => onToggleRepo(repo.path)}
                className={[
                  "flex items-center gap-2 w-full px-2.5 py-1.5 text-left cursor-pointer transition-colors",
                  isSelected ? "bg-[rgba(255,255,255,0.03)]" : "hover:bg-bg-hover",
                ].join(" ")}
              >
                <span
                  className="w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center text-[9px] flex-shrink-0"
                  style={{
                    borderColor: isSelected ? color.border : "var(--border-default)",
                    background: isSelected ? color.bg : "transparent",
                    color: isSelected ? color.text : "transparent",
                  }}
                >
                  {isSelected ? "✓" : ""}
                </span>
                <span className="text-xs text-text-primary font-medium flex-1 truncate">
                  {repoDisplayName(repo.path)}
                </span>
                <span className="text-2xs text-text-tertiary flex-shrink-0">
                  {count} worktree{count !== 1 ? "s" : ""}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => { setOpen(false); onAddRepo(); }}
            className="flex items-center gap-2 w-full px-2.5 py-1.5 border-t border-border-subtle text-xs text-text-tertiary hover:text-text-secondary cursor-pointer transition-colors"
          >
            <Plus className="h-3 w-3" />
            Add repository
          </button>
        </div>
      )}
    </div>
  );
}

export { RepoSelector, REPO_COLOR_PALETTE, getRepoColor, repoDisplayName, repoAbbrev };
```

- [ ] **Step 3: Verify build passes**

Run: `npx tsc --noEmit && echo "OK"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar/RepoSelector.tsx
git commit -m "feat: add RepoSelector multi-select dropdown component"
```

---

## Section 5: RepoTag Component

### Task 7: Create RepoTag component

**Files:**
- Create: `src/components/sidebar/RepoTag.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/sidebar/RepoTag.tsx`:

```typescript
import { REPO_COLOR_PALETTE, repoAbbrev } from "./RepoSelector";

interface RepoTagProps {
  repoPath: string;
  repoColors: Record<string, string>;
  repoIndex: number;
  visible: boolean;
}

function RepoTag({ repoPath, repoColors, repoIndex, visible }: RepoTagProps) {
  if (!visible) return null;

  const colorId = repoColors[repoPath];
  const color = REPO_COLOR_PALETTE.find((c) => c.id === colorId)
    ?? REPO_COLOR_PALETTE[repoIndex % REPO_COLOR_PALETTE.length];

  // Short abbreviation for the tag
  const name = repoAbbrev(repoPath);
  const shortName = name.length > 6
    ? name.split(/[_-]/)[0]?.slice(0, 4) ?? name.slice(0, 4)
    : name;

  return (
    <span
      className="text-[9px] font-medium px-1.5 py-px rounded-[3px] flex-shrink-0"
      style={{
        background: color.bg,
        color: color.text,
      }}
    >
      {shortName}
    </span>
  );
}

export { RepoTag };
```

- [ ] **Step 2: Verify build passes**

Run: `npx tsc --noEmit && echo "OK"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/RepoTag.tsx
git commit -m "feat: add RepoTag colored label component"
```

---

## Section 6: AgentItem Redesign — Flat Rows, Gradient Bleed, Richer Info

### Task 8: Redesign AgentItem component

**Files:**
- Modify: `src/components/sidebar/AgentItem.tsx`

This is the largest change. The AgentItem needs: flat rows (no rounded corners, no margin), gradient bleed for attention states, glowing dots, timestamps, repo tags, abbreviated diff stats, and a cleaner info layout.

- [ ] **Step 1: Add attention helpers and diff formatter**

At the top of `src/components/sidebar/AgentItem.tsx`, after the existing imports, add:

```typescript
import { RelativeTime } from "../ui/RelativeTime";
import { RepoTag } from "./RepoTag";

// Attention states: these get gradient bleed treatment
const ATTENTION_STATES = new Set(["waitingForInput", "done", "error"]);

function isAttentionState(status: string): boolean {
  return ATTENTION_STATES.has(status);
}

function getBleedClass(status: string): string {
  switch (status) {
    case "waitingForInput": return "bleed-waiting";
    case "done": return "bleed-done";
    case "error": return "bleed-error";
    default: return "border-l-[3px] border-l-transparent";
  }
}

function getDotGlowClass(status: string): string {
  switch (status) {
    case "waitingForInput": return "dot-glow-waiting";
    case "done": return "dot-glow-done";
    case "error": return "dot-glow-error";
    case "disconnected":
    case "stale": return "dot-glow-amber";
    default: return "";
  }
}

function formatDiffStat(n: number | null): string | null {
  if (n == null || n === 0) return null;
  if (n >= 100_000) return `${Math.round(n / 1000)}k`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
```

- [ ] **Step 2: Update the AgentItem props to accept new data**

Update the `AgentItemProps` interface:

```typescript
interface AgentItemProps {
  worktree: Worktree;
  isSelected: boolean;
  onClick: () => void;
  onDelete?: (worktreeId: string) => void;
  onArchive?: (worktreeId: string) => void;
  repoPath?: string;
  repoColors?: Record<string, string>;
  repoIndex?: number;
  showRepoTag?: boolean;
}
```

- [ ] **Step 3: Rewrite the button className and layout**

Replace the button's `className` array and inner layout. The button should use:

```typescript
className={[
  "w-full text-left py-2 px-3.5 flex items-start gap-2",
  "transition-all duration-[var(--transition-fast)]",
  isDragging ? "opacity-50 cursor-grabbing" : "cursor-grab",
  getBleedClass(effectiveStatus),
  isSelected && !isAttentionState(effectiveStatus)
    ? "bg-[rgba(255,255,255,0.05)]"
    : "",
  isSelected && isAttentionState(effectiveStatus)
    ? "brightness-110"
    : "",
  !isSelected && !isAttentionState(effectiveStatus)
    ? "hover:bg-[rgba(255,255,255,0.035)]"
    : "",
].join(" ")}
```

- [ ] **Step 4: Update the status dot**

Replace the status dot span:

```tsx
<span
  className={[
    "mt-1 h-2 w-2 rounded-full flex-shrink-0",
    getDotColor(effectiveStatus),
    getDotGlowClass(effectiveStatus),
    shouldPulse ? "animate-pulse-dot" : "",
  ].join(" ")}
/>
```

- [ ] **Step 5: Update the info layout to match spec**

Replace the inner `<div className="flex-1 min-w-0">` content with the new 3-line layout:

```tsx
<div className="flex-1 min-w-0">
  {/* Line 1: branch name, PR number, server indicator, timestamp */}
  <div className="flex items-center gap-2">
    <span className={[
      "text-xs truncate",
      isAttentionState(effectiveStatus)
        ? "font-semibold text-text-primary"
        : "font-medium text-text-primary",
    ].join(" ")}>
      {worktree.name}
    </span>
    {worktree.prStatus && (
      <span className="text-2xs text-text-tertiary flex-shrink-0">#{worktree.prStatus.number}</span>
    )}
    {isServerRunning && <ServerIndicator />}
    <RelativeTime
      timestamp={worktree.lastActivityAt}
      className="text-[9px] text-text-tertiary ml-auto flex-shrink-0 tabular-nums"
    />
  </div>
  {/* Line 2: PR title (only if PR exists) */}
  {worktree.prStatus && (
    <div className="text-[11px] text-text-tertiary truncate mt-0.5">
      {worktree.prStatus.title}
    </div>
  )}
  {/* Line 3: status text, diff stats, PR checks, repo tag */}
  <div className="flex items-center gap-2 mt-0.5">
    <span className={[
      "text-[11px] truncate",
      effectiveStatus === "waitingForInput"
        ? "text-status-waiting font-medium"
        : effectiveStatus === "done"
          ? "text-accent-primary font-medium"
          : effectiveStatus === "error"
            ? "text-status-error font-medium"
            : "text-text-tertiary",
    ].join(" ")}>
      {getStatusText(effectiveStatus)}
    </span>
    {prSummary?.failingCheckCount != null && prSummary.failingCheckCount > 0 && (
      <span className="text-2xs text-status-error flex-shrink-0">
        {prSummary.failingCheckCount} failing
      </span>
    )}
    <span className="flex items-center gap-1 text-2xs ml-auto flex-shrink-0">
      {(() => {
        const add = formatDiffStat(worktree.additions);
        const del = formatDiffStat(worktree.deletions);
        if (!add && !del) return null;
        return (
          <>
            {add && <span className="text-diff-added">+{add}</span>}
            {del && <span className="text-diff-removed">-{del}</span>}
          </>
        );
      })()}
      {showRepoTag && repoPath && repoColors && repoIndex != null && (
        <RepoTag
          repoPath={repoPath}
          repoColors={repoColors}
          repoIndex={repoIndex}
          visible={showRepoTag}
        />
      )}
    </span>
  </div>
</div>
```

- [ ] **Step 6: Update the component signature to accept new props**

Destructure the new props in the function signature:

```typescript
function AgentItem({
  worktree, isSelected, onClick, onDelete, onArchive,
  repoPath, repoColors, repoIndex = 0, showRepoTag = false,
}: AgentItemProps) {
```

- [ ] **Step 7: Verify build passes**

Run: `npx tsc --noEmit && echo "OK"`
Expected: `OK`

- [ ] **Step 8: Commit**

```bash
git add src/components/sidebar/AgentItem.tsx
git commit -m "feat: redesign AgentItem with flat rows, gradient bleed, and richer info"
```

### Visual Verify
Open the app, look at a worktree in "waiting for input" or "done" state. Confirm the gradient bleed appears from the left edge, the dot glows, and the name is bold. Compare with `designs/sidebar-redesign-attention.html` option C.

---

## Section 7: StatusGroup Redesign — Refined Headers

### Task 9: Update StatusGroup headers

**Files:**
- Modify: `src/components/sidebar/StatusGroup.tsx`

- [ ] **Step 1: Update the group header layout**

Replace the header `<button>` contents to add the gradient separator line and hover transition:

```tsx
<button
  onClick={() => setIsCollapsed((prev) => !prev)}
  className={[
    "flex w-full items-center px-3.5 pt-3 pb-2",
    "cursor-pointer select-none",
    "text-text-tertiary hover:text-text-secondary transition-colors",
  ].join(" ")}
>
  <span className="flex items-center gap-2">
    <Icon className="h-3.5 w-3.5" />
    <span className="text-[11px] font-semibold uppercase tracking-[0.08em]">
      {label}
    </span>
  </span>
  <span className="flex-1 h-px bg-gradient-to-r from-border-subtle to-transparent mx-3" />
  <span className="flex items-center gap-2">
    <span className="text-2xs text-text-tertiary tabular-nums">
      {worktrees.length}
    </span>
    <ChevronRight
      className={[
        "h-3.5 w-3.5 transition-transform duration-150",
        isCollapsed ? "rotate-0" : "rotate-90",
      ].join(" ")}
    />
  </span>
</button>
```

- [ ] **Step 2: Pass new props through to AgentItem**

Update the `AgentItem` usage in the `StatusGroup` to pass through the new props. Add these props to the `StatusGroupProps` interface:

```typescript
interface StatusGroupProps {
  column: KanbanColumn;
  worktrees: Worktree[];
  activeWorktreeId: string | null;
  onSelectWorktree: (id: string) => void;
  onDeleteWorktree?: (id: string) => void;
  onArchiveWorktree?: (id: string) => void;
  forceVisible?: boolean;
  repoColors?: Record<string, string>;
  showRepoTags?: boolean;
  repoIndexMap?: Record<string, number>;
}
```

And pass them to each `AgentItem`:

```tsx
<AgentItem
  key={wt.id}
  worktree={wt}
  isSelected={wt.id === activeWorktreeId}
  onClick={() => onSelectWorktree(wt.id)}
  onDelete={onDeleteWorktree}
  onArchive={onArchiveWorktree}
  repoPath={wt.path}
  repoColors={repoColors}
  repoIndex={repoIndexMap?.[wt.path] ?? 0}
  showRepoTag={showRepoTags ?? false}
/>
```

Note: `wt.path` is the worktree path, but we need the repo path. Since each worktree is loaded per-repo, we'll need to add a `repoPath` field to the Worktree or derive it. For now, we can get this from the Sidebar component which knows which repo each worktree belongs to. The simplest approach: add `repoPath?: string` to the Worktree interface in `src/types.ts` and populate it when loading worktrees.

- [ ] **Step 3: Add repoPath to Worktree type**

In `src/types.ts`, add to the `Worktree` interface:

```typescript
  repoPath?: string; // which repo this worktree belongs to
```

- [ ] **Step 4: Verify build passes**

Run: `npx tsc --noEmit && echo "OK"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/StatusGroup.tsx src/types.ts
git commit -m "feat: redesign StatusGroup headers with gradient line and repo tag passthrough"
```

---

## Section 8: Sidebar Container — Background, RepoSelector, Workspace Name, Multi-Repo Merging

### Task 10: Redesign Sidebar container

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx`

This is the integration task that ties everything together.

- [ ] **Step 1: Replace RepoPills with RepoSelector**

Remove the `RepoPills` import and add:

```typescript
import { RepoSelector, repoDisplayName } from "./RepoSelector";
```

- [ ] **Step 2: Update the Sidebar props**

Update `SidebarProps` to accept multi-repo data:

```typescript
interface SidebarProps {
  hasRepo: boolean;
  repos: RepoEntry[];
  selectedRepos: string[];
  onToggleRepo: (path: string) => void;
  onAddRepo: () => void;
  onRemoveRepo: (path: string) => void;
  activeRepoMode: "worktree" | "branch";
  onEnableWorktrees: () => void;
  displayName: string | null;
  repoColors: Record<string, string>;
}
```

- [ ] **Step 3: Compute multi-repo merged worktree list**

Inside the `Sidebar` function, replace the single-repo worktree logic with multi-repo merging. The worktrees in the store are already loaded for the active repo. For full multi-repo, we need to load worktrees for all selected repos. However, the current architecture loads worktrees per-repo via the lifecycle manager. For now, the simplest approach is:

- When multiple repos are selected, the `activeRepo` in AppShell still determines which repo's worktrees are loaded
- Full multi-repo worktree loading will require AppShell changes to load worktrees for all selected repos

For this task, wire up the RepoSelector UI and show repo tags when multiple repos are selected. The actual multi-repo worktree merging can be a follow-up enhancement since it requires lifecycle manager changes.

Replace the RepoPills section:

```tsx
{repos.length >= 2 && (
  <RepoSelector
    repos={repos}
    selectedRepos={selectedRepos}
    repoColors={repoColors}
    onToggleRepo={onToggleRepo}
    onAddRepo={onAddRepo}
    onRemoveRepo={onRemoveRepo}
    worktreeCountByRepo={Object.fromEntries(
      repos.map((r) => [r.path, r.path === activeRepo ? activeWorktrees.length : 0])
    )}
  />
)}
```

- [ ] **Step 4: Update the sidebar container classes**

Replace `bg-bg-sidebar` with `sidebar-bg`:

```tsx
<div className="flex flex-col w-[260px] h-full sidebar-bg border-r border-border-subtle flex-shrink-0">
```

- [ ] **Step 5: Update the header to use workspace displayName**

```tsx
<span className="text-sm font-semibold tracking-[-0.3px] text-text-primary">
  {displayName || (activeRepo ? formatWorkspaceName(repoNameFromPath(activeRepo)) : "alfredo")}
</span>
```

Add a helper function:

```typescript
function formatWorkspaceName(name: string): string {
  return name
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
```

- [ ] **Step 6: Update the footer button styling**

Replace the "New worktree" button classes:

```tsx
<button
  type="button"
  className="w-full flex items-center justify-center gap-2 h-9 rounded-[var(--radius-md)] border border-dashed border-accent-primary/25 text-accent-primary/70 text-sm font-medium hover:bg-accent-muted hover:border-accent-primary/40 hover:text-accent-primary transition-all cursor-pointer"
  onClick={() => setCreateWorktreeOpen(true)}
>
```

- [ ] **Step 7: Pass repo props through to StatusGroups**

Compute repo index map and pass through:

```typescript
const repoIndexMap = Object.fromEntries(repos.map((r, i) => [r.path, i]));
const showRepoTags = selectedRepos.length > 1;
```

And pass to each `StatusGroup`:

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
  repoColors={repoColors}
  showRepoTags={showRepoTags}
  repoIndexMap={repoIndexMap}
/>
```

- [ ] **Step 8: Verify build passes**

Run: `npx tsc --noEmit && echo "OK"`
Expected: `OK`

- [ ] **Step 9: Commit**

```bash
git add src/components/sidebar/Sidebar.tsx
git commit -m "feat: integrate RepoSelector, workspace name, and sidebar-bg into Sidebar"
```

---

## Section 9: AppShell Integration — Wire Up New Props

### Task 11: Update AppShell to pass new props to Sidebar

**Files:**
- Modify: `src/components/layout/AppShell.tsx`

- [ ] **Step 1: Extract new config values from useAppConfig**

Add `selectedRepos`, `displayName`, `repoColors`, and `toggleRepo` to the destructured values from `useAppConfig()`.

- [ ] **Step 2: Update the Sidebar JSX props**

Replace the current Sidebar props with the new interface:

```tsx
<Sidebar
  hasRepo={!!repoPath}
  repos={repos}
  selectedRepos={selectedRepos.length > 0 ? selectedRepos : (repoPath ? [repoPath] : [])}
  onToggleRepo={toggleRepo}
  onAddRepo={() => { /* existing add repo logic */ }}
  onRemoveRepo={(path: string) => { /* existing remove repo logic */ }}
  activeRepoMode={activeRepoEntry?.mode ?? "worktree"}
  onEnableWorktrees={() => { /* existing enable worktrees logic */ }}
  displayName={displayName}
  repoColors={repoColors ?? {}}
/>
```

- [ ] **Step 3: Auto-assign repo colors when a repo is added**

In the add-repo handler, after successfully adding a repo, assign a color from the palette if one isn't already set:

```typescript
// After addRepo succeeds:
if (!config?.repoColors?.[path]) {
  const usedColors = Object.values(config?.repoColors ?? {});
  const available = REPO_COLOR_PALETTE.find((c) => !usedColors.includes(c.id));
  const color = available?.id ?? REPO_COLOR_PALETTE[repos.length % REPO_COLOR_PALETTE.length].id;
  await setRepoColorApi(path, color);
}
```

Import `REPO_COLOR_PALETTE` from `../sidebar/RepoSelector` and `setRepoColor as setRepoColorApi` from the API.

- [ ] **Step 4: Verify build passes**

Run: `npx tsc --noEmit && echo "OK"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/AppShell.tsx
git commit -m "feat: wire up multi-repo selection and workspace name in AppShell"
```

### Visual Verify
Open the app with multiple repos configured. Confirm the dropdown selector appears, shows colored chips for selected repos, and the dropdown opens with full names and checkboxes. Verify the workspace name in the header shows a formatted name. Compare with `designs/sidebar-redesign-repo-selector.html` option A.

---

## Section 10: ArchiveSection — Match Flat Row Style

### Task 12: Update ArchiveSection to flat rows

**Files:**
- Modify: `src/components/sidebar/ArchiveSection.tsx`

- [ ] **Step 1: Update archived item styling**

Replace the archived item `<div>` class from:
```
"group w-full text-left px-3 py-2 mx-2 rounded-lg mb-1 flex items-center gap-2 bg-[rgba(255,255,255,0.02)]"
```
to:
```
"group w-full text-left px-3.5 py-2 flex items-center gap-2 border-l-[3px] border-l-transparent"
```

- [ ] **Step 2: Update the header padding to match StatusGroup**

Change the header button padding from `px-4` to `px-3.5` and add hover transition:

```
"flex w-full items-center gap-2 px-3.5 pt-3 pb-2 cursor-pointer select-none text-text-tertiary hover:text-text-secondary transition-colors"
```

- [ ] **Step 3: Verify build passes**

Run: `npx tsc --noEmit && echo "OK"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar/ArchiveSection.tsx
git commit -m "style: update ArchiveSection to match flat row sidebar style"
```

---

## Section 11: Update Design Kit

### Task 13: Update kit.css with new sidebar classes

**Files:**
- Modify: `designs/kit.css`

- [ ] **Step 1: Add new sidebar classes to kit.css**

Add to the end of `designs/kit.css`:

```css
/* ══════════════════════════════════════════════════
   SIDEBAR REDESIGN (gradient bleed + flat rows)
   ══════════════════════════════════════════════════ */

.sidebar-bg {
  background: linear-gradient(180deg, var(--bg-sidebar) 0%, color-mix(in srgb, var(--bg-sidebar) 85%, black) 100%);
  box-shadow: 1px 0 20px -4px rgba(0, 0, 0, 0.6);
  position: relative;
}

/* Attention: gradient bleed from left border */
.bleed-waiting {
  border-left: 3px solid var(--status-waiting);
  background: linear-gradient(90deg, color-mix(in srgb, var(--status-waiting) 6%, transparent) 0%, transparent 60%);
}
.bleed-done {
  border-left: 3px solid var(--accent-primary);
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent-primary) 6%, transparent) 0%, transparent 60%);
}
.bleed-error {
  border-left: 3px solid var(--status-error);
  background: linear-gradient(90deg, color-mix(in srgb, var(--status-error) 6%, transparent) 0%, transparent 60%);
}

/* Status dot glow */
.dot-glow-waiting { box-shadow: 0 0 8px 2px color-mix(in srgb, var(--status-waiting) 45%, transparent); }
.dot-glow-done    { box-shadow: 0 0 8px 2px color-mix(in srgb, var(--accent-primary) 40%, transparent); }
.dot-glow-error   { box-shadow: 0 0 8px 2px color-mix(in srgb, var(--status-error) 45%, transparent); }

/* Flat agent item (no rounded corners, no margin) */
.agent-item-flat {
  width: 100%;
  text-align: left;
  padding: 8px 14px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  border-left: 3px solid transparent;
  transition: background var(--transition-fast);
  cursor: grab;
}
.agent-item-flat:hover { background: rgba(255, 255, 255, 0.035); }
.agent-item-flat.selected { background: rgba(255, 255, 255, 0.05); }

/* Agent dot (8px, up from 7px) */
.agent-dot {
  margin-top: 4px;
  height: 8px;
  width: 8px;
}
```

- [ ] **Step 2: Commit**

```bash
git add designs/kit.css
git commit -m "style: add sidebar redesign classes to design kit"
```

---

## Section 12: Final Polish & Cleanup

### Task 14: Remove RepoPills import and clean up

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx`
- Potentially delete: `src/components/sidebar/RepoPills.tsx` (if no longer imported anywhere)

- [ ] **Step 1: Remove RepoPills import from Sidebar.tsx**

If not already done in Task 10, remove:
```typescript
import { RepoPills } from "./RepoPills";
```

- [ ] **Step 2: Check if RepoPills is imported anywhere else**

Run: `grep -r "RepoPills" src/ --include="*.tsx" --include="*.ts"`

If only imported in Sidebar.tsx (now removed), delete `src/components/sidebar/RepoPills.tsx`.

- [ ] **Step 3: Verify full build passes**

Run: `npm run build 2>&1 | tail -5`
Expected: `✓ built in` with no errors

- [ ] **Step 4: Commit**

```bash
git add -u src/components/sidebar/
git commit -m "chore: remove unused RepoPills component"
```

### Visual Verify
Full visual verification against all mockups:
1. Open `designs/sidebar-redesign-attention.html` — compare gradient bleed on waiting/done/error states
2. Open `designs/sidebar-redesign-multi-repo.html` — compare repo tags on items
3. Open `designs/sidebar-redesign-repo-selector.html` — compare dropdown with chips
4. Test with warm-dark, light, synthwave, and catppuccin themes to confirm gradient bleed adapts
5. Check that there are NO corner gaps between adjacent worktree items
6. Confirm timestamps appear on every row and update
7. Confirm server indicator still works
8. Confirm drag-and-drop between columns still works
9. Confirm keyboard navigation (arrow keys, ⌘1-9) still works

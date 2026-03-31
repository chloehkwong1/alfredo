# Onboarding Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the onboarding setup dialog to lead with detected worktrees, carry forward settings for subsequent repos, and add a lightweight orientation banner.

**Architecture:** The existing `RepoSetupDialog` gets a major rewrite to become adaptive — showing a selectable worktree list when worktrees exist, always-expanded integrations, and context-aware CTAs. `AppShell` gains logic to skip `CreateWorktreeDialog` when worktrees are selected. A small `OrientationBanner` component handles first-time tips.

**Tech Stack:** React, TypeScript, Tauri v2 IPC (`invoke`), existing Nightingale UI components (Dialog, Button, Input, Checkbox)

**Spec:** `docs/superpowers/specs/2026-03-31-onboarding-redesign-design.md`
**Mockups:** `docs/superpowers/specs/assets/onboarding-redesign-2026-03-31/`

---

## Task 1: Add `hasSeenOrientation` to GlobalAppConfig

**Files:**
- Modify: `src/types.ts:312-341` (GlobalAppConfig interface)
- Modify: `src-tauri/src/commands/config.rs` (Rust struct — add field)

This task adds the persistence flag for the orientation banner. No UI yet.

- [ ] **Step 1: Add the field to the TypeScript type**

In `src/types.ts`, add to the `GlobalAppConfig` interface after `sidebarCollapsed`:

```typescript
/** Whether the user has dismissed the orientation banner. */
hasSeenOrientation?: boolean;
```

- [ ] **Step 2: Add the field to the Rust struct**

Find the `GlobalAppConfig` struct in the Rust config commands and add:

```rust
#[serde(default)]
pub has_seen_orientation: bool,
```

Use `serde(default)` so existing config files deserialize without error.

- [ ] **Step 3: Verify the app compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src-tauri/src/commands/config.rs
git commit -m "feat(onboarding): add hasSeenOrientation to GlobalAppConfig"
```

---

## Task 2: Update `onConfigured` callback signature

**Files:**
- Modify: `src/components/onboarding/RepoSetupDialog.tsx:16-23` (props interface)
- Modify: `src/components/layout/AppShell.tsx:192-200` (handleRepoConfigured)

Change the callback from `(mode: "worktree" | "branch") => void` to communicate selected worktree IDs.

- [ ] **Step 1: Define the new callback type in RepoSetupDialog**

In `src/components/onboarding/RepoSetupDialog.tsx`, update the `RepoSetupDialogProps` interface:

```typescript
interface RepoSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoPath: string;
  existingGithubToken?: string | null;
  existingLinearKey?: string | null;
  /** Config from most recently added repo, for carry-forward. Null for first repo. */
  previousRepoConfig?: AppConfig | null;
  onConfigured: (result: { selectedWorktreeIds: string[] } | "createNew") => void;
}
```

Add the `AppConfig` import at the top:

```typescript
import type { AppConfig } from "../../types";
```

- [ ] **Step 2: Update handleRepoConfigured in AppShell**

In `src/components/layout/AppShell.tsx`, replace the existing `handleRepoConfigured` (lines 192-200) with:

```typescript
const handleRepoConfigured = useCallback(async (result: { selectedWorktreeIds: string[] } | "createNew") => {
  if (!setupRepoPath) return;
  await updateRepoMode(setupRepoPath, "worktree");
  setSetupDialogOpen(false);
  if (result === "createNew") {
    setCreateDialogOpen(true);
  }
  // If result has selectedWorktreeIds, worktrees will be loaded by useSessionRestore
  // when the repo becomes active — no extra action needed here.
  setSetupRepoPath(null);
}, [setupRepoPath, updateRepoMode]);
```

- [ ] **Step 3: Update both RepoSetupDialog render sites in AppShell**

Find the two `<RepoSetupDialog` JSX blocks in AppShell. Both need the same update — add `previousRepoConfig` prop.

For the **onboarding render** (~line 326), update to:

```tsx
{setupRepoPath && (
  <RepoSetupDialog
    open={setupDialogOpen}
    onOpenChange={setSetupDialogOpen}
    repoPath={setupRepoPath}
    previousRepoConfig={null}
    onConfigured={handleRepoConfigured}
  />
)}
```

For the **normal render** (~line 445), we need to pass the most recent repo's config. This requires loading it. Add state and effect near the other dialog state:

```typescript
const [previousRepoConfig, setPreviousRepoConfig] = useState<AppConfig | null>(null);
```

Add an effect that loads the config when setupRepoPath changes (add after the existing dialog state declarations):

```typescript
useEffect(() => {
  if (!setupRepoPath || repos.length <= 1) {
    setPreviousRepoConfig(null);
    return;
  }
  // Find the most recently added repo that isn't the one being set up
  const otherRepo = repos.find((r) => r.path !== setupRepoPath);
  if (otherRepo) {
    getConfig(otherRepo.path)
      .then(setPreviousRepoConfig)
      .catch(() => setPreviousRepoConfig(null));
  }
}, [setupRepoPath, repos]);
```

Add the `getConfig` import at the top of AppShell:

```typescript
import { setRepoColor as setRepoColorApi, getConfig } from "../../api";
```

And add the `AppConfig` type import:

```typescript
import type { WorkspaceTab, AppConfig } from "../../types";
```

Then update the normal render to:

```tsx
{setupRepoPath && (
  <RepoSetupDialog
    open={setupDialogOpen}
    onOpenChange={setSetupDialogOpen}
    repoPath={setupRepoPath}
    existingGithubToken={previousRepoConfig?.githubToken ?? null}
    existingLinearKey={previousRepoConfig?.linearApiKey ?? null}
    previousRepoConfig={previousRepoConfig}
    onConfigured={handleRepoConfigured}
  />
)}
```

- [ ] **Step 4: Temporarily update RepoSetupDialog's handleSave to use new signature**

In `RepoSetupDialog.tsx`, update the `handleSave` function to call the new callback shape. Replace the current `handleSave` function:

```typescript
const handleSave = useCallback(async (action: "openBoard" | "createNew") => {
  try {
    const current = await getConfig(repoPath);
    const updated = { ...current };

    if (githubToken) {
      updated.githubToken = githubToken;
    }
    if (linearKey.trim()) {
      updated.linearApiKey = linearKey.trim();
    }
    if (setupScriptInput.trim()) {
      updated.setupScripts = [
        { name: "Setup", command: setupScriptInput.trim(), runOn: "create" },
      ];
    }
    if (worktreeBasePathInput.trim()) {
      updated.worktreeBasePath = worktreeBasePathInput.trim();
    }

    await saveConfig(repoPath, updated);
  } catch {
    // Save failed — proceed anyway
  }

  if (action === "createNew") {
    onConfigured("createNew");
  } else {
    // TODO: will pass selectedWorktreeIds in Task 3
    onConfigured({ selectedWorktreeIds: [] });
  }
}, [repoPath, githubToken, linearKey, setupScriptInput, worktreeBasePathInput, onConfigured]);
```

Update the footer buttons to use the new action parameter:

Replace the `DialogFooter` section:

```tsx
<DialogFooter className="flex-col-reverse sm:flex-row gap-2">
  <Button size="lg" onClick={() => handleSave(existingWorktreeCount > 0 ? "openBoard" : "createNew")}>
    {existingWorktreeCount > 0 ? "Open board →" : "Save & create first worktree"}
  </Button>
</DialogFooter>
```

Note: the "Skip — just use branches" link is removed entirely.

- [ ] **Step 5: Verify the app compiles**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/onboarding/RepoSetupDialog.tsx src/components/layout/AppShell.tsx
git commit -m "feat(onboarding): update onConfigured callback to pass worktree selection"
```

---

## Task 3: Rewrite RepoSetupDialog with adaptive layout

**Files:**
- Modify: `src/components/onboarding/RepoSetupDialog.tsx` (major rewrite)

This is the core task. The dialog becomes adaptive: worktree hero when detected, always-expanded integrations, settings carry-forward.

- [ ] **Step 1: Add selectable worktree state and carry-forward logic**

Replace the existing state declarations and `useEffect` in `RepoSetupDialog` (lines 40-123) with:

```typescript
// GitHub state
const [githubConnected, setGithubConnected] = useState<string | null>(null);
const [githubAuthState, setGithubAuthState] = useState<
  | { step: "idle" }
  | { step: "checking" }
>({ step: "idle" });
const [githubToken, setGithubToken] = useState("");
const [githubError, setGithubError] = useState<string | null>(null);
const [usingExistingGithub, setUsingExistingGithub] = useState(false);

// Linear state
const [linearKey, setLinearKey] = useState("");

// Worktree location state
const [worktreeBasePathInput, setWorktreeBasePathInput] = useState(() => parentDir(repoPath));

// Setup scripts state
const [setupScriptInput, setSetupScriptInput] = useState("");

// Detected worktrees — full objects for display
const [detectedWorktrees, setDetectedWorktrees] = useState<Worktree[]>([]);
// Set of worktree IDs the user has selected (all selected by default)
const [selectedWorktreeIds, setSelectedWorktreeIds] = useState<Set<string>>(new Set());

// Resolve username for existingGithubToken on open
const [existingGithubUsername, setExistingGithubUsername] = useState<string | null>(null);

useEffect(() => {
  if (!isOpen) return;

  // Reset form
  setGithubConnected(null);
  setGithubAuthState({ step: "idle" });
  setGithubToken(previousRepoConfig?.githubToken ?? "");
  setGithubError(null);
  setUsingExistingGithub(false);
  setLinearKey(previousRepoConfig?.linearApiKey ?? existingLinearKey ?? "");
  setWorktreeBasePathInput(parentDir(repoPath));
  setSetupScriptInput("");
  setExistingGithubUsername(null);
  setDetectedWorktrees([]);
  setSelectedWorktreeIds(new Set());

  // Detect existing worktrees
  listWorktrees(repoPath)
    .then((wts) => {
      setDetectedWorktrees(wts);
      // Select all by default
      setSelectedWorktreeIds(new Set(wts.map((wt) => wt.id)));
    })
    .catch(() => { /* no worktrees or error — ignore */ });

  // Load existing config for this repo (may have been set up before)
  getConfig(repoPath)
    .then((config) => {
      // Only override carry-forward values if this repo already has its own config
      if (config.githubToken) {
        setGithubToken(config.githubToken);
        githubAuthStatus()
          .then((status) => {
            if (status.authenticated && status.username) {
              setGithubConnected(status.username);
            }
          })
          .catch(() => { /* token invalid */ });
      } else if (previousRepoConfig?.githubToken) {
        // Carry-forward: check if the carried token is valid
        githubAuthStatus()
          .then((status) => {
            if (status.authenticated && status.username) {
              setGithubConnected(status.username);
            }
          })
          .catch(() => { /* token invalid */ });
      }
      if (config.setupScripts?.length > 0) {
        setSetupScriptInput(config.setupScripts[0].command);
      }
      if (config.worktreeBasePath) {
        setWorktreeBasePathInput(config.worktreeBasePath);
      }
      if (config.linearApiKey) {
        setLinearKey(config.linearApiKey);
      }
    })
    .catch(() => {
      // Config doesn't exist yet — use defaults / carry-forward
    });

  // Resolve username for the passed-in existing token (from another repo)
  if (existingGithubToken) {
    githubAuthStatus()
      .then((status) => {
        if (status.authenticated && status.username) {
          setExistingGithubUsername(status.username);
        }
      })
      .catch(() => { /* token invalid — hide the offer */ });
  }
}, [isOpen, repoPath, existingGithubToken, existingLinearKey, previousRepoConfig]);
```

Add the `Worktree` type import at the top:

```typescript
import type { AppConfig, Worktree } from "../../types";
```

- [ ] **Step 2: Add worktree toggle helpers**

After the `useEffect`, add:

```typescript
const toggleWorktree = useCallback((id: string) => {
  setSelectedWorktreeIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    return next;
  });
}, []);

const toggleAllWorktrees = useCallback(() => {
  if (selectedWorktreeIds.size === detectedWorktrees.length) {
    // All selected → deselect all
    setSelectedWorktreeIds(new Set());
  } else {
    // Some or none selected → select all
    setSelectedWorktreeIds(new Set(detectedWorktrees.map((wt) => wt.id)));
  }
}, [selectedWorktreeIds.size, detectedWorktrees]);

const hasDetectedWorktrees = detectedWorktrees.length > 0;
```

- [ ] **Step 3: Update handleSave to pass selected worktree IDs**

Replace the `handleSave` function with:

```typescript
const handleSave = useCallback(async () => {
  try {
    const current = await getConfig(repoPath);
    const updated = { ...current };

    if (githubToken) {
      updated.githubToken = githubToken;
    }
    if (linearKey.trim()) {
      updated.linearApiKey = linearKey.trim();
    }
    if (setupScriptInput.trim()) {
      updated.setupScripts = [
        { name: "Setup", command: setupScriptInput.trim(), runOn: "create" },
      ];
    }
    if (worktreeBasePathInput.trim()) {
      updated.worktreeBasePath = worktreeBasePathInput.trim();
    }

    await saveConfig(repoPath, updated);
  } catch {
    // Save failed — proceed anyway
  }

  if (hasDetectedWorktrees) {
    onConfigured({ selectedWorktreeIds: Array.from(selectedWorktreeIds) });
  } else {
    onConfigured("createNew");
  }
}, [repoPath, githubToken, linearKey, setupScriptInput, worktreeBasePathInput, onConfigured, hasDetectedWorktrees, selectedWorktreeIds]);
```

- [ ] **Step 4: Rewrite the JSX render**

Replace the entire `return (...)` block with the new adaptive layout:

```tsx
// Derive previous repo name for carry-forward note
const previousRepoName = previousRepoConfig
  ? previousRepoConfig.repoPath.split("/").pop() ?? "previous repo"
  : null;

return (
  <Dialog open={isOpen} onOpenChange={onOpenChange}>
    <DialogContent className="w-[600px] max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Set up your workspace</DialogTitle>
        <DialogDescription>
          Configure integrations and worktrees for{" "}
          <span className="font-medium text-text-primary">
            {repoPath.replace(/^\/Users\/[^/]+/, "~")}
          </span>
          {previousRepoName && (
            <>
              <br />
              <span className="text-micro text-text-tertiary">
                Settings carried over from <span className="italic">{previousRepoName}</span>
              </span>
            </>
          )}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {/* ── Worktree detection hero ── */}
        {hasDetectedWorktrees ? (
          <div className="px-4 py-3.5 border border-accent-primary/20 bg-accent-primary/5 rounded-lg">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-md bg-accent-muted flex items-center justify-center">
                  <FolderOpen className="h-3 w-3 text-accent-primary" />
                </div>
                <span className="text-caption font-semibold text-text-primary">
                  Found {detectedWorktrees.length} {detectedWorktrees.length === 1 ? "worktree" : "worktrees"}
                </span>
              </div>
              <button
                type="button"
                className="text-micro text-accent-primary hover:underline cursor-pointer"
                onClick={toggleAllWorktrees}
              >
                {selectedWorktreeIds.size === detectedWorktrees.length ? "Deselect all" : "Select all"}
              </button>
            </div>

            <div className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto">
              {detectedWorktrees.map((wt) => {
                const isSelected = selectedWorktreeIds.has(wt.id);
                return (
                  <button
                    key={wt.id}
                    type="button"
                    className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left cursor-pointer transition-opacity ${
                      isSelected
                        ? "bg-accent-primary/8 border border-accent-primary/25"
                        : "bg-[rgba(255,255,255,0.02)] border border-border-default opacity-60"
                    }`}
                    onClick={() => toggleWorktree(wt.id)}
                  >
                    <div
                      className={`h-[18px] w-[18px] rounded flex-shrink-0 flex items-center justify-center ${
                        isSelected
                          ? "bg-accent-primary"
                          : "border-[1.5px] border-border-hover"
                      }`}
                    >
                      {isSelected && (
                        <Check className="h-3 w-3 text-white" />
                      )}
                    </div>
                    <span className="text-caption font-medium text-text-primary truncate">
                      {wt.branch || wt.name}
                    </span>
                    <span className="text-micro text-text-tertiary ml-auto truncate max-w-[200px]">
                      {wt.path.replace(/^\/Users\/[^/]+/, "~")}
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="text-micro text-text-tertiary mt-2.5">
              {selectedWorktreeIds.size} of {detectedWorktrees.length} selected · Deselected worktrees stay on disk, just hidden from your board
            </p>
          </div>
        ) : (
          <div className="px-4 py-3 border border-border-default bg-[rgba(255,255,255,0.02)] rounded-lg">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-3.5 w-3.5 text-text-tertiary" />
              <span className="text-caption text-text-secondary">
                No existing worktrees found — you'll create your first one next
              </span>
            </div>
          </div>
        )}

        {/* ── GitHub card ── */}
        <div className="px-4 py-3.5 border border-border-subtle rounded-lg">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-7 w-7 rounded-md bg-[rgba(255,255,255,0.03)] flex items-center justify-center shrink-0">
              <Github className="h-3.5 w-3.5 text-text-tertiary" />
            </div>
            <div className="min-w-0">
              <div className="text-caption font-medium text-text-primary">Connect GitHub</div>
              <div className="text-micro text-text-tertiary">PR status, check runs, and branch management</div>
            </div>
          </div>

          {githubConnected ? (
            <div className="flex items-center gap-2 text-body">
              <Check className="h-3.5 w-3.5 text-green-400" />
              <span className="text-text-primary font-medium">@{githubConnected}</span>
              {(usingExistingGithub || previousRepoConfig?.githubToken) && (
                <span className="text-micro text-text-tertiary">(from another repository)</span>
              )}
            </div>
          ) : githubAuthState.step === "checking" ? (
            <div className="flex items-center gap-1.5 text-micro text-text-tertiary">
              <Loader2 className="h-3 w-3 animate-spin" />
              Checking GitHub CLI...
            </div>
          ) : showExistingGithubOffer ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleUseExistingGithub}
                >
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                  Use @{existingGithubUsername}
                </Button>
                <button
                  type="button"
                  className="text-micro text-accent-primary hover:underline cursor-pointer"
                  onClick={startGithubAuth}
                >
                  Connect different account
                </button>
              </div>
              <p className="text-micro text-text-tertiary">
                Connected as @{existingGithubUsername} — use this account?
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Button
                variant="secondary"
                size="sm"
                onClick={startGithubAuth}
              >
                <Github className="h-3.5 w-3.5 mr-1.5" />
                Connect to GitHub
              </Button>
              <p className="text-micro text-text-tertiary">
                Optional — you can add this later in settings
              </p>
              {githubError && (
                <p className="text-micro text-red-400">{githubError}</p>
              )}
            </div>
          )}
        </div>

        {/* ── Linear card ── */}
        <div className="px-4 py-3.5 border border-border-subtle rounded-lg">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-7 w-7 rounded-md bg-[rgba(255,255,255,0.03)] flex items-center justify-center shrink-0">
              <Key className="h-3.5 w-3.5 text-text-tertiary" />
            </div>
            <div className="min-w-0">
              <div className="text-caption font-medium text-text-primary">Connect Linear</div>
              <div className="text-micro text-text-tertiary">Link tickets and track progress</div>
            </div>
          </div>
          <Input
            type="password"
            placeholder="lin_api_..."
            value={linearKey}
            onChange={(e) => setLinearKey(e.target.value)}
          />
          {(existingLinearKey || previousRepoConfig?.linearApiKey) && linearKey && (
            <p className="text-micro text-text-tertiary mt-1.5">
              Using key from another repository
            </p>
          )}
          {!existingLinearKey && !previousRepoConfig?.linearApiKey && (
            <p className="text-micro text-text-tertiary mt-1.5">
              Optional — you can add this later in settings
            </p>
          )}
        </div>

        {/* ── Worktree location card ── */}
        <div className="px-4 py-3.5 border border-border-subtle rounded-lg">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-7 w-7 rounded-md bg-[rgba(255,255,255,0.03)] flex items-center justify-center shrink-0">
              <FolderOpen className="h-3.5 w-3.5 text-text-tertiary" />
            </div>
            <div className="min-w-0">
              <div className="text-caption font-medium text-text-primary">Worktree location</div>
              <div className="text-micro text-text-tertiary">Where new worktrees are created on disk</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input
              className="flex-1"
              value={worktreeBasePathInput}
              onChange={(e) => setWorktreeBasePathInput(e.target.value)}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                const selected = await open({ directory: true, multiple: false });
                if (selected) setWorktreeBasePathInput(selected as string);
              }}
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="text-micro text-text-tertiary mt-1.5">
            Default: sibling directories of the repository
          </p>
        </div>

        {/* ── Setup scripts card ── */}
        <div className="px-4 py-3.5 border border-border-subtle rounded-lg">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-7 w-7 rounded-md bg-[rgba(255,255,255,0.03)] flex items-center justify-center shrink-0">
              <Terminal className="h-3.5 w-3.5 text-text-tertiary" />
            </div>
            <div className="min-w-0">
              <div className="text-caption font-medium text-text-primary">Setup scripts</div>
              <div className="text-micro text-text-tertiary">Run automatically when creating new worktrees</div>
            </div>
          </div>
          <Input
            className="font-mono"
            placeholder="npm install"
            value={setupScriptInput}
            onChange={(e) => setSetupScriptInput(e.target.value)}
          />
        </div>
      </div>

      <DialogFooter className="flex items-center justify-between">
        <span className="text-micro text-text-tertiary">You can add more worktrees later</span>
        <Button size="lg" onClick={handleSave}>
          {hasDetectedWorktrees ? "Open board →" : "Save & create first worktree"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
```

- [ ] **Step 5: Verify the app compiles**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Manual test — first repo with existing worktrees**

1. Clear app config to simulate new user: delete `~/.alfredo/app.json` (back it up first)
2. Launch app with `npm run tauri dev`
3. Select a repo that has existing worktrees
4. Verify: setup dialog shows selectable worktree list at top
5. Verify: all worktrees selected by default
6. Verify: can deselect/reselect worktrees
7. Verify: "Select all" / "Deselect all" toggles work
8. Verify: CTA says "Open board →"
9. Click "Open board →" — board should load with selected worktrees

- [ ] **Step 7: Manual test — first repo without worktrees**

1. Select a repo that has no worktrees
2. Verify: "No existing worktrees found" message shows
3. Verify: integrations section is expanded
4. Verify: CTA says "Save & create first worktree"
5. Click CTA — should open CreateWorktreeDialog

- [ ] **Step 8: Commit**

```bash
git add src/components/onboarding/RepoSetupDialog.tsx
git commit -m "feat(onboarding): rewrite RepoSetupDialog with adaptive worktree detection"
```

---

## Task 4: Settings carry-forward for repo #2+

**Files:**
- Modify: `src/components/layout/AppShell.tsx` (already has previousRepoConfig from Task 2)

This task verifies the carry-forward logic works end-to-end. The code was added in Task 2 (loading previousRepoConfig) and Task 3 (using it in the dialog). This task is manual testing and any fixes.

- [ ] **Step 1: Manual test — add second repo**

1. Launch app with one repo already configured (with GitHub + Linear set up)
2. Click "+" in sidebar to add another repo
3. Verify: setup dialog opens with GitHub already connected (showing username)
4. Verify: Linear key is pre-filled
5. Verify: "Settings carried over from *{repo-name}*" note shows in header
6. Verify: Setup scripts field is empty
7. Verify: worktree base path is derived from new repo's parent directory
8. Click CTA — second repo should be added and its worktrees loaded

- [ ] **Step 2: Commit any fixes**

If any fixes were needed:
```bash
git add -u
git commit -m "fix(onboarding): fix settings carry-forward edge cases"
```

---

## Task 5: Orientation banner

**Files:**
- Create: `src/components/layout/OrientationBanner.tsx`
- Modify: `src/components/layout/AppShell.tsx` (render the banner)

- [ ] **Step 1: Create the OrientationBanner component**

Create `src/components/layout/OrientationBanner.tsx`:

```tsx
import { X } from "lucide-react";

interface OrientationBannerProps {
  onDismiss: () => void;
}

function OrientationBanner({ onDismiss }: OrientationBannerProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 bg-accent-primary/5 border-b border-accent-primary/15">
      <p className="text-caption text-text-secondary">
        <span className="font-semibold text-text-primary">Welcome to Alfredo</span>
        {" — "}
        Each column is a worktree. Open the terminal tab to start an agent, or create a new worktree with{" "}
        <kbd className="px-1.5 py-0.5 rounded bg-bg-elevated border border-border-default text-micro font-mono">⌘N</kbd>.
      </p>
      <button
        type="button"
        className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-secondary cursor-pointer"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export { OrientationBanner };
```

- [ ] **Step 2: Render the banner in AppShell**

In `AppShell.tsx`, import the banner:

```typescript
import { OrientationBanner } from "./OrientationBanner";
```

Add a dismiss handler near the other callbacks:

```typescript
const handleDismissOrientation = useCallback(async () => {
  await updateConfig({ hasSeenOrientation: true });
}, [updateConfig]);
```

Note: `updateConfig` is already returned from `useAppConfig()`. Make sure it's destructured from the hook — check the existing destructuring of `useAppConfig()` and add `updateConfig` if it's not already there.

Find where the main layout renders (after the `hasNoRepos` check, in the normal app state). Add the banner just before the main content area, inside the layout container. Look for where `<Sidebar>` and `<LayoutRenderer>` are rendered and add above the main content panel:

```tsx
{!config?.hasSeenOrientation && worktrees.length > 0 && (
  <OrientationBanner onDismiss={handleDismissOrientation} />
)}
```

Place this inside the main content area, above the `<Group>` or `<LayoutRenderer>` — it should span the full width of the content area (not the sidebar).

- [ ] **Step 3: Verify the app compiles**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Manual test**

1. Clear `hasSeenOrientation` from app config (or use fresh config)
2. Launch app with worktrees
3. Verify: orientation banner shows at top of content area
4. Verify: click X dismisses it
5. Verify: refresh app — banner does not reappear

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/OrientationBanner.tsx src/components/layout/AppShell.tsx
git commit -m "feat(onboarding): add dismissible orientation banner for first-time users"
```

---

## Task 6: Clean up and final verification

**Files:**
- Modify: `src/components/onboarding/RepoSetupDialog.tsx` (remove dead code)

- [ ] **Step 1: Remove unused branch mode references**

Search `RepoSetupDialog.tsx` for any remaining references to `"branch"` mode or the old `handleSave("branch")` / `handleSave("worktree")` calls and remove them. The `handleSave` no longer takes a mode parameter.

- [ ] **Step 2: Full end-to-end test**

Run through the complete flow:

1. **Fresh install:** Delete app config, launch app
2. **First repo (with worktrees):** Select repo → see worktree list → deselect one → click "Open board" → board loads with selected worktrees → orientation banner visible → dismiss banner
3. **Second repo:** Click "+" → select another repo → verify settings carried forward → confirm → board updates
4. **First repo (no worktrees):** Repeat fresh install, select repo with no worktrees → see "no worktrees" message → click "Save & create first worktree" → CreateWorktreeDialog opens
5. **Refresh:** Reload app — orientation banner stays dismissed, worktrees persist

- [ ] **Step 3: Final commit if any cleanup needed**

```bash
git add -u
git commit -m "refactor(onboarding): clean up dead branch-mode references"
```

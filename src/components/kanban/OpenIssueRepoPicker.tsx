import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/Dialog";
import { Button } from "../ui/Button";
import { RepoDropdown } from "../ui/RepoDropdown";
import { BaseBranchPicker } from "./create-worktree/BaseBranchPicker";
import { useDefaultBranch } from "../../hooks/useDefaultBranch";
import type { RepoEntry } from "../../types";
import {
  OPEN_ISSUE_PICK_REPO_EVENT,
  openIssueInRepo,
  type PickRepoDetail,
} from "../../services/openIssueFlow";

interface OpenIssueRepoPickerProps {
  /** Worktree-mode repos to choose from. */
  repos: RepoEntry[];
  repoColors: Record<string, string>;
  repoDisplayNames?: Record<string, string>;
  defaultRepoPath?: string;
}

/**
 * Repo chooser for a Linear "Custom link" deep-link, which arrives without a
 * workdir so Alfredo can't resolve the repo itself. Listens for
 * OPEN_ISSUE_PICK_REPO_EVENT (dispatched by useLinearOpenIssue), lets the user
 * pick a repo, then runs the shared create-worktree-and-paste flow.
 */
function OpenIssueRepoPicker({
  repos,
  repoColors,
  repoDisplayNames,
  defaultRepoPath,
}: OpenIssueRepoPickerProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PickRepoDetail | null>(null);
  const [repoPath, setRepoPath] = useState<string | undefined>(defaultRepoPath);
  // The user's explicit base-branch pick, or null to use the repo's default.
  const [baseOverride, setBaseOverride] = useState<string | null>(null);

  // Resolve the selected repo's default branch (master/develop/…) for display,
  // via the shared hook CreateWorktreeDialog uses to seed this same picker.
  const resolvedDefault = useDefaultBranch(open ? repoPath : undefined);
  // What the picker shows: the user's pick, else the repo's resolved default.
  const baseBranch = baseOverride ?? resolvedDefault ?? "";

  useEffect(() => {
    const handler = (e: Event) => {
      setPending((e as CustomEvent<PickRepoDetail>).detail);
      // Default to the active repo only if it's actually one of the choices,
      // else the first listed repo — never an off-list (e.g. branch-mode) path.
      const preferred = repos.some((r) => r.path === defaultRepoPath)
        ? defaultRepoPath
        : repos[0]?.path;
      setRepoPath(preferred);
      // Each issue starts from the repo default; drop any prior explicit pick.
      setBaseOverride(null);
      setOpen(true);
    };
    window.addEventListener(OPEN_ISSUE_PICK_REPO_EVENT, handler);
    return () => window.removeEventListener(OPEN_ISSUE_PICK_REPO_EVENT, handler);
  }, [defaultRepoPath, repos]);

  // Drop the explicit pick when the repo changes so the new repo falls back to
  // ITS default instead of carrying the previous repo's selection.
  useEffect(() => {
    setBaseOverride(null);
  }, [repoPath]);

  // A cold-start deep link can open this dialog before app config has loaded,
  // i.e. with repos=[] and no selection. Nothing else re-seeds repoPath when
  // the repos arrive, so without this the dialog stays a dead end (no dropdown,
  // disabled submit) until the user cancels and re-clicks the link.
  useEffect(() => {
    if (!open || repoPath || repos.length === 0) return;
    setRepoPath(repos.some((r) => r.path === defaultRepoPath) ? defaultRepoPath : repos[0]?.path);
  }, [open, repoPath, repos, defaultRepoPath]);

  function handleOpen() {
    if (!pending || !repoPath) return;
    setOpen(false);
    // Forward only an EXPLICIT pick. Otherwise pass "" so openIssueInRepo resolves
    // the repo's real default itself — never a stale default carried from another
    // repo (or an in-flight resolution) that may not exist here.
    void openIssueInRepo(repoPath, pending, baseOverride ?? "");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[440px]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleOpen();
          }}
        >
          <div className="flex flex-col gap-6">
            <DialogHeader className="!mb-0">
              <DialogTitle>Open Linear issue</DialogTitle>
              <DialogDescription>
                {pending?.issueId
                  ? `Choose a repo for ${pending.issueId} — a new worktree on ${pending.branch}.`
                  : `Choose a repo — a new worktree on ${pending?.branch ?? ""}.`}
              </DialogDescription>
            </DialogHeader>

            {repoPath && (
              <RepoDropdown
                repos={repos}
                repoColors={repoColors}
                repoDisplayNames={repoDisplayNames}
                value={repoPath}
                onChange={setRepoPath}
              />
            )}

            {repoPath && baseBranch && (
              <BaseBranchPicker
                key={repoPath}
                repoPath={repoPath}
                baseBranch={baseBranch}
                onBaseBranchChange={setBaseOverride}
                open={open}
              />
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!repoPath || !pending}>
              Open in Alfredo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { OpenIssueRepoPicker };

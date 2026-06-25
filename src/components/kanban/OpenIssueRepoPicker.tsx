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

  useEffect(() => {
    const handler = (e: Event) => {
      setPending((e as CustomEvent<PickRepoDetail>).detail);
      // Default to the active repo only if it's actually one of the choices,
      // else the first listed repo — never an off-list (e.g. branch-mode) path.
      const preferred = repos.some((r) => r.path === defaultRepoPath)
        ? defaultRepoPath
        : repos[0]?.path;
      setRepoPath(preferred);
      setOpen(true);
    };
    window.addEventListener(OPEN_ISSUE_PICK_REPO_EVENT, handler);
    return () => window.removeEventListener(OPEN_ISSUE_PICK_REPO_EVENT, handler);
  }, [defaultRepoPath, repos]);

  function handleOpen() {
    if (!pending || !repoPath) return;
    setOpen(false);
    void openIssueInRepo(repoPath, pending);
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

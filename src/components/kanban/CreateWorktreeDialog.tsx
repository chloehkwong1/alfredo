import { useState, useEffect } from "react";
import { GitBranch, GitPullRequest, Ticket, Plus } from "lucide-react";
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
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { createWorktreeFrom, getConfig } from "../../api";
import type { RepoEntry, WorktreeSource } from "../../types";
import { NewBranchTab, getNewBranchSource } from "./create-worktree/NewBranchTab";
import { BranchesTab } from "./create-worktree/BranchesTab";
import { PullRequestsTab } from "./create-worktree/PullRequestsTab";
import { LinearIssuesTab } from "./create-worktree/LinearIssuesTab";

type Tab = "newBranch" | "branches" | "pullRequests" | "linearIssues";

interface CreateWorktreeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoPath?: string;
  repos?: RepoEntry[];
  selectedRepos?: string[];
  repoColors?: Record<string, string>;
  defaultRepoPath?: string;
}

const tabDefs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "newBranch", label: "New Branch", icon: <Plus className="h-3.5 w-3.5" /> },
  { id: "branches", label: "Branches", icon: <GitBranch className="h-3.5 w-3.5" /> },
  { id: "pullRequests", label: "PRs", icon: <GitPullRequest className="h-3.5 w-3.5" /> },
  { id: "linearIssues", label: "Linear Issues", icon: <Ticket className="h-3.5 w-3.5" /> },
];

function CreateWorktreeDialog({ open, onOpenChange, repoPath, repos, selectedRepos, repoColors, defaultRepoPath }: CreateWorktreeDialogProps) {
  const addWorktree = useWorkspaceStore((s) => s.addWorktree);
  const ensureDefaultTabs = useWorkspaceStore((s) => s.ensureDefaultTabs);
  const setActiveWorktree = useWorkspaceStore((s) => s.setActiveWorktree);

  const [currentRepoPath, setCurrentRepoPath] = useState<string | undefined>(
    defaultRepoPath ?? repoPath,
  );
  const [activeTab, setActiveTab] = useState<Tab>("newBranch");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New branch state (lifted because it's needed for Create button + handleCreate)
  const [branchName, setBranchName] = useState("");
  const [baseBranch, setBaseBranch] = useState("");

  // Selection state for list tabs
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(null);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);

  // Setup scripts
  const [runSetup, setRunSetup] = useState(true);
  const [hasSetupScripts, setHasSetupScripts] = useState(false);

  // Reset currentRepoPath when dialog opens
  useEffect(() => {
    if (open) {
      setCurrentRepoPath(defaultRepoPath ?? repoPath);
    }
  }, [open, defaultRepoPath, repoPath]);

  // Load config to check for setup scripts
  useEffect(() => {
    if (open && currentRepoPath) {
      getConfig(currentRepoPath)
        .then((config) => setHasSetupScripts(config.setupScripts.length > 0))
        .catch(() => setHasSetupScripts(false));
    }
  }, [open, currentRepoPath]);

  // Reset selection state when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedBranch(null);
      setSelectedPrNumber(null);
      setSelectedIssueId(null);
      setCreating(false);
      setError(null);
    }
  }, [open]);

  function getSource(): WorktreeSource | null {
    switch (activeTab) {
      case "newBranch":
        return getNewBranchSource(branchName, baseBranch);
      case "branches":
        return selectedBranch ? { kind: "existingBranch", name: selectedBranch } : null;
      case "pullRequests":
        return selectedPrNumber ? { kind: "pullRequest", number: selectedPrNumber } : null;
      case "linearIssues":
        return selectedIssueId ? { kind: "linearTicket", id: selectedIssueId } : null;
    }
  }

  async function handleCreate() {
    const source = getSource();
    if (!currentRepoPath || !source) return;

    setCreating(true);
    setError(null);
    try {
      const worktree = await createWorktreeFrom(currentRepoPath, source);
      if (worktree) {
        addWorktree(worktree);
        ensureDefaultTabs(worktree.id);
        setActiveWorktree(worktree.id);
        onOpenChange(false);
        setBranchName("");
      } else {
        setError("Failed to create worktree. Please try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[540px]">
        <div className="flex flex-col gap-6">
          <DialogHeader className="!mb-0">
            <DialogTitle>Create Worktree</DialogTitle>
            <DialogDescription>
              Create a new worktree from a branch, pull request, or Linear issue.
            </DialogDescription>
          </DialogHeader>

          {repos && selectedRepos && repoColors && currentRepoPath && (
            <RepoDropdown
              repos={repos}
              selectedRepos={selectedRepos}
              repoColors={repoColors}
              value={currentRepoPath}
              onChange={setCurrentRepoPath}
            />
          )}

          {/* Tab bar */}
          <div className="flex gap-1 p-1 bg-bg-sidebar rounded-lg">
            {tabDefs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={[
                  "flex items-center gap-1.5 px-[14px] py-2 text-sm font-medium rounded-[6px]",
                  "transition-all duration-[var(--transition-fast)] cursor-pointer",
                  activeTab === tab.id
                    ? "bg-bg-elevated text-text-primary shadow-sm border border-border-default"
                    : "text-text-tertiary hover:text-text-secondary hover:bg-bg-hover border border-transparent",
                ].join(" ")}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="min-h-[200px]">
            {activeTab === "newBranch" && (
              <NewBranchTab
                branchName={branchName}
                baseBranch={baseBranch}
                onBranchNameChange={setBranchName}
                onBaseBranchChange={setBaseBranch}
              />
            )}

            {activeTab === "branches" && currentRepoPath && (
              <BranchesTab
                repoPath={currentRepoPath}
                open={open}
                selectedBranch={selectedBranch}
                onSelectBranch={setSelectedBranch}
                onDefaultBranchDetected={setBaseBranch}
              />
            )}

            {activeTab === "pullRequests" && currentRepoPath && (
              <PullRequestsTab
                repoPath={currentRepoPath}
                open={open}
                selectedPrNumber={selectedPrNumber}
                onSelectPr={setSelectedPrNumber}
              />
            )}

            {activeTab === "linearIssues" && (
              <LinearIssuesTab
                open={open}
                selectedIssueId={selectedIssueId}
                onSelectIssue={setSelectedIssueId}
              />
            )}
          </div>

          {hasSetupScripts && (
            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={runSetup}
                onChange={(e) => setRunSetup(e.target.checked)}
                className="rounded border-border-default accent-accent-primary"
              />
              Auto-run setup scripts
            </label>
          )}

          {error && (
            <div className="text-xs text-danger bg-danger/10 rounded-[var(--radius-sm)] px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={creating || !getSource()}
          >
            {creating ? "Creating..." : "Create Worktree"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { CreateWorktreeDialog };

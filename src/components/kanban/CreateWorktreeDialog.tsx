import { useState, useEffect, useRef, useCallback } from "react";
import { GitBranch, GitPullRequest, Ticket, Plus, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/Dialog";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { searchLinearIssues, createWorktreeFrom, getConfig, listBranches, syncPrStatus } from "../../api";
import type { LinearTicket, Worktree, PrStatus } from "../../types";

type Tab = "newBranch" | "branches" | "pullRequests" | "linearIssues";

interface CreateWorktreeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoPath?: string;
}

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "newBranch", label: "New Branch", icon: <Plus className="h-3.5 w-3.5" /> },
  { id: "branches", label: "Branches", icon: <GitBranch className="h-3.5 w-3.5" /> },
  { id: "pullRequests", label: "Pull Requests", icon: <GitPullRequest className="h-3.5 w-3.5" /> },
  { id: "linearIssues", label: "Linear Issues", icon: <Ticket className="h-3.5 w-3.5" /> },
];

function CreateWorktreeDialog({ open, onOpenChange, repoPath = "." }: CreateWorktreeDialogProps) {
  const addWorktree = useWorkspaceStore((s) => s.addWorktree);
  const [activeTab, setActiveTab] = useState<Tab>("newBranch");
  const [branchName, setBranchName] = useState("");
  const [baseBranch, setBaseBranch] = useState("main");
  const [searchQuery, setSearchQuery] = useState("");
  const [runSetup, setRunSetup] = useState(true);
  const [hasSetupScripts, setHasSetupScripts] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load config to check for setup scripts when dialog opens
  useEffect(() => {
    if (open && repoPath) {
      getConfig(repoPath)
        .then((config) => setHasSetupScripts(config.setupScripts.length > 0))
        .catch(() => setHasSetupScripts(false));
    }
  }, [open, repoPath]);

  // Fetch branches when dialog opens
  useEffect(() => {
    if (open && repoPath) {
      setBranchesLoading(true);
      listBranches(repoPath)
        .then((result) => {
          setBranches(result);
          setBranchesError(null);
        })
        .catch((err) => setBranchesError(err instanceof Error ? err.message : String(err)))
        .finally(() => setBranchesLoading(false));
    }
  }, [open, repoPath]);

  // Fetch PRs lazily when the PR tab is first opened
  const [prsFetched, setPrsFetched] = useState(false);
  useEffect(() => {
    if (open && repoPath && activeTab === "pullRequests" && !prsFetched) {
      setPrsLoading(true);
      setPrsFetched(true);
      syncPrStatus(repoPath)
        .then((result) => {
          setPrs(result);
          setPrsError(null);
        })
        .catch((err) => setPrsError(err instanceof Error ? err.message : String(err)))
        .finally(() => setPrsLoading(false));
    }
    if (!open) setPrsFetched(false);
  }, [open, repoPath, activeTab, prsFetched]);

  // Branch list state
  const [branches, setBranches] = useState<Worktree[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);

  // PR list state
  const [prs, setPrs] = useState<PrStatus[]>([]);
  const [prsLoading, setPrsLoading] = useState(false);
  const [prsError, setPrsError] = useState<string | null>(null);
  const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(null);

  // Linear search state
  const [linearResults, setLinearResults] = useState<LinearTicket[]>([]);
  const [linearLoading, setLinearLoading] = useState(false);
  const [linearError, setLinearError] = useState<string | null>(null);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search for Linear issues
  const searchLinear = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setLinearResults([]);
      setLinearError(null);
      setLinearLoading(false);
      return;
    }

    setLinearLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchLinearIssues(query);
        setLinearResults(results);
        setLinearError(null);
      } catch (err) {
        setLinearError(err instanceof Error ? err.message : String(err));
        setLinearResults([]);
      } finally {
        setLinearLoading(false);
      }
    }, 300);
  }, []);

  // Trigger search when query changes on the Linear tab
  useEffect(() => {
    if (activeTab === "linearIssues") {
      searchLinear(searchQuery);
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, activeTab, searchLinear]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedBranch(null);
      setSelectedPrNumber(null);
      setSelectedIssueId(null);
      setLinearResults([]);
      setLinearError(null);
      setCreating(false);
      setError(null);
    }
  }, [open]);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      let worktree;
      if (activeTab === "newBranch" && branchName.trim()) {
        worktree = await createWorktreeFrom(repoPath, {
          kind: "newBranch",
          name: branchName.trim(),
          base: baseBranch || "main",
        });
      } else if (activeTab === "branches" && selectedBranch) {
        worktree = await createWorktreeFrom(repoPath, {
          kind: "existingBranch",
          name: selectedBranch,
        });
      } else if (activeTab === "pullRequests" && selectedPrNumber) {
        worktree = await createWorktreeFrom(repoPath, {
          kind: "pullRequest",
          number: selectedPrNumber,
        });
      } else if (activeTab === "linearIssues" && selectedIssueId) {
        worktree = await createWorktreeFrom(repoPath, {
          kind: "linearTicket",
          id: selectedIssueId,
        });
      }
      if (worktree) {
        addWorktree(worktree);
      }
      onOpenChange(false);
      setBranchName("");
      setSearchQuery("");
      setSelectedBranch(null);
      setSelectedPrNumber(null);
      setSelectedIssueId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[540px]">
        <DialogHeader>
          <DialogTitle>Create Worktree</DialogTitle>
          <DialogDescription>
            Create a new worktree from a branch, pull request, or Linear issue.
          </DialogDescription>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex gap-1 p-1 bg-bg-sidebar rounded-lg mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setSearchQuery("");
              }}
              className={[
                "flex items-center gap-1.5 px-[14px] py-2 text-body font-medium rounded-[6px]",
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
            <div className="space-y-5">
              <div>
                <label className="block text-body font-medium text-text-secondary mb-2">
                  Branch name
                </label>
                <Input
                  placeholder="feat/my-feature"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-body font-medium text-text-secondary mb-2">
                  Base branch
                </label>
                <Input
                  placeholder="main"
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                />
              </div>
            </div>
          )}

          {activeTab === "branches" && (
            <div className="space-y-3">
              <Input
                placeholder="Filter branches..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
              <div className="max-h-[240px] overflow-y-auto">
                {branchesLoading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
                  </div>
                )}
                {branchesError && (
                  <div className="text-caption text-danger text-center py-4">
                    {branchesError}
                  </div>
                )}
                {!branchesLoading && !branchesError && branches.length === 0 && (
                  <div className="text-caption text-text-tertiary text-center py-8">
                    No branches found.
                  </div>
                )}
                {!branchesLoading && branches
                  .filter((b) => !searchQuery.trim() || b.branch.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map((b) => (
                    <button
                      key={b.branch}
                      type="button"
                      onClick={() => setSelectedBranch(b.branch === selectedBranch ? null : b.branch)}
                      className={[
                        "w-full text-left px-3 py-2 rounded-[var(--radius-sm)] cursor-pointer",
                        "transition-colors duration-[var(--transition-fast)]",
                        b.branch === selectedBranch
                          ? "bg-accent-primary/10 border border-accent-primary"
                          : "hover:bg-bg-secondary border border-transparent",
                      ].join(" ")}
                    >
                      <div className="flex items-center gap-2">
                        <GitBranch className="h-3.5 w-3.5 text-text-tertiary flex-shrink-0" />
                        <span className="text-body text-text-primary truncate">
                          {b.branch}
                        </span>
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          )}

          {activeTab === "pullRequests" && (
            <div className="space-y-3">
              <Input
                placeholder="Filter pull requests..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
              <div className="max-h-[240px] overflow-y-auto">
                {prsLoading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
                  </div>
                )}
                {prsError && (
                  <div className="text-caption text-danger text-center py-4">
                    {prsError}
                  </div>
                )}
                {!prsLoading && !prsError && prs.length === 0 && (
                  <div className="text-caption text-text-tertiary text-center py-8">
                    No pull requests found.
                  </div>
                )}
                {!prsLoading && prs
                  .filter((pr) => !searchQuery.trim() || pr.title.toLowerCase().includes(searchQuery.toLowerCase()) || `#${pr.number}`.includes(searchQuery))
                  .map((pr) => (
                    <button
                      key={pr.number}
                      type="button"
                      onClick={() => setSelectedPrNumber(pr.number === selectedPrNumber ? null : pr.number)}
                      className={[
                        "w-full text-left px-3 py-2 rounded-[var(--radius-sm)] cursor-pointer",
                        "transition-colors duration-[var(--transition-fast)]",
                        pr.number === selectedPrNumber
                          ? "bg-accent-primary/10 border border-accent-primary"
                          : "hover:bg-bg-secondary border border-transparent",
                      ].join(" ")}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-caption font-mono text-text-tertiary flex-shrink-0">
                          #{pr.number}
                        </span>
                        <span className="text-body text-text-primary truncate">
                          {pr.title}
                        </span>
                        {pr.draft && (
                          <span className="text-micro text-text-tertiary bg-bg-hover px-1.5 py-0.5 rounded flex-shrink-0">
                            Draft
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-caption text-text-tertiary">
                          {pr.branch}
                        </span>
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          )}

          {activeTab === "linearIssues" && (
            <div className="space-y-3">
              <Input
                placeholder="Search Linear issues..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
              <div className="max-h-[240px] overflow-y-auto">
                {linearLoading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
                  </div>
                )}
                {linearError && (
                  <div className="text-caption text-danger text-center py-4">
                    {linearError}
                  </div>
                )}
                {!linearLoading && !linearError && linearResults.length === 0 && searchQuery.trim() && (
                  <div className="text-caption text-text-tertiary text-center py-8">
                    No issues found.
                  </div>
                )}
                {!linearLoading && !linearError && linearResults.length === 0 && !searchQuery.trim() && (
                  <div className="text-caption text-text-tertiary text-center py-8">
                    Type to search Linear issues.
                  </div>
                )}
                {!linearLoading && linearResults.map((issue) => (
                  <button
                    key={issue.id}
                    type="button"
                    onClick={() => setSelectedIssueId(issue.id === selectedIssueId ? null : issue.id)}
                    className={[
                      "w-full text-left px-3 py-2 rounded-[var(--radius-sm)] cursor-pointer",
                      "transition-colors duration-[var(--transition-fast)]",
                      issue.id === selectedIssueId
                        ? "bg-accent-primary/10 border border-accent-primary"
                        : "hover:bg-bg-secondary border border-transparent",
                    ].join(" ")}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-caption font-mono text-text-tertiary flex-shrink-0">
                        {issue.identifier}
                      </span>
                      <span className="text-body text-text-primary truncate">
                        {issue.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 ml-0">
                      <span className="text-caption text-text-tertiary">
                        {issue.state}
                      </span>
                      {issue.assignee && (
                        <span className="text-caption text-text-tertiary">
                          &middot; {issue.assignee}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Auto-run setup scripts checkbox — only shown when scripts are configured */}
        {hasSetupScripts && (
          <label className="flex items-center gap-2 text-caption text-text-secondary cursor-pointer mt-6">
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
          <div className="text-caption text-danger bg-danger/10 rounded-[var(--radius-sm)] px-3 py-2">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={
              creating ||
              (activeTab === "newBranch" && !branchName.trim()) ||
              (activeTab === "branches" && !selectedBranch) ||
              (activeTab === "pullRequests" && !selectedPrNumber) ||
              (activeTab === "linearIssues" && !selectedIssueId)
            }
          >
            {creating ? "Creating..." : "Create Worktree"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { CreateWorktreeDialog };

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
import { searchLinearIssues, createWorktreeFrom } from "../../api";
import type { LinearTicket } from "../../types";

type Tab = "newBranch" | "branches" | "pullRequests" | "linearIssues";

interface CreateWorktreeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "newBranch", label: "New Branch", icon: <Plus className="h-3.5 w-3.5" /> },
  { id: "branches", label: "Branches", icon: <GitBranch className="h-3.5 w-3.5" /> },
  { id: "pullRequests", label: "Pull Requests", icon: <GitPullRequest className="h-3.5 w-3.5" /> },
  { id: "linearIssues", label: "Linear Issues", icon: <Ticket className="h-3.5 w-3.5" /> },
];

function CreateWorktreeDialog({ open, onOpenChange }: CreateWorktreeDialogProps) {
  const branchMode = useWorkspaceStore((s) => s.branchMode);
  const addWorktree = useWorkspaceStore((s) => s.addWorktree);
  const [activeTab, setActiveTab] = useState<Tab>("newBranch");
  const [branchName, setBranchName] = useState("");
  const [baseBranch, setBaseBranch] = useState("main");
  const [searchQuery, setSearchQuery] = useState("");
  const [runSetup, setRunSetup] = useState(true);
  const [creating, setCreating] = useState(false);

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
      setSelectedIssueId(null);
      setLinearResults([]);
      setLinearError(null);
      setCreating(false);
    }
  }, [open]);

  async function handleCreate() {
    setCreating(true);
    try {
      let worktree;
      if (activeTab === "newBranch" && branchName.trim()) {
        worktree = await createWorktreeFrom(".", {
          kind: "newBranch",
          name: branchName.trim(),
          base: baseBranch || "main",
        });
      } else if (activeTab === "linearIssues" && selectedIssueId) {
        worktree = await createWorktreeFrom(".", {
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
      setSelectedIssueId(null);
    } catch {
      // Error handling will be enhanced later
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{branchMode ? "Create Branch" : "Create Worktree"}</DialogTitle>
          <DialogDescription>
            {branchMode
              ? "Create and check out a new branch."
              : "Create a new worktree from a branch, pull request, or Linear issue."}
          </DialogDescription>
        </DialogHeader>

        {/* Tab bar — in branch mode, only show New Branch and Branches tabs */}
        <div className="flex gap-1 p-1 bg-bg-secondary rounded-[var(--radius-md)] mb-4">
          {tabs
            .filter((tab) => !branchMode || tab.id === "newBranch" || tab.id === "branches")
            .map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setSearchQuery("");
              }}
              className={[
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-sm)]",
                "transition-all duration-[var(--transition-fast)] cursor-pointer",
                activeTab === tab.id
                  ? "bg-bg-elevated text-text-primary shadow-sm"
                  : "text-text-tertiary hover:text-text-secondary",
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
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
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
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
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
                placeholder="Search branches..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
              <div className="text-xs text-text-tertiary text-center py-8">
                Branch list will populate when connected to a repository.
              </div>
            </div>
          )}

          {activeTab === "pullRequests" && (
            <div className="space-y-3">
              <Input
                placeholder="Search pull requests..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
              <div className="text-xs text-text-tertiary text-center py-8">
                PR list will populate when GitHub is connected.
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
                  <div className="text-xs text-red-500 text-center py-4">
                    {linearError}
                  </div>
                )}
                {!linearLoading && !linearError && linearResults.length === 0 && searchQuery.trim() && (
                  <div className="text-xs text-text-tertiary text-center py-8">
                    No issues found.
                  </div>
                )}
                {!linearLoading && !linearError && linearResults.length === 0 && !searchQuery.trim() && (
                  <div className="text-xs text-text-tertiary text-center py-8">
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
                      <span className="text-xs font-mono text-text-tertiary flex-shrink-0">
                        {issue.identifier}
                      </span>
                      <span className="text-sm text-text-primary truncate">
                        {issue.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 ml-0">
                      <span className="text-xs text-text-tertiary">
                        {issue.state}
                      </span>
                      {issue.assignee && (
                        <span className="text-xs text-text-tertiary">
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

        {/* Auto-run setup scripts checkbox */}
        <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer mt-2">
          <input
            type="checkbox"
            checked={runSetup}
            onChange={(e) => setRunSetup(e.target.checked)}
            className="rounded border-border-default accent-accent-primary"
          />
          Auto-run setup scripts
        </label>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={
              creating ||
              (activeTab === "newBranch" && !branchName.trim()) ||
              (activeTab === "linearIssues" && !selectedIssueId)
            }
          >
            {creating ? "Creating..." : branchMode ? "Create Branch" : "Create Worktree"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { CreateWorktreeDialog };

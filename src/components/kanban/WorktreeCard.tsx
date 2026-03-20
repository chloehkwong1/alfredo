import { useDraggable } from "@dnd-kit/core";
import { motion } from "framer-motion";
import {
  GitBranch,
  GitPullRequest,
  GitPullRequestDraft,
  Clock,
} from "lucide-react";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import type { BadgeVariant } from "../ui/Badge";
import type { Worktree, AgentState } from "../../types";
import { useWorkspaceStore } from "../../stores/workspaceStore";

interface WorktreeCardProps {
  worktree: Worktree;
}

const agentStateLabel: Record<AgentState, string> = {
  idle: "Idle",
  busy: "Running",
  waitingForInput: "Waiting",
  notRunning: "Stopped",
};

const agentStateBadgeVariant: Record<AgentState, BadgeVariant> = {
  idle: "idle",
  busy: "busy",
  waitingForInput: "waiting",
  notRunning: "default",
};

function WorktreeCard({ worktree }: WorktreeCardProps) {
  const setActiveWorktree = useWorkspaceStore((s) => s.setActiveWorktree);
  const setView = useWorkspaceStore((s) => s.setView);
  const branchMode = useWorkspaceStore((s) => s.branchMode);
  const activeBranch = useWorkspaceStore((s) => s.activeBranch);

  const isActiveBranch = branchMode && activeBranch === worktree.branch;

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: worktree.id });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  function handleClick() {
    setActiveWorktree(worktree.id);
    setView("terminal");
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, scale: 0.95 }}
      transition={{ duration: 0.2 }}
    >
      <div
        ref={setNodeRef}
        style={style}
        {...listeners}
        {...attributes}
      >
        <Card
          hoverable
          onClick={handleClick}
          className={[
            "p-3 cursor-pointer select-none",
            isDragging ? "opacity-50 shadow-lg scale-[1.02]" : "",
            branchMode && isActiveBranch
              ? "ring-1 ring-accent-primary"
              : "",
            branchMode && !isActiveBranch
              ? "opacity-60"
              : "",
          ].join(" ")}
        >
          {/* Branch name */}
          <div className="flex items-center gap-1.5 mb-2">
            <GitBranch className="h-3.5 w-3.5 text-text-tertiary flex-shrink-0" />
            <span className="text-sm font-semibold text-text-primary truncate">
              {worktree.branch}
            </span>
          </div>

          {/* Active branch indicator (branch mode only) */}
          {branchMode && (
            <div className="flex items-center gap-2 mb-2">
              <Badge variant={isActiveBranch ? "idle" : "default"}>
                {isActiveBranch ? "Active" : "Inactive"}
              </Badge>
            </div>
          )}

          {/* Agent state badge */}
          <div className="flex items-center gap-2 mb-2">
            <Badge variant={agentStateBadgeVariant[worktree.agentStatus]}>
              {agentStateLabel[worktree.agentStatus]}
            </Badge>
          </div>

          {/* PR info */}
          {worktree.prStatus && (
            <div className="flex items-start gap-1.5 mb-2">
              {worktree.prStatus.draft ? (
                <GitPullRequestDraft className="h-3.5 w-3.5 text-text-tertiary flex-shrink-0 mt-0.5" />
              ) : (
                <GitPullRequest className="h-3.5 w-3.5 text-status-idle flex-shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <span className="text-xs text-text-secondary">
                  <span className="font-medium">#{worktree.prStatus.number}</span>
                  {worktree.prStatus.draft && (
                    <span className="ml-1 text-text-tertiary">Draft</span>
                  )}
                  {worktree.prStatus.merged && (
                    <span className="ml-1 text-purple-400">Merged</span>
                  )}
                  {!worktree.prStatus.draft && !worktree.prStatus.merged && (
                    <span className="ml-1 text-status-idle">Open</span>
                  )}
                </span>
                <p className="text-xs text-text-tertiary truncate">
                  {worktree.prStatus.title}
                </p>
              </div>
            </div>
          )}

          {/* Time active */}
          <div className="flex items-center gap-1 text-text-tertiary">
            <Clock className="h-3 w-3" />
            <span className="text-[11px]">Active</span>
          </div>
        </Card>
      </div>
    </motion.div>
  );
}

export { WorktreeCard };

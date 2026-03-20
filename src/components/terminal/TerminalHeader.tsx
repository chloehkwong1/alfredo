import { ArrowLeft, GitBranch } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { Badge } from "../ui/Badge";
import type { BadgeVariant } from "../ui/Badge";
import type { AgentState } from "../../types";

interface TerminalHeaderProps {
  branch: string;
  agentState: AgentState;
  isSeen?: boolean;
  onBack: () => void;
}

function getStatusDisplay(agentState: AgentState, isSeen: boolean): { label: string; variant: BadgeVariant } {
  if (agentState === "busy") return { label: "Thinking", variant: "busy" };
  if (agentState === "notRunning") return { label: "Idle", variant: "default" };
  // idle or waitingForInput
  if (isSeen) return { label: "Reviewed", variant: "idle" };
  return { label: "Attention", variant: "waiting" };
}

function TerminalHeader({ branch, agentState, isSeen = false, onBack }: TerminalHeaderProps) {
  const { label, variant } = getStatusDisplay(agentState, isSeen);

  return (
    <div className="flex items-center gap-3 h-11 px-3 bg-bg-secondary border-b border-border-default flex-shrink-0">
      <IconButton size="sm" label="Back to board" onClick={onBack}>
        <ArrowLeft />
      </IconButton>

      <div className="flex items-center gap-1.5 min-w-0">
        <GitBranch className="h-3.5 w-3.5 text-text-tertiary flex-shrink-0" />
        <span className="text-sm font-medium text-text-primary truncate">
          {branch}
        </span>
      </div>

      <Badge variant={variant}>
        {label}
      </Badge>
    </div>
  );
}

export { TerminalHeader };

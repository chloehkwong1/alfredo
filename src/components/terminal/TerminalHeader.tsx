import { ArrowLeft, GitBranch } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { Badge } from "../ui/Badge";
import type { BadgeVariant } from "../ui/Badge";
import type { AgentState } from "../../types";

interface TerminalHeaderProps {
  branch: string;
  agentState: AgentState;
  onBack: () => void;
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

function TerminalHeader({ branch, agentState, onBack }: TerminalHeaderProps) {
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

      <Badge variant={agentStateBadgeVariant[agentState]}>
        {agentStateLabel[agentState]}
      </Badge>
    </div>
  );
}

export { TerminalHeader };

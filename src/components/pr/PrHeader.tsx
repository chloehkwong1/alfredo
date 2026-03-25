import { ExternalLink, GitPullRequest, GitPullRequestDraft } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Badge } from "../ui";
import type { PrStatus } from "../../types";

interface PrHeaderProps {
  pr: PrStatus;
}

function PrHeader({ pr }: PrHeaderProps) {
  const Icon = pr.draft ? GitPullRequestDraft : GitPullRequest;
  const stateVariant = pr.merged ? "idle" : pr.draft ? "busy" : "waiting";
  const stateLabel = pr.merged ? "Merged" : pr.draft ? "Draft" : "Open";

  return (
    <div className="px-4 py-3 border-b border-border-default">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={16} className="text-text-tertiary flex-shrink-0" />
        <span className="text-sm font-semibold text-text-primary truncate">
          {pr.title}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={stateVariant}>{stateLabel}</Badge>
        <span className="text-xs text-text-tertiary">#{pr.number}</span>
        <button
          type="button"
          onClick={() => openUrl(pr.url)}
          className="ml-auto flex items-center gap-1 text-xs text-text-tertiary hover:text-accent-primary transition-colors cursor-pointer"
        >
          Open on GitHub
          <ExternalLink size={11} />
        </button>
      </div>
    </div>
  );
}

export { PrHeader };

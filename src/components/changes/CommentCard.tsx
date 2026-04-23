import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { ClaudeIcon } from "../icons/agents";
import { openUrl } from "@tauri-apps/plugin-opener";
import { formatTimeAgo } from "./formatRelativeTime";
import { MarkdownBody } from "../shared/MarkdownBody";
import { IconButton } from "../ui/IconButton";
import { Tooltip } from "../ui/Tooltip";

export function CommentCard({
  author,
  body,
  path,
  line,
  createdAt,
  resolved,
  htmlUrl,
  onJump,
  onSendToClaude,
}: {
  author: string;
  body: string;
  // path + line retained in the API for navigation (onJump) even though the
  // card no longer renders them — they're already shown by the file-group
  // header above each group of comments.
  path: string | null;
  line: number | null;
  createdAt: string;
  resolved: boolean;
  htmlUrl: string;
  onJump?: () => void;
  onSendToClaude?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = body.length > 150;
  // Silence unused-var warnings while keeping the props available to callers.
  void path;
  void line;

  return (
    <div
      onClick={onJump}
      className={`mx-1.5 px-2.5 py-2 bg-bg-secondary rounded-md text-[13px] ${
        resolved ? "border border-border-subtle opacity-50" : "border border-border-default"
      } ${onJump ? "cursor-pointer hover:border-accent-primary/40" : ""}`}
    >
      {/* Author row */}
      <div
        className="flex items-center gap-1.5 mb-1"
      >
        <span className="text-[11px] font-semibold text-text-primary">
          {author}
        </span>
        <span className="text-[11px] text-text-tertiary">·</span>
        <span className="text-[11px] text-text-tertiary shrink-0">
          {formatTimeAgo(createdAt)}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 shrink-0">
        <Tooltip content="Open on GitHub">
          <IconButton
            size="sm"
            label="Open on GitHub"
            className="min-w-[24px] min-h-[24px] h-auto w-auto p-0 text-text-tertiary hover:text-text-primary shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              openUrl(htmlUrl);
            }}
          >
            <ExternalLink size={12} />
          </IconButton>
        </Tooltip>
        {onSendToClaude && (
          <Tooltip content="Send to Claude">
            <IconButton
              size="sm"
              label="Send to Claude"
              className="min-w-[24px] min-h-[24px] h-auto w-auto p-0 text-text-tertiary hover:text-accent-primary shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onSendToClaude();
              }}
            >
              <ClaudeIcon size={12} />
            </IconButton>
          </Tooltip>
        )}
        </span>
      </div>

      {/* Body */}
      <div
        className={`relative text-text-primary ${expanded ? "" : "max-h-[60px] overflow-hidden"}`}
      >
        <MarkdownBody text={body || "*No comment body*"} compact />
        {!expanded && isLong && (
          <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-[var(--bg-secondary)] to-transparent pointer-events-none" />
        )}
      </div>
      {isLong && (
        <button
          className="text-accent-primary text-[11px] mt-1 bg-transparent border-none cursor-pointer p-0 font-[inherit] hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((prev) => !prev);
          }}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

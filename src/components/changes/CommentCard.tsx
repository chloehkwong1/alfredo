import { useState } from "react";
import { ExternalLink, Bot } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { formatTimeAgo } from "./formatRelativeTime";
import { MarkdownBody } from "../shared/MarkdownBody";
import { IconButton } from "../ui/IconButton";

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

  return (
    <div
      onClick={onJump}
      className={`mx-1.5 px-2 py-1.5 bg-bg-secondary rounded-md text-xs ${
        resolved ? "border border-border-subtle opacity-50" : "border border-border-default"
      } ${onJump ? "cursor-pointer hover:border-accent-primary/40" : ""}`}
    >
      {/* Author row */}
      <div
        className="flex items-center gap-[5px] mb-[3px]"
      >
        <span className="font-semibold text-text-primary">
          {author}
        </span>
        {path && (
          <span
            className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-text-tertiary text-[11px]"
            title={line != null ? `${path}:${line}` : path}
          >
            {path.split("/").pop()}
            {line != null ? `:${line}` : ""}
          </span>
        )}
        <span className="text-text-tertiary text-[10px] shrink-0">
          {formatTimeAgo(createdAt)}
        </span>
        <IconButton
          size="sm"
          label="Open on GitHub"
          className="h-auto w-auto p-0 text-text-tertiary hover:text-text-primary shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            openUrl(htmlUrl);
          }}
        >
          <ExternalLink size={10} />
        </IconButton>
        {onSendToClaude && (
          <IconButton
            size="sm"
            label="Send to Claude"
            className="h-auto w-auto p-0 text-text-tertiary hover:text-accent-primary shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onSendToClaude();
            }}
          >
            <Bot size={10} />
          </IconButton>
        )}
      </div>

      {/* Body */}
      <div
        className={`relative text-text-primary ${expanded ? "" : "max-h-[60px] overflow-hidden"}`}
      >
        <MarkdownBody text={body} compact />
        {!expanded && isLong && (
          <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-[var(--bg-secondary)] to-transparent pointer-events-none" />
        )}
      </div>
      {isLong && (
        <button
          className="text-accent-primary text-[10px] mt-1 bg-transparent border-none cursor-pointer p-0 font-[inherit]"
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

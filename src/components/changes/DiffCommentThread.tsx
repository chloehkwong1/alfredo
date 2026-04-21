import { Check, ChevronRight, ChevronUp, ExternalLink, GitPullRequest } from "lucide-react";
import { ClaudeIcon } from "../icons/agents";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { PrComment } from "../../types";
import { MarkdownBody, stripToPlainText } from "../shared/MarkdownBody";
import { formatTimeAgo } from "./formatRelativeTime";
import { Tooltip } from "../ui/Tooltip";

interface DiffCommentThreadProps {
  comments: PrComment[];
  expanded: boolean;
  onToggle: () => void;
  onSendToClaude?: (comment: PrComment) => void;
}

function DiffCommentThread({ comments, expanded, onToggle, onSendToClaude }: DiffCommentThreadProps) {
  const allResolved = comments.length > 0 && comments.every((c) => c.resolved);

  // ── Collapsed: preview bar ──
  if (!expanded) {
    const firstComment = comments[0];
    const previewText = stripToPlainText(firstComment.body).slice(0, 120);
    const initial = firstComment.author.charAt(0).toUpperCase();
    const uniqueAuthors = [...new Set(comments.map((c) => c.author))];

    // Resolved collapsed — minimal row
    if (allResolved) {
      return (
        <button
          onClick={onToggle}
          className="flex items-center gap-1.5 mx-1 my-1 px-2.5 py-1 rounded-md border border-[var(--border-subtle)] bg-transparent cursor-pointer text-left font-[inherit] hover:bg-bg-hover/50 w-[calc(100%-0.5rem)]"
        >
          <Check size={11} className="text-diff-added shrink-0" />
          <span className="text-[10px] text-text-tertiary">
            Show {comments.length} resolved {comments.length === 1 ? "comment" : "comments"}
          </span>
          <ChevronRight size={10} className="text-text-tertiary ml-auto shrink-0" />
        </button>
      );
    }

    return (
      <button
        onClick={onToggle}
        className="group/preview flex items-center gap-1.5 mx-1 my-[3px] px-2.5 py-[5px] rounded-sm max-w-[720px] w-[calc(100%-0.5rem)] cursor-pointer text-left font-[inherit] border border-[var(--color-pr-comment,#60a5fa)]/20 border-l-2 border-l-[var(--color-pr-comment,#60a5fa)]/50 hover:border-[var(--color-pr-comment,#60a5fa)]/35 transition-colors"
        style={{ background: "color-mix(in srgb, var(--color-pr-comment, #60a5fa) 6%, transparent)" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--color-pr-comment, #60a5fa) 10%, transparent)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--color-pr-comment, #60a5fa) 6%, transparent)"; }}
      >
        <ChevronRight size={10} className="text-text-tertiary shrink-0" />
        {/* Avatar(s) */}
        {uniqueAuthors.length === 1 ? (
          <span className="w-[18px] h-[18px] rounded-full bg-bg-hover flex items-center justify-center text-[9px] font-bold text-text-primary shrink-0">
            {initial}
          </span>
        ) : (
          <span className="flex shrink-0">
            {uniqueAuthors.slice(0, 3).map((author, i) => (
              <span
                key={author}
                className="w-[18px] h-[18px] rounded-full bg-bg-hover flex items-center justify-center text-[9px] font-bold text-text-primary border-[1.5px] border-bg-primary"
                style={{ marginLeft: i > 0 ? -6 : 0 }}
              >
                {author.charAt(0).toUpperCase()}
              </span>
            ))}
          </span>
        )}
        <span className="flex-1 text-[11px] text-text-secondary truncate">
          {previewText}
        </span>
        {comments.length > 1 ? (
          <span className="text-[10px] text-accent-primary shrink-0">
            {comments.length} comments
          </span>
        ) : (
          <span className="text-[10px] text-text-tertiary shrink-0">
            {formatTimeAgo(firstComment.createdAt)}
          </span>
        )}
      </button>
    );
  }

  // ── Expanded: full thread ──
  return (
    <div className={`border border-[var(--color-pr-comment,#60a5fa)]/40 border-l-2 border-l-[var(--color-pr-comment,#60a5fa)]/60 rounded-md mx-1 my-[3px] overflow-hidden max-w-[720px] ${allResolved ? "opacity-60" : ""}`}>
      {comments.map((comment, i) => (
        <div key={comment.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
          {/* Header bar */}
          <div
            onClick={i === 0 ? onToggle : undefined}
            className={[
              "flex items-center gap-1.5 px-2.5 py-1.5 border-b border-[var(--border-subtle)]",
              i === 0 ? "cursor-pointer" : "",
            ].join(" ")}
            style={{
              background: i === 0
                ? "color-mix(in srgb, var(--color-pr-comment, #60a5fa) 12%, transparent)"
                : "color-mix(in srgb, var(--color-pr-comment, #60a5fa) 8%, transparent)",
            }}
          >
            <GitPullRequest size={12} className="flex-shrink-0 text-[var(--color-pr-comment)]" />
            <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-pr-comment)]">
              PR
            </span>
            <span className="text-[11px] text-text-secondary font-medium">
              @{comment.author}
            </span>
            <span className="text-[10px] text-text-tertiary">
              {formatTimeAgo(comment.createdAt)}
            </span>
            <div className="ml-auto flex items-center gap-1">
              {onSendToClaude && (
                <Tooltip content="Send to Claude">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSendToClaude(comment);
                    }}
                    className="p-1 rounded hover:bg-[var(--bg-hover)] transition-colors cursor-pointer bg-transparent border-none text-text-tertiary hover:text-accent-primary"
                    aria-label="Send to Claude"
                  >
                    <ClaudeIcon size={12} />
                  </button>
                </Tooltip>
              )}
              <Tooltip content="Open on GitHub">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openUrl(comment.htmlUrl).catch(console.error);
                  }}
                  className="p-1 rounded text-text-tertiary hover:text-[var(--color-pr-comment)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer bg-transparent border-none"
                  aria-label="Open on GitHub"
                >
                  <ExternalLink size={12} />
                </button>
              </Tooltip>
              {/* Collapse button — only on first comment header */}
              {i === 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle();
                  }}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover border border-transparent hover:border-border-default transition-colors cursor-pointer bg-transparent font-[inherit] shrink-0"
                  aria-label="Collapse thread"
                >
                  <ChevronUp size={10} />
                  Collapse
                </button>
              )}
            </div>
          </div>
          {/* Body */}
          <div className="px-2.5 py-2 bg-[var(--bg-elevated)]">
            <MarkdownBody text={comment.body} />
          </div>
        </div>
      ))}
    </div>
  );
}

export { DiffCommentThread };
export type { DiffCommentThreadProps };

import { Bot, ExternalLink, GitPullRequest } from "lucide-react";
import type { PrComment } from "../../types";
import { MarkdownBody } from "../shared/MarkdownBody";

interface DiffCommentThreadProps {
  comments: PrComment[];
  onSendToClaude?: (comment: PrComment) => void;
}

function DiffCommentThread({ comments, onSendToClaude }: DiffCommentThreadProps) {
  return (
    <div className="border border-[var(--color-pr-comment,#60a5fa)]/25 rounded-md mx-2 my-1 overflow-hidden">
      {comments.map((comment) => (
        <div key={comment.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
          {/* Header bar */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-[var(--border-subtle)]"
            style={{ background: "color-mix(in srgb, var(--color-pr-comment, #60a5fa) 8%, transparent)" }}
          >
            <GitPullRequest size={12} className="flex-shrink-0" style={{ color: "var(--color-pr-comment)" }} />
            <span
              className="text-[10px] font-medium uppercase tracking-wide"
              style={{ color: "var(--color-pr-comment)" }}
            >
              PR
            </span>
            <span className="text-[11px] text-text-secondary font-medium">
              @{comment.author}
            </span>
            <span className="text-[10px] text-text-tertiary">
              {new Date(comment.createdAt).toLocaleDateString()}
            </span>
            <div className="ml-auto flex items-center gap-1">
              {onSendToClaude && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSendToClaude(comment);
                  }}
                  className="p-0.5 rounded hover:bg-[var(--bg-hover)] transition-colors cursor-pointer bg-transparent border-none"
                  style={{ color: "var(--text-tertiary)" }}
                  aria-label="Send to Claude"
                >
                  <Bot size={12} />
                </button>
              )}
              <a
                href={comment.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-0.5 rounded text-text-tertiary hover:text-[var(--color-pr-comment)] transition-colors"
              >
                <ExternalLink size={12} />
              </a>
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

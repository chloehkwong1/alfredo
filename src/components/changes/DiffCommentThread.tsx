import { Bot, ExternalLink, GitPullRequest } from "lucide-react";
import type { PrComment } from "../../types";

interface DiffCommentThreadProps {
  comments: PrComment[];
  onSendToClaude?: (comment: PrComment) => void;
}

function DiffCommentThread({ comments, onSendToClaude }: DiffCommentThreadProps) {
  return (
    <div className="bg-bg-surface border border-border-subtle rounded mx-2 my-1 p-3">
      {comments.map((comment) => (
        <div key={comment.id} className="mb-2 last:mb-0">
          <div className="flex items-center gap-2 text-xs">
            <GitPullRequest size={12} className="flex-shrink-0 text-text-tertiary" />
            <span className="text-[10px] font-medium text-text-tertiary uppercase tracking-wide">
              PR
            </span>
            <span className="text-text-secondary font-medium">
              @{comment.author}
            </span>
            <span className="text-text-tertiary">
              {new Date(comment.createdAt).toLocaleDateString()}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              {onSendToClaude && (
                <button
                  className="text-text-tertiary hover:text-accent-primary bg-transparent border-none p-0 cursor-pointer leading-none"
                  title="Send to Claude"
                  onClick={() => onSendToClaude(comment)}
                >
                  <Bot className="h-2.5 w-2.5" />
                </button>
              )}
              <a
                href={comment.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-tertiary hover:text-accent-primary"
              >
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
          </div>
          <p className="text-xs text-text-secondary mt-1 whitespace-pre-wrap">
            {comment.body}
          </p>
        </div>
      ))}
    </div>
  );
}

export { DiffCommentThread };

// src/components/changes/DiffCommentThread.tsx
import { ExternalLink } from "lucide-react";
import type { PrComment } from "../../types";

interface DiffCommentThreadProps {
  comments: PrComment[];
}

function DiffCommentThread({ comments }: DiffCommentThreadProps) {
  return (
    <div className="bg-bg-surface border border-border-subtle rounded mx-2 my-1 p-3">
      {comments.map((comment) => (
        <div key={comment.id} className="mb-2 last:mb-0">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-text-secondary font-medium">
              @{comment.author}
            </span>
            <span className="text-text-tertiary">
              {new Date(comment.createdAt).toLocaleDateString()}
            </span>
            <a
              href={comment.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-text-tertiary hover:text-accent-primary"
            >
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
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

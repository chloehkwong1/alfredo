import { MessageCircle, ExternalLink } from "lucide-react";
import { CollapsibleSection } from "./CollapsibleSection";
import type { PrComment } from "../../types";

interface PrCommentsSectionProps {
  comments: PrComment[];
  onJumpToComment?: (comment: PrComment) => void;
}

/** Strip HTML comments and collapse leading/trailing whitespace */
function cleanBody(raw: string): string {
  return raw.replace(/<!--[\s\S]*?-->/g, "").replace(/<details>[\s\S]*?<\/details>/g, "").trim();
}

function PrCommentsSection({ comments, onJumpToComment }: PrCommentsSectionProps) {
  const generalComments = comments.filter((c) => !c.path);
  const lineComments = comments.filter((c) => c.path);

  const badge = comments.length > 0 ? (
    <span className="text-2xs text-text-tertiary">{comments.length}</span>
  ) : null;

  return (
    <CollapsibleSection title="Comments" badge={badge} defaultOpen={comments.length > 0}>
      {comments.length === 0 ? (
        <div className="text-sm text-text-tertiary py-2">No comments</div>
      ) : (
        <div className="space-y-4">
          {generalComments.length > 0 && (
            <div className="space-y-3">
              {generalComments.map((comment) => (
                <div key={comment.id} className="border-l-2 border-border-subtle pl-3 py-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-text-secondary font-medium">@{comment.author}</span>
                  </div>
                  <p className="text-xs text-text-tertiary mt-1 line-clamp-2">{cleanBody(comment.body)}</p>
                  <a
                    href={comment.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-2xs text-accent-primary hover:text-accent-hover flex items-center gap-1 mt-0.5"
                  >
                    Open on GitHub <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
              ))}
            </div>
          )}

          {lineComments.length > 0 && (
            <div className="space-y-3">
              {lineComments.map((comment) => (
                <div
                  key={comment.id}
                  className="border-l-2 border-border-subtle pl-3 py-1 cursor-pointer hover:border-accent-primary transition-colors"
                  onClick={() => onJumpToComment?.(comment)}
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-text-secondary font-medium">@{comment.author}</span>
                    <span className="text-text-tertiary truncate">
                      {comment.path}{comment.line != null && `:${comment.line}`}
                    </span>
                  </div>
                  <p className="text-xs text-text-tertiary mt-1 line-clamp-2">{cleanBody(comment.body)}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-2xs text-accent-primary flex items-center gap-1">
                      <MessageCircle className="h-2.5 w-2.5" /> Jump to diff
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}

export { PrCommentsSection };

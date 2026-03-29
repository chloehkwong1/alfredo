import { X } from "lucide-react";
import type { Annotation } from "../../types";
import { formatRelativeTime } from "./formatRelativeTime";

interface AnnotationBubbleProps {
  annotation: Annotation;
  onDelete: (id: string) => void;
}

function AnnotationBubble({ annotation, onDelete }: AnnotationBubbleProps) {
  return (
    <div className="my-1 border-l-2 border-accent-primary bg-[#161b22] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-primary/5 border-b border-border-subtle">
        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent-primary text-text-on-accent text-2xs font-semibold flex items-center justify-center">
          C
        </span>
        <span className="text-xs font-semibold text-text-primary">You</span>
        <span className="text-[10px] text-text-tertiary">
          {formatRelativeTime(annotation.createdAt / 1000)}
        </span>
        <span className="text-[10px] text-text-tertiary">· pending</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(annotation.id);
          }}
          className="ml-auto flex-shrink-0 p-0.5 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors cursor-pointer bg-transparent border-none"
          aria-label="Delete comment"
        >
          <X size={12} />
        </button>
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        <p className="text-xs text-text-secondary leading-relaxed m-0">{annotation.text}</p>
      </div>
    </div>
  );
}

export { AnnotationBubble };
export type { AnnotationBubbleProps };

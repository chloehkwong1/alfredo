import { X } from "lucide-react";
import type { Annotation } from "../../types";

interface AnnotationBubbleProps {
  annotation: Annotation;
  onDelete: (id: string) => void;
}

function AnnotationBubble({ annotation, onDelete }: AnnotationBubbleProps) {
  return (
    <div className="ml-24 mr-4 my-1 flex items-start gap-2 px-3 py-1.5 rounded-md bg-accent-primary/10 border border-accent-primary/20">
      {/* Avatar */}
      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent-primary text-text-on-accent text-[10px] font-semibold flex items-center justify-center mt-0.5">
        C
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-text-primary">{annotation.text}</p>
        <p className="text-[10px] text-text-tertiary mt-0.5">
          annotations attach to your next terminal message
        </p>
      </div>

      {/* Delete */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(annotation.id);
        }}
        className="flex-shrink-0 p-0.5 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
        aria-label="Delete annotation"
      >
        <X size={12} />
      </button>
    </div>
  );
}

export { AnnotationBubble };
export type { AnnotationBubbleProps };

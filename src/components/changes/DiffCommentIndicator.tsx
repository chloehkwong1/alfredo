// src/components/changes/DiffCommentIndicator.tsx
import { MessageCircle } from "lucide-react";

interface DiffCommentIndicatorProps {
  count: number;
  onClick: () => void;
}

function DiffCommentIndicator({ count, onClick }: DiffCommentIndicatorProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-0.5 text-accent-primary hover:text-accent-hover"
      title={`${count} comment${count > 1 ? "s" : ""}`}
    >
      <MessageCircle className="h-3 w-3" />
      {count > 1 && <span className="text-2xs">{count}</span>}
    </button>
  );
}

export { DiffCommentIndicator };

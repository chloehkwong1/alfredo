import { Button } from "../ui/Button";

interface AnnotationBarProps {
  count: number;
  onClearAll: () => void;
  onSendToClaude: () => void;
}

function AnnotationBar({ count, onClearAll, onSendToClaude }: AnnotationBarProps) {
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-4 py-2 bg-bg-primary border border-accent-primary/30 rounded-lg shadow-lg">
      <div className="flex items-center gap-2">
        <span className="bg-accent-primary text-text-on-accent text-[11px] font-bold px-2 py-0.5 rounded-full">
          {count}
        </span>
        <span className="text-xs text-text-secondary">
          review comment{count !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={onClearAll}>
          Clear all
        </Button>
        <Button size="sm" variant="primary" onClick={onSendToClaude}>
          Send to agent ⏎
        </Button>
      </div>
    </div>
  );
}

export { AnnotationBar };
export type { AnnotationBarProps };

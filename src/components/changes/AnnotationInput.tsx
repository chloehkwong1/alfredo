import { useEffect, useRef, useState } from "react";

interface AnnotationInputProps {
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

function AnnotationInput({ onSubmit, onCancel }: AnnotationInputProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && text.trim()) {
      e.preventDefault();
      onSubmit(text.trim());
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div className="my-1 border-l-2 border-accent-primary bg-[#161b22] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-primary/5 border-b border-border-subtle">
        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent-primary text-text-on-accent text-2xs font-semibold flex items-center justify-center">
          C
        </span>
        <span className="text-xs font-semibold text-text-primary">You</span>
      </div>

      {/* Input area */}
      <div className="px-3 py-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Leave a comment for the agent..."
          rows={3}
          className="w-full px-2.5 py-2 rounded-md text-xs bg-bg-primary border border-border-default text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent-primary/40 focus:ring-1 focus:ring-accent-primary/20 resize-y leading-relaxed"
        />
        <div className="flex justify-end gap-1.5 mt-1.5">
          <button
            onClick={onCancel}
            className="px-2.5 py-1 rounded-md text-[11px] text-text-secondary bg-transparent border border-border-default hover:bg-bg-hover cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => text.trim() && onSubmit(text.trim())}
            disabled={!text.trim()}
            className="px-2.5 py-1 rounded-md text-[11px] font-semibold text-text-on-accent bg-accent-primary hover:bg-accent-hover cursor-pointer border-none disabled:opacity-40 disabled:cursor-default"
          >
            Comment
          </button>
        </div>
      </div>
    </div>
  );
}

export { AnnotationInput };
export type { AnnotationInputProps };

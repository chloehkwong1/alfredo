import { useEffect, useRef, useState } from "react";
import { useAppConfig } from "../../hooks/useAppConfig";
import { CommentChipStrip } from "./CommentChipStrip";
import { CommentChipAddPopover } from "./CommentChipAddPopover";
import { CommentChipContextMenu } from "./CommentChipContextMenu";

interface AnnotationInputProps {
  filePath: string;
  lineNumber: number;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  onSubmitReview?: (text: string) => void;
}

function AnnotationInput({ filePath, lineNumber, onSubmit, onCancel, onSubmitReview }: AnnotationInputProps) {
  const fileName = filePath.split("/").pop() ?? filePath;
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const addChipButtonRef = useRef<HTMLButtonElement>(null);
  const { config, setCommentChips } = useAppConfig();
  const chips = config?.commentChips ?? [];
  const [chipPopoverOpen, setChipPopoverOpen] = useState(false);
  const [chipContextMenu, setChipContextMenu] = useState<{
    index: number;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && e.shiftKey && text.trim() && onSubmitReview) {
      e.preventDefault();
      onSubmitReview(text.trim());
    } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && text.trim()) {
      e.preventDefault();
      onSubmit(text.trim());
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  function handleInsert(chipText: string) {
    const next = text.length === 0 ? chipText : `${text}\n\n${chipText}`;
    setText(next);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  }

  return (
    <div className="my-1 border-l-2 border-accent-primary bg-bg-elevated overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-primary/5 border-b border-border-subtle">
        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent-primary text-text-on-accent text-2xs font-semibold flex items-center justify-center">
          C
        </span>
        <span className="text-xs font-semibold text-text-primary">You</span>
        <span
          className="text-2xs font-mono text-text-tertiary truncate"
          title={`${filePath}:${lineNumber}`}
        >
          {fileName}:{lineNumber}
        </span>
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
        <div className="flex items-center gap-2 mt-1.5">
          <CommentChipStrip
            chips={chips}
            onInsert={handleInsert}
            addButtonRef={addChipButtonRef}
            onAdd={() => setChipPopoverOpen(true)}
            onEditChip={(index, e) =>
              setChipContextMenu({ index, x: e.clientX, y: e.clientY })
            }
          />
          <div className="flex gap-1.5 flex-shrink-0">
            <button
              onClick={onCancel}
              className="px-2.5 py-1 rounded-md text-[11px] text-text-secondary bg-transparent border border-border-default hover:bg-bg-hover cursor-pointer"
            >
              Cancel
            </button>
            {onSubmitReview && (
              <button
                onClick={() => text.trim() && onSubmitReview(text.trim())}
                disabled={!text.trim()}
                title="Add to review (Cmd/Ctrl+Shift+Enter)"
                className="px-2.5 py-1 rounded-md text-[11px] font-semibold text-accent-primary bg-transparent border border-accent-primary/40 hover:bg-accent-primary/10 cursor-pointer disabled:opacity-40 disabled:cursor-default"
              >
                Add to review
              </button>
            )}
            <button
              onClick={() => text.trim() && onSubmit(text.trim())}
              disabled={!text.trim()}
              title="Comment for the agent (Cmd/Ctrl+Enter)"
              className="px-2.5 py-1 rounded-md text-[11px] font-semibold text-text-on-accent bg-accent-primary hover:bg-accent-hover cursor-pointer border-none disabled:opacity-40 disabled:cursor-default"
            >
              Comment
            </button>
          </div>
        </div>
        {chips.length >= 1 && (
          <div className="text-[10px] text-text-tertiary mt-1.5 pl-0.5">
            Tip — right-click a chip to edit it.
          </div>
        )}
      </div>
      {chipPopoverOpen && (
        <CommentChipAddPopover
          anchorRef={addChipButtonRef}
          existingChips={chips}
          onSave={(newChips) => {
            void setCommentChips(newChips);
            setChipPopoverOpen(false);
          }}
          onClose={() => setChipPopoverOpen(false)}
        />
      )}
      {chipContextMenu && (
        <CommentChipContextMenu
          position={{ x: chipContextMenu.x, y: chipContextMenu.y }}
          chipIndex={chipContextMenu.index}
          onClose={() => setChipContextMenu(null)}
        />
      )}
    </div>
  );
}

export { AnnotationInput };
export type { AnnotationInputProps };

import { useState } from "react";
import { Pencil, StickyNote, X } from "lucide-react";
import type { Annotation } from "../../types";
import { formatRelativeTime } from "./formatRelativeTime";

interface AnnotationBubbleProps {
  annotation: Annotation;
  onDelete: (id: string) => void;
  onEdit: (id: string, newText: string) => void;
}

function AnnotationBubble({ annotation, onDelete, onEdit }: AnnotationBubbleProps) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(annotation.text);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && editText.trim()) {
      e.preventDefault();
      onEdit(annotation.id, editText.trim());
      setEditing(false);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditText(annotation.text);
      setEditing(false);
    }
  }

  return (
    <div className="my-1 border-l-2 border-accent-primary bg-bg-elevated overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-primary/5 border-b border-border-subtle">
        <StickyNote size={12} className="flex-shrink-0 text-accent-primary" />
        <span className="text-[10px] font-medium text-accent-primary uppercase tracking-wide">
          Note
        </span>
        <span className="text-[10px] text-text-tertiary">
          {formatRelativeTime(annotation.createdAt / 1000)}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            className="flex-shrink-0 p-0.5 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors cursor-pointer bg-transparent border-none"
            aria-label="Edit comment"
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(annotation.id);
            }}
            className="flex-shrink-0 p-0.5 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors cursor-pointer bg-transparent border-none"
            aria-label="Delete comment"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        {editing ? (
          <>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
              autoFocus
              className="w-full px-2.5 py-2 rounded-md text-xs bg-bg-primary border border-border-default text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent-primary/40 focus:ring-1 focus:ring-accent-primary/20 resize-y leading-relaxed"
            />
            <div className="flex justify-end gap-1.5 mt-1.5">
              <button
                onClick={() => {
                  setEditText(annotation.text);
                  setEditing(false);
                }}
                className="px-2.5 py-1 rounded-md text-[11px] text-text-secondary bg-transparent border border-border-default hover:bg-bg-hover cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (editText.trim()) {
                    onEdit(annotation.id, editText.trim());
                    setEditing(false);
                  }
                }}
                disabled={!editText.trim()}
                className="px-2.5 py-1 rounded-md text-[11px] font-semibold text-text-on-accent bg-accent-primary hover:bg-accent-hover cursor-pointer border-none disabled:opacity-40 disabled:cursor-default"
              >
                Save
              </button>
            </div>
          </>
        ) : (
          <p className="text-xs text-text-secondary leading-relaxed m-0">{annotation.text}</p>
        )}
      </div>
    </div>
  );
}

export { AnnotationBubble };
export type { AnnotationBubbleProps };

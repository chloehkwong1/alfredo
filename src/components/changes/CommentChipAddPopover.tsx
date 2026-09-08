import { RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPopoverPosition } from "./useAnchoredPopoverPosition";

interface CommentChipAddPopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  existingChips: string[];
  onSave: (newChips: string[]) => void;
  onClose: () => void;
}

function CommentChipAddPopover({
  anchorRef,
  existingChips,
  onSave,
  onClose,
}: CommentChipAddPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const position = useAnchoredPopoverPosition(anchorRef, popoverRef);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [anchorRef, onClose]);

  function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) {
      onClose();
      return;
    }
    onSave([...existingChips, trimmed]);
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      style={{
        position: "fixed",
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        visibility: position ? "visible" : "hidden",
        zIndex: 60,
      }}
      className="w-[260px] p-2 rounded-[var(--radius-lg)] bg-bg-elevated border border-border-default shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="New chip text..."
        className="w-full px-2 py-1.5 rounded-md text-xs bg-bg-primary border border-border-default text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent-primary/40 focus:ring-1 focus:ring-accent-primary/20"
      />
      <div className="flex justify-end gap-1.5 mt-2">
        <button
          type="button"
          onClick={onClose}
          className="px-2.5 py-1 rounded-md text-[11px] text-text-secondary bg-transparent border border-border-default hover:bg-bg-hover cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!value.trim()}
          className="px-2.5 py-1 rounded-md text-[11px] font-semibold text-text-on-accent bg-accent-primary hover:bg-accent-hover cursor-pointer border-none disabled:opacity-40 disabled:cursor-default"
        >
          Save
        </button>
      </div>
    </div>,
    document.body,
  );
}

export { CommentChipAddPopover };
export type { CommentChipAddPopoverProps };

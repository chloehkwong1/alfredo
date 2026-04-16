import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface CommentChipContextMenuProps {
  position: { x: number; y: number };
  chipIndex: number;
  onClose: () => void;
}

function CommentChipContextMenu({
  position,
  chipIndex,
  onClose,
}: CommentChipContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjusted, setAdjusted] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = position.x;
    let top = position.y;
    if (left + rect.width > window.innerWidth - 8) {
      left = window.innerWidth - rect.width - 8;
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = window.innerHeight - rect.height - 8;
    }
    setAdjusted({ top, left });
  }, [position.x, position.y]);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function handleEdit() {
    window.dispatchEvent(
      new CustomEvent("open-global-settings", {
        detail: { section: "comment-chips", focusIndex: chipIndex },
      }),
    );
    onClose();
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: "fixed",
        top: adjusted?.top ?? position.y,
        left: adjusted?.left ?? position.x,
        visibility: adjusted ? "visible" : "hidden",
        zIndex: 60,
      }}
      className="min-w-[200px] p-1 rounded-[var(--radius-lg)] bg-bg-elevated border border-border-default shadow-lg"
    >
      <button
        type="button"
        role="menuitem"
        onClick={handleEdit}
        className="w-full text-left flex flex-col gap-0.5 px-2 py-1.5 rounded-[var(--radius-sm)] bg-transparent border-none cursor-pointer hover:bg-bg-hover"
      >
        <span className="text-sm text-text-primary">Edit chip</span>
        <span className="text-[10px] text-text-tertiary">
          Opens Global Settings → Comment Chips
        </span>
      </button>
    </div>,
    document.body,
  );
}

export { CommentChipContextMenu };
export type { CommentChipContextMenuProps };

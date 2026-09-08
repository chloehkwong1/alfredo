import { lazy, RefObject, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const Picker = lazy(() => import("@emoji-mart/react"));

interface EmojiPickerPopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  onPick: (native: string) => void;
  onClose: () => void;
}

function EmojiPickerPopover({ anchorRef, onPick, onClose }: EmojiPickerPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<unknown>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    import("@emoji-mart/data").then((m) => setData(m.default));
  }, []);

  useLayoutEffect(() => {
    function reposition() {
      const anchor = anchorRef.current;
      const popover = popoverRef.current;
      if (!anchor || !popover) return;
      const anchorRect = anchor.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const margin = 6;
      let top = anchorRect.top - popoverRect.height - margin;
      if (top < 8) {
        top = anchorRect.bottom + margin;
      }
      let left = anchorRect.left + anchorRect.width / 2 - popoverRect.width / 2;
      const maxLeft = window.innerWidth - popoverRect.width - 8;
      if (left > maxLeft) left = maxLeft;
      if (left < 8) left = 8;
      setPosition({ top, left });
    }
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [anchorRef, data]);

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

  function handlePick(emoji: { native: string }) {
    onPick(emoji.native);
    onClose();
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
      className="rounded-[var(--radius-lg)] overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <Suspense fallback={<div className="p-4 text-[11px] text-text-tertiary">Loading…</div>}>
        {Boolean(data) && (
          <Picker data={data} onEmojiSelect={handlePick} theme="auto" previewPosition="none" />
        )}
      </Suspense>
    </div>,
    document.body,
  );
}

export { EmojiPickerPopover };
export type { EmojiPickerPopoverProps };

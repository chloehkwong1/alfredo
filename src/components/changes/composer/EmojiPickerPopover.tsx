import { lazy, RefObject, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPopoverPosition } from "../useAnchoredPopoverPosition";

const Picker = lazy(() => import("@emoji-mart/react"));

interface EmojiPickerPopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  onPick: (native: string) => void;
  onClose: () => void;
}

function EmojiPickerPopover({ anchorRef, onPick, onClose }: EmojiPickerPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<unknown>(null);
  const position = useAnchoredPopoverPosition(anchorRef, popoverRef);

  useEffect(() => {
    import("@emoji-mart/data").then((m) => setData(m.default));
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

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface PulseHighlightProps {
  target: HTMLElement;
  onDone: () => void;
}

export function PulseHighlight({ target, onDone }: PulseHighlightProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
    const nextRect = target.getBoundingClientRect();
    setRect(nextRect);

    // Skip the scale-bump on large surfaces (e.g. the terminal pane) — scaling a
    // huge container jumps all its content and reads as a layout bug rather than
    // a hint. Ring pulse alone is enough there.
    const shouldScale = nextRect.width < 400 && nextRect.height < 300;
    const originalTransform = target.style.transform;
    const originalTransition = target.style.transition;
    let scaleDown: number | undefined;
    let cleanupTransition: number | undefined;
    if (shouldScale) {
      target.style.transition = "transform 200ms ease-out";
      target.style.transform = "scale(1.06)";
      scaleDown = window.setTimeout(() => {
        target.style.transform = originalTransform;
      }, 220);
      cleanupTransition = window.setTimeout(() => {
        target.style.transition = originalTransition;
      }, 500);
    }

    const done = window.setTimeout(onDone, 3700);

    return () => {
      if (scaleDown !== undefined) window.clearTimeout(scaleDown);
      if (cleanupTransition !== undefined) window.clearTimeout(cleanupTransition);
      window.clearTimeout(done);
      if (shouldScale) {
        target.style.transform = originalTransform;
        target.style.transition = originalTransition;
      }
    };
  }, [target, onDone]);

  if (!rect) return null;

  return createPortal(
    <div
      aria-hidden
      style={{
        position: "fixed",
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        borderRadius: 8,
        pointerEvents: "none",
        animation: "tour-pulse 1.2s ease-out 3",
        zIndex: 9998,
      }}
    />,
    document.body,
  );
}

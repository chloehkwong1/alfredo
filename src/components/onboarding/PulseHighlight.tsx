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
    setRect(target.getBoundingClientRect());

    const originalTransform = target.style.transform;
    const originalTransition = target.style.transition;
    target.style.transition = "transform 200ms ease-out";
    target.style.transform = "scale(1.06)";
    const scaleDown = window.setTimeout(() => {
      target.style.transform = originalTransform;
    }, 220);
    const cleanupTransition = window.setTimeout(() => {
      target.style.transition = originalTransition;
    }, 500);

    const done = window.setTimeout(onDone, 3700);

    return () => {
      window.clearTimeout(scaleDown);
      window.clearTimeout(cleanupTransition);
      window.clearTimeout(done);
      target.style.transform = originalTransform;
      target.style.transition = originalTransition;
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

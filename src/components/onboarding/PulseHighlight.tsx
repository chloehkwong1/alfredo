import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface PulseHighlightProps {
  target: HTMLElement;
  onDone: () => void;
}

export function PulseHighlight({ target, onDone }: PulseHighlightProps) {
  const [rect] = useState(() => target.getBoundingClientRect());

  useEffect(() => {
    const timeout = window.setTimeout(onDone, 2900);
    return () => window.clearTimeout(timeout);
  }, [onDone]);

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
        animation: "tour-pulse 1.4s ease-out 2",
        zIndex: 9998,
      }}
    />,
    document.body,
  );
}

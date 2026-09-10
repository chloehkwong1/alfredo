import { RefObject, useLayoutEffect, useState } from "react";

/** Fixed-position coordinates for a portal popover anchored to an element:
 *  centred above the anchor, flipping below when there's no headroom, clamped
 *  to the viewport. Tracks window resize/scroll and the popover's own size
 *  (a ResizeObserver covers content that loads or reflows after mount, e.g.
 *  a lazy picker or a populating results grid). Null until first measure —
 *  render the popover hidden/off-screen while null. */
export function useAnchoredPopoverPosition(
  anchorRef: RefObject<HTMLElement | null>,
  popoverRef: RefObject<HTMLDivElement | null>,
): { top: number; left: number } | null {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

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
    const popover = popoverRef.current;
    const resizeObserver = popover ? new ResizeObserver(reposition) : null;
    if (popover) resizeObserver?.observe(popover);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      resizeObserver?.disconnect();
    };
  }, [anchorRef, popoverRef]);

  return position;
}

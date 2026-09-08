import { RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { searchGifs } from "../../../api";
import type { GifResult } from "../../../types";

interface GifPickerPopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  onPick: (gif: GifResult) => void;
  onClose: () => void;
}

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "results"; gifs: GifResult[] };

const DEBOUNCE_MS = 300;

function GifPickerPopover({ anchorRef, onPick, onClose }: GifPickerPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<FetchState>({ kind: "idle" });
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const queryRef = useRef(query);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
    // Content-driven size changes (e.g. GIF result grid populating) can land
    // after this effect runs — re-run reposition then so the popover doesn't
    // stay pinned to a stale size.
    const popover = popoverRef.current;
    const resizeObserver = popover ? new ResizeObserver(reposition) : null;
    if (popover) resizeObserver?.observe(popover);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      resizeObserver?.disconnect();
    };
  }, [anchorRef, state]);

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

  useEffect(() => {
    queryRef.current = query;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      setState({ kind: "idle" });
      return;
    }
    debounceRef.current = setTimeout(() => {
      setState({ kind: "loading" });
      searchGifs(trimmed)
        .then((gifs) => {
          if (queryRef.current.trim() !== trimmed) return; // stale response
          setState(gifs.length === 0 ? { kind: "empty" } : { kind: "results", gifs });
        })
        .catch((e) => {
          if (queryRef.current.trim() !== trimmed) return;
          setState({ kind: "error", message: String(e) });
        });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  function handlePick(gif: GifResult) {
    onPick(gif);
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
      className="w-[320px] p-2 rounded-[var(--radius-lg)] bg-bg-elevated border border-border-default shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search Giphy..."
        className="w-full px-2 py-1.5 rounded-md text-xs bg-bg-primary border border-border-default text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent-primary/40 focus:ring-1 focus:ring-accent-primary/20"
      />
      <div className="mt-2 min-h-[64px] max-h-64 overflow-y-auto">
        {state.kind === "idle" && (
          <div className="p-2 text-[11px] text-text-tertiary">Search Giphy…</div>
        )}
        {state.kind === "loading" && (
          <div className="p-2 text-[11px] text-text-tertiary">Searching…</div>
        )}
        {state.kind === "error" && (
          <div className="p-2 text-[11px] text-red-400">{state.message}</div>
        )}
        {state.kind === "empty" && (
          <div className="p-2 text-[11px] text-text-tertiary">No GIFs found</div>
        )}
        {state.kind === "results" && (
          <div className="grid grid-cols-3 gap-1">
            {state.gifs.map((gif) => (
              <button
                key={gif.url}
                type="button"
                onClick={() => handlePick(gif)}
                className="aspect-video overflow-hidden rounded-md border border-border-default hover:border-border-hover bg-bg-primary cursor-pointer"
              >
                <img src={gif.previewUrl} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-1.5 text-right text-[9px] text-text-tertiary">Powered by GIPHY</div>
    </div>,
    document.body,
  );
}

export { GifPickerPopover };
export type { GifPickerPopoverProps };

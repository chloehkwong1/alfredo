import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiffFile } from "../types";
import { useLayoutStore } from "../stores/layoutStore";

export interface SearchMatch {
  filePath: string;
  hunkIndex: number;
  lineIndex: number;
}

const EMPTY_MATCHES: SearchMatch[] = [];

export function useDiffSearch(
  displayFiles: DiffFile[],
  setCollapsedFiles: React.Dispatch<React.SetStateAction<Set<string>>>,
  setActiveFilePath: (path: string | null) => void,
  containerRef: React.RefObject<HTMLElement | null>,
  worktreeId: string,
  paneId: string,
) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Debounce the search query so match computation doesn't block every keystroke.
  // The raw searchQuery is still passed to components for immediate visual highlights.
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    if (!searchQuery) {
      setDebouncedQuery("");
      return;
    }
    const id = setTimeout(() => setDebouncedQuery(searchQuery), 150);
    return () => clearTimeout(id);
  }, [searchQuery]);

  const matches = useMemo(() => {
    if (!debouncedQuery) return EMPTY_MATCHES;
    const result: SearchMatch[] = [];
    const lq = debouncedQuery.toLowerCase();
    for (const file of displayFiles) {
      for (let hi = 0; hi < file.hunks.length; hi++) {
        for (let li = 0; li < file.hunks[hi].lines.length; li++) {
          if (file.hunks[hi].lines[li].content.toLowerCase().includes(lq)) {
            result.push({ filePath: file.path, hunkIndex: hi, lineIndex: li });
          }
        }
      }
    }
    return result;
  }, [displayFiles, debouncedQuery]);

  // Reset match index when query changes
  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [debouncedQuery]);

  const navigateMatch = useCallback(
    (direction: "next" | "prev") => {
      if (matches.length === 0) return;
      const newIndex =
        direction === "next"
          ? (currentMatchIndex + 1) % matches.length
          : (currentMatchIndex - 1 + matches.length) % matches.length;
      setCurrentMatchIndex(newIndex);

      const match = matches[newIndex];
      // Expand the file if collapsed
      setCollapsedFiles((prev) => {
        if (!prev.has(match.filePath)) return prev;
        const next = new Set(prev);
        next.delete(match.filePath);
        return next;
      });
      setActiveFilePath(match.filePath);

      // Scroll to the active match after render
      requestAnimationFrame(() => {
        const el = document.getElementById("active-search-match");
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    [matches, currentMatchIndex, setCollapsedFiles, setActiveFilePath],
  );

  // Keyboard: "/" to open search, Escape to close, Enter/Shift+Enter to navigate.
  // Scoped to the owning ChangesView subtree so Cmd+F pressed in a terminal
  // (or any other pane) doesn't steal focus into the diff search here.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    function handleSearchKeys(e: KeyboardEvent) {
      const inScope =
        root!.contains(document.activeElement) || searchOpen;
      if (!inScope) return;

      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA";

      // "/" to open search (when not in an input), or Cmd/Ctrl+F within scope
      if (
        (e.key === "/" && !isInput) ||
        ((e.metaKey || e.ctrlKey) && e.key === "f")
      ) {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }

      // Escape to close search
      if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
        setSearchQuery("");
        return;
      }

      // Enter / Shift+Enter to navigate matches (when search input is focused)
      if (
        e.key === "Enter" &&
        document.activeElement === searchInputRef.current
      ) {
        e.preventDefault();
        navigateMatch(e.shiftKey ? "prev" : "next");
      }
    }

    // Companion to FileSidebar's Cmd+F handler: when the user is viewing a
    // commit, FileSidebar dispatches alfredo:open-diff-search instead of
    // bailing silently (the keydown listener above can't reach FileSidebar
    // since it's a sibling subtree). Only the ChangesView in the currently
    // active pane should claim the event so split layouts don't double-open.
    function handleOpenDiffSearch() {
      const activePaneId = useLayoutStore.getState().activePaneId[worktreeId];
      if (activePaneId !== paneId) return;
      setSearchOpen(true);
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }

    root.addEventListener("keydown", handleSearchKeys);
    window.addEventListener("alfredo:open-diff-search", handleOpenDiffSearch);
    return () => {
      root.removeEventListener("keydown", handleSearchKeys);
      window.removeEventListener("alfredo:open-diff-search", handleOpenDiffSearch);
    };
  }, [searchOpen, navigateMatch, containerRef, worktreeId, paneId]);

  // Compute active search match for highlighting
  const activeSearchMatch = useMemo(() => {
    if (matches.length === 0) return null;
    return matches[currentMatchIndex] ?? null;
  }, [matches, currentMatchIndex]);

  return {
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    searchInputRef,
    matches,
    currentMatchIndex,
    navigateMatch,
    activeSearchMatch,
  };
}

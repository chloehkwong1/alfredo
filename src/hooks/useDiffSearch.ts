import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiffFile } from "../types";

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

  // Keyboard: "/" to open search, Escape to close, Enter/Shift+Enter to navigate
  useEffect(() => {
    function handleSearchKeys(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA";

      // "/" to open search (when not in an input), or Cmd+F anywhere
      if ((e.key === "/" && !isInput) || (e.metaKey && e.key === "f")) {
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

    window.addEventListener("keydown", handleSearchKeys);
    return () => window.removeEventListener("keydown", handleSearchKeys);
  }, [searchOpen, navigateMatch]);

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

import { useCallback, useEffect, useRef, useState } from "react";
import type { DiffFile } from "../types";

const AUTO_COLLAPSE_THRESHOLD = 15;

export function useFileNavigation(displayFiles: DiffFile[], viewMode: string) {
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [focusedFilePath, setFocusedFilePath] = useState<string | null>(null);
  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Auto-collapse all files when the diff is large to prevent UI freeze
  const hasAutoCollapsed = useRef(false);
  useEffect(() => {
    if (!hasAutoCollapsed.current && displayFiles.length > AUTO_COLLAPSE_THRESHOLD) {
      hasAutoCollapsed.current = true;
      setCollapsedFiles(new Set(displayFiles.map((f) => f.path)));
    }
  }, [displayFiles]);

  // Reset auto-collapse when switching tabs
  useEffect(() => {
    hasAutoCollapsed.current = false;
    setCollapsedFiles(new Set());
    setFocusedFilePath(null);
  }, [viewMode]);

  const clearFocusedFile = useCallback(() => {
    setFocusedFilePath(null);
  }, []);

  const handleToggleExpanded = useCallback((path: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setCollapsedFiles(new Set());
  }, []);

  const collapseAll = useCallback(() => {
    setCollapsedFiles(new Set(displayFiles.map((f) => f.path)));
  }, [displayFiles]);

  const handleSelectFile = useCallback((path: string) => {
    setActiveFilePath(path);
    setFocusedFilePath(path);
    // Uncollapse if collapsed
    setCollapsedFiles((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
    // Scroll to file via ref
    const el = fileRefs.current.get(path);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  // Keyboard shortcuts: ]/n next file, [/p prev file, x toggle collapse, Escape exit focused mode
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "Escape" && focusedFilePath) {
        e.preventDefault();
        setFocusedFilePath(null);
      } else if (e.key === "]" || e.key === "n") {
        e.preventDefault();
        const currentPath = focusedFilePath ?? activeFilePath;
        const idx = displayFiles.findIndex((f) => f.path === currentPath);
        const next = idx < displayFiles.length - 1 ? idx + 1 : 0;
        const file = displayFiles[next];
        if (file) {
          setActiveFilePath(file.path);
          if (focusedFilePath) {
            setFocusedFilePath(file.path);
          } else {
            setCollapsedFiles((prev) => {
              if (!prev.has(file.path)) return prev;
              const s = new Set(prev);
              s.delete(file.path);
              return s;
            });
            fileRefs.current.get(file.path)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }
      } else if (e.key === "[" || e.key === "p") {
        e.preventDefault();
        const currentPath = focusedFilePath ?? activeFilePath;
        const idx = displayFiles.findIndex((f) => f.path === currentPath);
        const prev = idx > 0 ? idx - 1 : displayFiles.length - 1;
        const file = displayFiles[prev];
        if (file) {
          setActiveFilePath(file.path);
          if (focusedFilePath) {
            setFocusedFilePath(file.path);
          } else {
            setCollapsedFiles((p) => {
              if (!p.has(file.path)) return p;
              const s = new Set(p);
              s.delete(file.path);
              return s;
            });
            fileRefs.current.get(file.path)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }
      } else if (e.key === "x" && activeFilePath) {
        e.preventDefault();
        handleToggleExpanded(activeFilePath);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [displayFiles, activeFilePath, focusedFilePath, handleToggleExpanded]);

  return {
    collapsedFiles,
    setCollapsedFiles,
    activeFilePath,
    setActiveFilePath,
    focusedFilePath,
    clearFocusedFile,
    fileRefs,
    handleToggleExpanded,
    expandAll,
    collapseAll,
    handleSelectFile,
  };
}

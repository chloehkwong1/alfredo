import { useRef, useEffect, useState, useCallback } from "react";
import { X, ChevronUp, ChevronDown } from "lucide-react";
import type { SearchAddon } from "@xterm/addon-search";
import type { ISearchOptions } from "@xterm/addon-search";

const SEARCH_OPTIONS: ISearchOptions = {
  decorations: {
    matchBackground: "#facc1540",
    matchBorder: "#facc1580",
    matchOverviewRuler: "#facc15",
    activeMatchBackground: "#facc1580",
    activeMatchBorder: "#facc15",
    activeMatchColorOverviewRuler: "#facc15",
  },
};

interface TerminalSearchBarProps {
  searchAddon: SearchAddon;
  onClose: () => void;
}

function TerminalSearchBar({ searchAddon, onClose }: TerminalSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [resultInfo, setResultInfo] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const handler = (e: { resultIndex: number; resultCount: number }) => {
      if (e.resultCount === 0) {
        setResultInfo(query ? "No results" : "");
      } else if (e.resultIndex === -1) {
        setResultInfo(`${e.resultCount}+ results`);
      } else {
        setResultInfo(`${e.resultIndex + 1} of ${e.resultCount}`);
      }
    };
    const disposable = searchAddon.onDidChangeResults(handler);
    return () => disposable.dispose();
  }, [searchAddon, query]);

  const findNext = useCallback(() => {
    if (query) searchAddon.findNext(query, SEARCH_OPTIONS);
  }, [searchAddon, query]);

  const findPrevious = useCallback(() => {
    if (query) searchAddon.findPrevious(query, SEARCH_OPTIONS);
  }, [searchAddon, query]);

  const handleChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (value) {
        searchAddon.findNext(value, { ...SEARCH_OPTIONS, incremental: true });
      } else {
        searchAddon.clearDecorations();
        setResultInfo("");
      }
    },
    [searchAddon],
  );

  const handleClose = useCallback(() => {
    searchAddon.clearDecorations();
    onClose();
  }, [searchAddon, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      } else if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        findPrevious();
      } else if (e.key === "Enter") {
        e.preventDefault();
        findNext();
      }
    },
    [handleClose, findNext, findPrevious],
  );

  return (
    <div className="absolute top-1 right-3 z-20 flex items-center gap-1 px-2 py-1 rounded-lg bg-bg-secondary border border-border-default shadow-lg">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search..."
        className="w-40 h-6 px-2 text-xs bg-bg-primary text-text-primary border border-border-default rounded placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
      />
      {resultInfo && (
        <span className="text-[10px] text-text-tertiary whitespace-nowrap min-w-[60px] text-center">
          {resultInfo}
        </span>
      )}
      <button
        onClick={findPrevious}
        className="p-0.5 rounded text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
        title="Previous (Shift+Enter)"
      >
        <ChevronUp size={14} />
      </button>
      <button
        onClick={findNext}
        className="p-0.5 rounded text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
        title="Next (Enter)"
      >
        <ChevronDown size={14} />
      </button>
      <button
        onClick={handleClose}
        className="p-0.5 rounded text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
        title="Close (Escape)"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export { TerminalSearchBar };

import { useCallback, useEffect, useState } from "react";
import { getFileContent, toggleTaskListItem } from "../../api";
import { MarkdownBody } from "../shared/MarkdownBody";
import { useToastStore } from "../../stores/toastStore";

interface MarkdownViewProps {
  repoPath: string;
  filePath: string;
  /** When set, fetch the file as it existed in this commit. Otherwise reads
   * the working tree. Also disables task-list toggling — committed history
   * is read-only. */
  commitHash?: string;
}

function MarkdownView({ repoPath, filePath, commitHash }: MarkdownViewProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Optimistic checkbox state, keyed by 1-based source line. Reset whenever
  // a new file is loaded so we don't leak overrides across files.
  const [overrides, setOverrides] = useState<Map<number, boolean>>(new Map());
  const showToast = useToastStore((s) => s.show);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    setOverrides(new Map());
    getFileContent(repoPath, filePath, commitHash)
      .then((text) => { if (!cancelled) setContent(text); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [repoPath, filePath, commitHash]);

  const handleToggle = useCallback(
    (line: number, newChecked: boolean) => {
      // Optimistic update — flip the checkbox immediately.
      setOverrides((prev) => {
        const next = new Map(prev);
        next.set(line, newChecked);
        return next;
      });
      toggleTaskListItem(repoPath, filePath, line, newChecked).catch((e) => {
        // Revert and surface the error.
        setOverrides((prev) => {
          const next = new Map(prev);
          next.delete(line);
          return next;
        });
        showToast({ message: `Couldn't update checkbox: ${e}` });
      });
    },
    [repoPath, filePath, showToast],
  );

  if (error) {
    return (
      <div className="px-3 py-2 text-xs text-status-error">
        Failed to load file: {error}
      </div>
    );
  }

  if (content === null) {
    return (
      <div className="px-3 py-2 text-xs text-text-tertiary">Loading…</div>
    );
  }

  return (
    <div className="px-6 py-4 max-w-[920px] mx-auto">
      <MarkdownBody
        text={content}
        onToggleTaskListItem={commitHash ? undefined : handleToggle}
        checkboxOverrides={overrides}
      />
    </div>
  );
}

export { MarkdownView };

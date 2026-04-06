import { useCallback, useEffect, useMemo, useState } from "react";
import { getFileLines } from "../../api";
import type { DiffFile, DiffLine } from "../../types";

/** Max lines to fetch when expanding to end of file */
const MAX_BOTTOM_EXPAND = 10_000;

export interface GapInfo {
  key: string;
  position: "top" | "between" | "bottom";
  hiddenLines: number;
  startLine: number;
  endLine: number;
}

export function useContextExpansion(
  file: DiffFile,
  repoPath: string,
  commitHash?: string,
  autoExpandAll?: boolean,
) {
  const [expandedGaps, setExpandedGaps] = useState<Map<string, DiffLine[]>>(new Map());
  const [bottomExhausted, setBottomExhausted] = useState(false);
  const [loadingGaps, setLoadingGaps] = useState<Set<string>>(new Set());

  // Reset expanded gaps when file content actually changes
  const fileContentKey = `${file.path}:${file.additions}:${file.deletions}:${file.hunks.length}:${file.hunks.map((h) => `${h.oldStart},${h.newStart},${h.lines.length}`).join(";")}`;
  useEffect(() => {
    setExpandedGaps(new Map());
    setBottomExhausted(false);
  }, [fileContentKey]);

  // Compute gap info: how many hidden lines between each hunk
  const gapInfo: GapInfo[] = useMemo(() => {
    const gaps: GapInfo[] = [];
    const hunks = file.hunks;
    if (hunks.length === 0) return gaps;

    // Gap above first hunk
    const firstHunk = hunks[0];
    const firstOldStart = firstHunk.oldStart;
    if (firstOldStart > 1 && file.status !== "added") {
      const alreadyExpanded = expandedGaps.get("top")?.length ?? 0;
      const hidden = firstOldStart - 1 - alreadyExpanded;
      if (hidden > 0) {
        gaps.push({
          key: "top",
          position: "top",
          hiddenLines: hidden,
          startLine: 1 + alreadyExpanded,
          endLine: firstOldStart - 1,
        });
      }
    }

    // Gaps between hunks
    for (let i = 0; i < hunks.length - 1; i++) {
      const currentHunk = hunks[i];
      const nextHunk = hunks[i + 1];
      const currentLastLine = currentHunk.lines.reduce((max, l) => {
        const n = l.oldLineNumber ?? l.newLineNumber ?? 0;
        return Math.max(max, n);
      }, 0);
      const nextStart = nextHunk.oldStart;
      const gapKey = `between-${i}-${i + 1}`;
      const alreadyExpanded = expandedGaps.get(gapKey)?.length ?? 0;
      const totalGap = nextStart - currentLastLine - 1;
      const hidden = totalGap - alreadyExpanded;
      if (hidden > 0) {
        gaps.push({
          key: gapKey,
          position: "between",
          hiddenLines: hidden,
          startLine: currentLastLine + 1 + alreadyExpanded,
          endLine: nextStart - 1,
        });
      }
    }

    // Gap below last hunk
    if (file.status !== "deleted" && !bottomExhausted) {
      const lastHunk = hunks[hunks.length - 1];
      const lastLineNum = lastHunk.lines.reduce((max, l) => {
        const n = l.newLineNumber ?? l.oldLineNumber ?? 0;
        return Math.max(max, n);
      }, 0);
      gaps.push({
        key: "bottom",
        position: "bottom",
        hiddenLines: 1,
        startLine: lastLineNum + 1,
        endLine: lastLineNum + MAX_BOTTOM_EXPAND,
      });
    }

    return gaps;
  }, [file.hunks, file.status, expandedGaps, bottomExhausted]);

  const handleExpandContext = useCallback(
    async (gapKey: string) => {
      const gap = gapInfo.find((g) => g.key === gapKey);
      if (!gap) return;

      setLoadingGaps((prev) => new Set(prev).add(gapKey));
      try {
        const lines = await getFileLines(repoPath, file.path, gap.startLine, gap.endLine, commitHash);
        const contextLines: DiffLine[] = lines.map((l) => ({
          lineType: "context" as const,
          content: l.content,
          oldLineNumber: l.lineNumber,
          newLineNumber: l.lineNumber,
        }));

        if (gapKey === "bottom") {
          setBottomExhausted(true);
        }

        if (contextLines.length === 0) return;

        setExpandedGaps((prev) => {
          const next = new Map(prev);
          next.set(gapKey, contextLines);
          return next;
        });
      } catch (err) {
        console.error("Failed to expand context:", err);
      } finally {
        setLoadingGaps((prev) => {
          const next = new Set(prev);
          next.delete(gapKey);
          return next;
        });
      }
    },
    [gapInfo, file.path, repoPath, commitHash],
  );

  // Auto-expand all context gaps when requested (focused mode "Expand full file")
  useEffect(() => {
    if (!autoExpandAll) return;
    for (const gap of gapInfo) {
      if (!expandedGaps.has(gap.key)) {
        handleExpandContext(gap.key);
      }
    }
  }, [autoExpandAll, gapInfo, expandedGaps, handleExpandContext]);

  return { gapInfo, expandedGaps, loadingGaps, handleExpandContext };
}

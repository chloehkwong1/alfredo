import type { DiffLine } from "../../types";
import type { SplitSide } from "./SplitDiffLine";

export interface SplitRow {
  left: SplitSide | null;
  right: SplitSide | null;
}

/**
 * Pair diff lines into split-view rows.
 *
 * Rules:
 * - Context lines appear on both sides
 * - Consecutive deletions followed by consecutive additions are paired as modifications (1:1)
 * - Extra deletions or additions beyond the paired count get blank on the opposite side
 * - Standalone deletions → left only, right blank
 * - Standalone additions → right only, left blank
 */
export function pairLinesForSplit(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.lineType === "context") {
      rows.push({
        left: { lineNumber: line.oldLineNumber, content: line.content, lineType: "context", originalLineIndex: i },
        right: { lineNumber: line.newLineNumber, content: line.content, lineType: "context", originalLineIndex: i },
      });
      i++;
      continue;
    }

    if (line.lineType === "deletion") {
      // Collect consecutive deletions
      const deletions: { line: DiffLine; index: number }[] = [];
      while (i < lines.length && lines[i].lineType === "deletion") {
        deletions.push({ line: lines[i], index: i });
        i++;
      }

      // Collect consecutive additions immediately after
      const additions: { line: DiffLine; index: number }[] = [];
      while (i < lines.length && lines[i].lineType === "addition") {
        additions.push({ line: lines[i], index: i });
        i++;
      }

      // Pair them 1:1
      const maxLen = Math.max(deletions.length, additions.length);
      for (let j = 0; j < maxLen; j++) {
        const del = deletions[j] ?? null;
        const add = additions[j] ?? null;
        rows.push({
          left: del
            ? { lineNumber: del.line.oldLineNumber, content: del.line.content, lineType: "deletion", originalLineIndex: del.index }
            : null,
          right: add
            ? { lineNumber: add.line.newLineNumber, content: add.line.content, lineType: "addition", originalLineIndex: add.index }
            : null,
        });
      }
      continue;
    }

    if (line.lineType === "addition") {
      // Standalone addition (not preceded by deletions)
      rows.push({
        left: null,
        right: { lineNumber: line.newLineNumber, content: line.content, lineType: "addition", originalLineIndex: i },
      });
      i++;
      continue;
    }

    i++;
  }

  return rows;
}

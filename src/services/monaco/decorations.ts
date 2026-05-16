import type { DiffFile } from "../../types";

/**
 * Reconstructs original/modified text from a diff. The reconstruction is
 * partial — only the lines covered by hunks plus their context are present.
 * Monaco's `hideUnchangedRegions: true` then collapses the gaps we have no
 * data for, so the user sees a continuous diff with "X unchanged lines"
 * markers where hunks were separated.
 *
 * Important: we synthesise placeholder lines for the gaps between hunks so
 * the line numbers Monaco reports match the real file line numbers. The
 * placeholders are blank strings; `hideUnchangedRegions` will hide them.
 */
export function diffToTexts(file: DiffFile): { original: string; modified: string } {
  if (file.hunks.length === 0) return { original: "", modified: "" };

  const originalLines: string[] = [];
  const modifiedLines: string[] = [];

  let originalCursor = 1;
  let modifiedCursor = 1;

  for (const hunk of file.hunks) {
    // Pad with blank lines up to the hunk start so line numbers align.
    while (originalCursor < hunk.oldStart) {
      originalLines.push("");
      originalCursor++;
    }
    while (modifiedCursor < hunk.newStart) {
      modifiedLines.push("");
      modifiedCursor++;
    }

    for (const line of hunk.lines) {
      if (line.lineType === "context") {
        originalLines.push(line.content);
        modifiedLines.push(line.content);
        originalCursor++;
        modifiedCursor++;
      } else if (line.lineType === "deletion") {
        originalLines.push(line.content);
        originalCursor++;
      } else if (line.lineType === "addition") {
        modifiedLines.push(line.content);
        modifiedCursor++;
      }
    }
  }

  return {
    original: originalLines.join("\n"),
    modified: modifiedLines.join("\n"),
  };
}

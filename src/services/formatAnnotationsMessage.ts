import type { Annotation, DiffFile } from "../types";

export function formatAnnotationsMessage(
  annotations: Annotation[],
  files?: DiffFile[],
): string {
  const lines = annotations.map((a) => {
    if (a.side === "old") {
      // The annotation refers to a line in the *pre-change* file. Line N of
      // the current file may be unrelated (or not exist), so include the
      // actual line content when we have it so Claude doesn't edit the
      // wrong line.
      const hit = files ? findOldSideLine(files, a) : null;
      const noun = hit?.lineType === "deletion" ? "deleted line" : "line (pre-change)";
      const quoted = hit ? ` (\`${hit.content.trim()}\`)` : "";
      return `Feedback on ${noun} at ${a.filePath}:${a.lineNumber}${quoted} — ${a.text}`;
    }
    return `Feedback on ${a.filePath}:${a.lineNumber} — ${a.text}`;
  });
  return "\n" + lines.join("\n") + "\n";
}

function findOldSideLine(
  files: DiffFile[],
  a: Annotation,
): { content: string; lineType: "deletion" | "context" } | null {
  const file = files.find((f) => f.path === a.filePath);
  if (!file) return null;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.oldLineNumber !== a.lineNumber) continue;
      if (line.lineType === "deletion" || line.lineType === "context") {
        return { content: line.content, lineType: line.lineType };
      }
    }
  }
  return null;
}

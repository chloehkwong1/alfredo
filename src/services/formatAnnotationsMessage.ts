import type { Annotation } from "../types";

export function formatAnnotationsMessage(annotations: Annotation[]): string {
  const lines = annotations.map(
    (a) => `Feedback on ${a.filePath}:${a.lineNumber} — ${a.text}`,
  );
  return "\n" + lines.join("\n") + "\n";
}

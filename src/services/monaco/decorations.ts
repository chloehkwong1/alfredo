import type { DiffFile } from "../../types";

/**
 * Hand the backend-supplied full original/modified file content to Monaco.
 *
 * Returns empty strings on the side that is intentionally absent (added →
 * no original, deleted → no modified) or when the backend skipped the
 * blob (binary / oversized). `MonacoDiffBody` shows a placeholder when
 * both sides are missing for a non-added/-deleted file.
 */
export function diffToTexts(file: DiffFile): { original: string; modified: string } {
  return {
    original: file.originalContent ?? "",
    modified: file.modifiedContent ?? "",
  };
}

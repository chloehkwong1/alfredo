/** Replace [selStart, selEnd) with snippet; caret lands after the snippet. */
export function insertAtCursor(
  value: string,
  selStart: number,
  selEnd: number,
  snippet: string
): { next: string; caret: number } {
  const next = value.slice(0, selStart) + snippet + value.slice(selEnd);
  return { next, caret: selStart + snippet.length };
}

/** Like insertAtCursor, but for block-level markdown (fenced blocks): GFM only
 *  recognises a fence that starts a line, so a leading newline is added when
 *  the caret sits mid-line. */
export function insertBlockAtCursor(
  value: string,
  selStart: number,
  selEnd: number,
  snippet: string
): { next: string; caret: number } {
  const atLineStart = selStart === 0 || value[selStart - 1] === "\n";
  return insertAtCursor(value, selStart, selEnd, atLineStart ? snippet : "\n" + snippet);
}

/** GitHub one-click-apply suggestion block for the commented line. */
export function buildSuggestionBlock(lineText: string): string {
  // Diff line content comes through untrimmed (libgit2 line.content() includes
  // the terminal line ending) — strip at most one trailing \r?\n so Apply
  // doesn't insert a spurious blank line. Meaningful trailing whitespace that
  // isn't part of the line ending is preserved.
  const line = lineText.replace(/\r?\n$/, "");
  // The fence must out-run any backtick run inside the line or it closes
  // early (GitHub's own UI lengthens to ````suggestion for fence lines).
  const longestRun = line.match(/`+/g)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0;
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return fence + "suggestion\n" + line + "\n" + fence + "\n";
}

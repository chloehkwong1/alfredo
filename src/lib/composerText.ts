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

/** GitHub one-click-apply suggestion block for the commented line. */
export function buildSuggestionBlock(lineText: string): string {
  // Diff line content comes through untrimmed (libgit2 line.content() includes
  // the terminal line ending) — strip at most one trailing \r?\n so Apply
  // doesn't insert a spurious blank line. Meaningful trailing whitespace that
  // isn't part of the line ending is preserved.
  const line = lineText.replace(/\r?\n$/, "");
  return "```suggestion\n" + line + "\n```\n";
}

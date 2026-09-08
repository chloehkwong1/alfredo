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
  return "```suggestion\n" + lineText + "\n```\n";
}

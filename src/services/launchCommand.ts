export type ParseResult =
  | { ok: true; args: string[] }
  | { ok: false; error: string };

/**
 * Tokenize a free-form launch-flags string (flags only, no binary) into an
 * argv array for use by buildClaudeArgs. Parsing follows shell conventions:
 * whitespace-separated tokens, with single/double quotes grouping and stripped.
 *
 * - Double quotes ("…") support \" escapes.
 * - Single quotes ('…') are literal: no escape or quote processing inside, so
 *   JSON/regex values survive intact.
 * - An unbalanced quote returns { ok: false }; this also drives live validation
 *   in the settings UI (red border shown until the quote is closed).
 * - Empty / whitespace-only input → { ok: true, args: [] } (bare `claude`).
 */
export function parseLaunchFlags(input: string): ParseResult {
  const args: string[] = [];
  let current = "";
  let hasToken = false;

  let i = 0;
  while (i < input.length) {
    const ch = input[i];

    if (ch === '"') {
      hasToken = true;
      i++;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === "\\" && i + 1 < input.length && input[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          current += input[i];
          i++;
        }
      }
      if (i >= input.length) {
        return { ok: false, error: 'Unbalanced quote — close the " to launch.' };
      }
      i++; // skip closing "
      continue;
    }

    if (ch === "'") {
      hasToken = true;
      i++;
      while (i < input.length && input[i] !== "'") {
        current += input[i];
        i++;
      }
      if (i >= input.length) {
        return { ok: false, error: "Unbalanced quote — close the ' to launch." };
      }
      i++; // skip closing '
      continue;
    }

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      if (hasToken) {
        args.push(current);
        current = "";
        hasToken = false;
      }
      i++;
      continue;
    }

    hasToken = true;
    current += ch;
    i++;
  }

  if (hasToken) {
    args.push(current);
  }

  return { ok: true, args };
}

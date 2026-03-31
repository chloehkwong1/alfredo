import type { ReactNode } from "react";

/**
 * Splits text by case-insensitive search query matches and wraps them in <mark> tags.
 * Returns the original string when there are no matches (avoids unnecessary React nodes).
 */
export function highlightText(
  text: string,
  query: string,
  isActiveMatch?: boolean,
): ReactNode {
  if (!query || query.length === 0) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let matchIdx = 0;

  let idx = lowerText.indexOf(lowerQuery, lastIndex);
  while (idx !== -1) {
    if (idx > lastIndex) parts.push(text.slice(lastIndex, idx));
    parts.push(
      <mark
        key={`m${matchIdx++}`}
        className={
          isActiveMatch
            ? "bg-search-match-active text-inherit rounded-[1px]"
            : "bg-search-match text-inherit rounded-[1px]"
        }
      >
        {text.slice(idx, idx + query.length)}
      </mark>,
    );
    lastIndex = idx + query.length;
    idx = lowerText.indexOf(lowerQuery, lastIndex);
  }

  if (lastIndex === 0) return text;
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}

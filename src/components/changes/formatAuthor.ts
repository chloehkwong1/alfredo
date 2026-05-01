/**
 * Format a commit author for display in commit lists.
 * Returns "You" (muted) when the author matches the local git user, otherwise
 * the author name in the accent colour. Used by FileSidebar's commit list and
 * the simplified-view RecentCommitsSection.
 */
export function formatAuthor(
  author: string,
  gitUser: string | null,
): { text: string; className: string } {
  if (gitUser && author.toLowerCase() === gitUser.toLowerCase()) {
    return { text: "You", className: "text-text-tertiary" };
  }
  return { text: author, className: "text-accent-primary" };
}

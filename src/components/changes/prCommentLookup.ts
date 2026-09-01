import type { PrComment } from "../../types";

/**
 * Group PR comments by `${side}:${line}` so a diff row can look up exactly
 * the comments anchored to its side. Keying on line alone collides RIGHT-side
 * comments with deletion rows sharing the same number (and vice versa).
 *
 * Comments without a `path` or `line` (whole-PR comments, outdated comments
 * after a force-push) are excluded — they have nowhere to anchor in the diff.
 *
 * For renamed files, comments made before the rename may still be keyed to
 * the old path on GitHub's side — pass `oldFilePath` to surface those too.
 */
export function groupPrCommentsByLine(
  comments: PrComment[],
  filePath: string,
  oldFilePath?: string | null,
): Map<string, PrComment[]> {
  const map = new Map<string, PrComment[]>();
  for (const comment of comments) {
    if (comment.line === null) continue;
    if (comment.path !== filePath && comment.path !== oldFilePath) continue;
    const key = `${comment.side}:${comment.line}`;
    const existing = map.get(key);
    if (existing) {
      existing.push(comment);
    } else {
      map.set(key, [comment]);
    }
  }
  return map;
}

/**
 * Collect every PR comment that should render on a given diff row. Context
 * rows have both line numbers populated, so we check both sides; addition
 * and deletion rows have only one populated and naturally check only that
 * side.
 */
export function getRowComments(
  map: Map<string, PrComment[]>,
  oldLineNumber: number | null,
  newLineNumber: number | null,
): PrComment[] {
  const out: PrComment[] = [];
  if (newLineNumber !== null) {
    out.push(...(map.get(`new:${newLineNumber}`) ?? []));
  }
  if (oldLineNumber !== null) {
    out.push(...(map.get(`old:${oldLineNumber}`) ?? []));
  }
  return out;
}

/**
 * Split one diff row's comments into distinct GitHub threads, so replies and
 * resolves target the right thread when two reviewers each started one on the
 * same line. Grouped by threadId when the resolution fetch supplied one, else
 * by the reply chain's root comment id.
 */
export function splitIntoThreads(comments: PrComment[]): PrComment[][] {
  const map = new Map<string, PrComment[]>();
  for (const comment of comments) {
    const key = comment.threadId ?? `root:${comment.inReplyToId ?? comment.id}`;
    const existing = map.get(key);
    if (existing) {
      existing.push(comment);
    } else {
      map.set(key, [comment]);
    }
  }
  return [...map.values()];
}

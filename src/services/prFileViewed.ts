import { setPrFileViewed } from "../api";
import { usePrStore } from "../stores/prStore";
import { useToastStore } from "../stores/toastStore";

/** Toggles a file's viewed state on GitHub, then reflects it into
 *  prStore.reviewedFiles — pessimistic, like the diff-thread resolve toggle:
 *  local state only flips once GitHub confirms it. The confirmed TARGET state
 *  is written (not a blind invert), so a hydration landing during the await
 *  can't leave local state opposite to GitHub. On failure, local state is
 *  left untouched and a toast reports the error. */
export async function togglePrFileViewed(
  repoPath: string,
  prNodeId: string,
  worktreeId: string,
  path: string,
  currentlyViewed: boolean,
): Promise<void> {
  const targetViewed = !currentlyViewed;
  try {
    await setPrFileViewed(repoPath, prNodeId, path, targetViewed);
    usePrStore.getState().setFileReviewed(worktreeId, path, targetViewed);
  } catch (e) {
    useToastStore.getState().show({
      message: `Failed to mark file ${targetViewed ? "reviewed" : "unreviewed"}: ${String(e)}`,
      durationMs: 0,
    });
  }
}

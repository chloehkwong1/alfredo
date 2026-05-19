import { writeWorktreeNotes } from "../api";

// Pending unsaved notes markdown, keyed by worktree path. NotesTab writes here
// on every edit; flushes (debounced, on window blur, on unmount, and on app
// quit/reload) drain it to disk. Keeping pending state at module scope — rather
// than inside the component — lets the app-level quit/reload handler flush notes
// even after the editor has begun tearing down.
const pending = new Map<string, string>();

export function setPendingNote(worktreePath: string, markdown: string): void {
  pending.set(worktreePath, markdown);
}

/** Flush one worktree's pending note to disk. No-op if nothing is pending. */
export async function flushNote(worktreePath: string): Promise<void> {
  const md = pending.get(worktreePath);
  if (md == null) return;
  pending.delete(worktreePath);
  try {
    await writeWorktreeNotes(worktreePath, md);
  } catch (e) {
    console.warn("[notesAutosave] write failed", e);
  }
}

/** Flush every pending note. Used on app quit / reload alongside session save. */
export async function flushAllPendingNotes(): Promise<void> {
  await Promise.allSettled([...pending.keys()].map((p) => flushNote(p)));
}

import { useEffect, useRef, useState } from "react";
import { readWorktreeNotes } from "../../api";
import { NotesEditor } from "./NotesEditor";
import { setPendingNote, flushNote } from "../../services/notesAutosave";

interface NotesTabProps {
  worktreePath: string;
}

const SAVE_DEBOUNCE_MS = 500;

export function NotesTab({ worktreePath }: NotesTabProps) {
  const [initialMarkdown, setInitialMarkdown] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  // Load once per worktreePath change.
  useEffect(() => {
    let cancelled = false;
    setInitialMarkdown(null);
    setLoadError(null);
    readWorktreeNotes(worktreePath)
      .then((md) => {
        if (!cancelled) setInitialMarkdown(md);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [worktreePath]);

  function handleMarkdownChange(md: string) {
    setPendingNote(worktreePath, md);
    if (timerRef.current != null) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flushNote(worktreePath);
    }, SAVE_DEBOUNCE_MS);
  }

  // Flush on tab switch / unmount / window blur. App quit/reload is handled
  // app-level via flushAllPendingNotes in useSessionAutoSave.
  useEffect(() => {
    const onBlur = () => void flushNote(worktreePath);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      void flushNote(worktreePath);
    };
  }, [worktreePath]);

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-secondary text-sm gap-2">
        <span>Could not load notes.</span>
        <code className="text-xs text-text-tertiary">{loadError}</code>
      </div>
    );
  }

  if (initialMarkdown == null) {
    return <div className="h-full" />;
  }

  return (
    <NotesEditor
      initialMarkdown={initialMarkdown}
      onMarkdownChange={handleMarkdownChange}
    />
  );
}

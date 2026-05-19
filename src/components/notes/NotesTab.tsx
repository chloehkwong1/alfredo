import { useEffect, useRef, useState } from "react";
import { readWorktreeNotes, writeWorktreeNotes } from "../../api";
import { NotesEditor } from "./NotesEditor";

interface NotesTabProps {
  worktreePath: string;
}

const SAVE_DEBOUNCE_MS = 500;

export function NotesTab({ worktreePath }: NotesTabProps) {
  const [initialMarkdown, setInitialMarkdown] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
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

  function flush() {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending == null) return;
    pendingRef.current = null;
    writeWorktreeNotes(worktreePath, pending).catch((e) => {
      console.warn("[NotesTab] write failed", e);
    });
  }

  function handleMarkdownChange(md: string) {
    pendingRef.current = md;
    if (timerRef.current != null) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      flush();
    }, SAVE_DEBOUNCE_MS);
  }

  // Flush on tab switch / unmount / window blur.
  useEffect(() => {
    const onBlur = () => flush();
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      flush();
    };
    // flush is intentionally referenced in cleanup; eslint will flag — silence if needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

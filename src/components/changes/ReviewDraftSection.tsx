import { useRef, useState } from "react";
import { X } from "lucide-react";
import { submitPrReview } from "../../api";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useToastStore } from "../../stores/toastStore";
import type { ReviewDraftComment, ReviewVerdict } from "../../types";

const VERDICTS: { value: ReviewVerdict; label: string }[] = [
  { value: "comment", label: "Comment" },
  { value: "approve", label: "Approve" },
  { value: "request_changes", label: "Request changes" },
];

export function ReviewDraftSection({
  worktreeId,
  repoPath,
  prNumber,
}: {
  worktreeId: string;
  repoPath: string;
  prNumber: number;
}) {
  const pending = useWorkspaceStore((s) => s.pendingReviews[worktreeId]);
  const { setReviewVerdict, setReviewBody, editReviewDraftComment, removeReviewDraftComment, clearPendingReview } =
    useWorkspaceStore.getState();
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  // Guards against a stray onBlur commit firing after Escape already cancelled
  // the edit (unmounting a focused textarea can still emit a blur event).
  const cancelingEditRef = useRef(false);

  const comments = pending?.comments ?? [];
  const verdict = pending?.verdict ?? "comment";
  const body = pending?.body ?? "";
  // Mirrors build_review_request_body (github_manager.rs): only APPROVE may omit the body.
  const canSubmit = !submitting && (verdict === "approve" || body.trim() !== "");
  const verdictLabel = VERDICTS.find((v) => v.value === verdict)!.label;

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await submitPrReview(
        repoPath,
        prNumber,
        verdict,
        body.trim(),
        comments.map((c) => ({ path: c.filePath, line: c.lineNumber, side: c.side, body: c.body }))
      );
      clearPendingReview(worktreeId);
      useToastStore.getState().show({ message: "Review submitted" });
    } catch (e) {
      useToastStore.getState().show({ message: `Review failed: ${String(e)}`, durationMs: 0 });
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(comment: ReviewDraftComment) {
    setEditingId(comment.id);
    setEditText(comment.body);
  }

  function commitEdit(id: string) {
    if (cancelingEditRef.current) {
      cancelingEditRef.current = false;
      return;
    }
    const trimmed = editText.trim();
    if (trimmed) editReviewDraftComment(worktreeId, id, trimmed);
    setEditingId(null);
  }

  function cancelEdit() {
    cancelingEditRef.current = true;
    setEditingId(null);
  }

  return (
    <div className="px-2.5 pb-2 flex flex-col gap-2">
      {comments.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {comments.map((c) => (
            <div key={c.id} className="border border-border-subtle rounded-md px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <span
                  className="text-[11px] font-mono text-text-tertiary truncate"
                  title={`${c.filePath}:${c.lineNumber}`}
                >
                  {c.filePath.split("/").pop()}:{c.lineNumber}
                </span>
                <button
                  onClick={() => removeReviewDraftComment(worktreeId, c.id)}
                  className="ml-auto p-0.5 rounded text-text-tertiary hover:text-status-error hover:bg-bg-hover cursor-pointer bg-transparent border-none"
                  aria-label="Remove draft comment"
                >
                  <X size={11} />
                </button>
              </div>
              {editingId === c.id ? (
                <textarea
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={() => commitEdit(c.id)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      commitEdit(c.id);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelEdit();
                    }
                  }}
                  rows={2}
                  className="w-full mt-1 px-2 py-1 rounded-sm text-[12px] bg-bg-primary border border-border-default text-text-primary outline-none focus:border-accent-primary/40 focus:ring-1 focus:ring-accent-primary/20 resize-y leading-relaxed"
                />
              ) : (
                <div
                  onClick={() => startEdit(c)}
                  className="text-[12px] text-text-secondary mt-0.5 cursor-text whitespace-pre-wrap"
                >
                  {c.body}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Verdict segmented control */}
      <div className="flex gap-0">
        {VERDICTS.map((v, i) => (
          <button
            key={v.value}
            onClick={() => setReviewVerdict(worktreeId, v.value)}
            className={[
              "flex-1 px-2 py-1.5 text-[11px] font-medium border border-border-default transition-colors",
              i === 0 ? "rounded-l-md" : "border-l-0",
              i === VERDICTS.length - 1 ? "rounded-r-md" : "",
              verdict === v.value
                ? "bg-accent-muted text-accent-primary border-accent-primary/40"
                : "text-text-tertiary hover:text-text-secondary",
            ].join(" ")}
          >
            {v.label}
          </button>
        ))}
      </div>

      <textarea
        value={body}
        onChange={(e) => setReviewBody(worktreeId, e.target.value)}
        placeholder="Summary — required unless approving…"
        rows={3}
        className="w-full px-2.5 py-2 rounded-md text-[13px] bg-bg-primary border border-border-default text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent-primary/40 focus:ring-1 focus:ring-accent-primary/20 resize-y leading-relaxed"
      />

      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="self-start px-2.5 py-1.5 rounded-md text-[12px] font-semibold text-text-on-accent bg-accent-primary hover:bg-accent-hover cursor-pointer border-none disabled:opacity-40 disabled:cursor-default"
      >
        {submitting ? "Submitting…" : `Submit review — ${verdictLabel}`}
      </button>
    </div>
  );
}

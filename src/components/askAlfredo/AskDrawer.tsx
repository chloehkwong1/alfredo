import { useEffect, useRef, useState } from "react";
import { X, ArrowRight } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { CatLogo } from "../ui/CatLogo";
import { Message } from "./Message";
import { useAskAlfredo } from "./useAskAlfredo";

interface AskDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function AskDrawer({ open, onClose }: AskDrawerProps) {
  const { turns, loading, submit, reset } = useAskAlfredo();
  const [draft, setDraft] = useState("");
  const [appVersion, setAppVersion] = useState("unknown");
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [turns.length, loading]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const onSubmit = () => {
    if (loading) return;
    const q = draft.trim();
    if (!q) return;
    setDraft("");
    submit(q);
  };

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 56,
        width: 340,
        height: 500,
        maxHeight: "calc(100vh - 80px)",
        background: "var(--bg-secondary)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "0 12px 32px rgba(0, 0, 0, 0.5)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 40,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
          <CatLogo width={16} height={16} />
          Ask Alfredo
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="icon-btn icon-btn-sm"
        >
          <X size={14} />
        </button>
      </div>

      <div
        ref={bodyRef}
        style={{
          flex: 1,
          padding: 14,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {turns.length === 0 && !loading && (
          <div
            style={{
              margin: "auto 0",
              textAlign: "center",
              color: "var(--text-tertiary)",
              fontSize: 12,
              lineHeight: 1.5,
              padding: "20px 12px",
            }}
          >
            Ask me how anything in Alfredo works.
            <br />
            <strong style={{ color: "var(--text-secondary)" }}>Try:</strong>{" "}
            <em>"how do I rename a worktree?"</em>
          </div>
        )}

        {turns.map((turn) => (
          <Message key={turn.id} turn={turn} appVersion={appVersion} />
        ))}

        {loading && (
          <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Thinking…</div>
        )}
      </div>

      <div
        style={{
          borderTop: "1px solid var(--border-subtle)",
          padding: "10px 12px",
          background: "var(--bg-secondary)",
        }}
      >
        <div
          style={{
            position: "relative",
            background: "var(--bg-primary)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder={turns.length > 0 ? "Ask another..." : "Ask a question..."}
            disabled={loading}
            style={{
              width: "100%",
              minHeight: 54,
              maxHeight: 120,
              padding: "10px 36px 10px 12px",
              background: "transparent",
              color: "var(--text-primary)",
              border: "none",
              outline: "none",
              resize: "none",
              fontFamily: "inherit",
              fontSize: 13,
              lineHeight: 1.45,
            }}
          />
          <button
            onClick={onSubmit}
            disabled={loading || !draft.trim()}
            aria-label="Send"
            style={{
              position: "absolute",
              right: 6,
              bottom: 6,
              height: 24,
              width: 24,
              borderRadius: "var(--radius-sm)",
              background: "var(--accent-primary)",
              color: "white",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              opacity: loading || !draft.trim() ? 0.4 : 1,
            }}
          >
            <ArrowRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

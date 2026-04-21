import { ChevronRight } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Turn } from "./useAskAlfredo";

const REPO_URL = "https://github.com/chloehkwong1/alfredo";

function tellChloe(question: string, appVersion: string) {
  const title = `Ask Alfredo couldn't answer: ${question.slice(0, 60)}`;
  const body = [
    "**Question asked in Ask Alfredo:**",
    `> ${question}`,
    "",
    `**Alfredo version:** ${appVersion}`,
    `**OS:** ${navigator.platform}`,
    "",
    '_Filed via the "Tell Chloe" button — the assistant said it didn\'t know the answer._',
  ].join("\n");
  const params = new URLSearchParams({
    labels: "ask-alfredo-miss",
    title,
    body,
  });
  openUrl(`${REPO_URL}/issues/new?${params.toString()}`);
}

export function Message({ turn, appVersion }: { turn: Turn; appVersion: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          alignSelf: "flex-end",
          maxWidth: "85%",
          padding: "8px 12px",
          background: "var(--accent-muted)",
          color: "var(--text-primary)",
          borderRadius: "12px 12px 2px 12px",
          fontSize: 13,
          lineHeight: 1.45,
        }}
      >
        {turn.question}
      </div>

      {turn.error && (
        <div style={{ fontSize: 12, color: "var(--status-error)" }}>
          {turn.error}
        </div>
      )}

      {turn.answer?.confidence === "high" && (
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text-primary)" }}>
          <p style={{ margin: 0 }}>{turn.answer.answer}</p>
          {turn.answer.uiPath && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 10px",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-md)",
                fontSize: 11,
                color: "var(--text-secondary)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <ChevronRight size={11} />
              {turn.answer.uiPath}
            </div>
          )}
        </div>
      )}

      {turn.answer?.confidence === "low" && (
        <div
          style={{
            padding: 12,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <p
            style={{
              fontSize: 13,
              color: "var(--text-secondary)",
              lineHeight: 1.5,
              marginBottom: 10,
            }}
          >
            Hmm, I don't know that one. It might not be supported yet, or the docs might be missing.
          </p>
          <button
            className="btn btn-secondary btn-sm"
            style={{ width: "100%" }}
            onClick={() => tellChloe(turn.question, appVersion)}
          >
            Tell Chloe →
          </button>
        </div>
      )}
    </div>
  );
}

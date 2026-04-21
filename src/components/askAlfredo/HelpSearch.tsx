import { useEffect, useMemo, useRef, useState } from "react";
import { X, Search, ChevronRight } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import { CatLogo } from "../ui/CatLogo";
import { MarkdownBody } from "../shared/MarkdownBody";
import { searchAlfredoDocs, type HelpHit } from "../../api";
import { useAppConfig } from "../../hooks/useAppConfig";

const REPO_URL = "https://github.com/chloehkwong1/alfredo";
const NEW_USER_SUGGESTIONS = [
  "first run setup",
  "add a repo",
  "switch agent provider",
  "keyboard shortcuts",
];
const RETURNING_USER_SUGGESTIONS = [
  "rename a worktree",
  "notification sound",
  "mark as blocked",
  "keyboard shortcuts",
];

interface HelpSearchProps {
  open: boolean;
  onClose: () => void;
}

function tellChloe(query: string, appVersion: string) {
  const title = `Ask Alfredo couldn't answer: ${query.slice(0, 60)}`;
  const body = [
    "**Query typed into help search:**",
    `> ${query}`,
    "",
    `**Alfredo version:** ${appVersion}`,
    `**OS:** ${navigator.platform}`,
    "",
    '_Filed because the help search returned no useful results._',
  ].join("\n");
  const params = new URLSearchParams({
    labels: "ask-alfredo-miss",
    title,
    body,
  });
  openUrl(`${REPO_URL}/issues/new?${params.toString()}`);
}

export function HelpSearch({ open, onClose }: HelpSearchProps) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<HelpHit[]>([]);
  const [expandedTitle, setExpandedTitle] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("unknown");
  const inputRef = useRef<HTMLInputElement>(null);
  const { repos } = useAppConfig();
  const suggestions = repos.length === 0 ? NEW_USER_SUGGESTIONS : RETURNING_USER_SUGGESTIONS;

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
      setExpandedTitle(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Debounced search as the user types.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setHits([]);
      setExpandedTitle(null);
      return;
    }
    const h = setTimeout(() => {
      searchAlfredoDocs(q, 5)
        .then((results) => {
          setHits(results);
          setExpandedTitle(results[0]?.title ?? null);
        })
        .catch((e) => {
          console.error("searchAlfredoDocs failed", e);
          setHits([]);
        });
    }, 80);
    return () => clearTimeout(h);
  }, [query, open]);

  const topHit = hits[0];
  const hasResults = hits.length > 0;
  const showEmptyState = !query.trim();
  const showNoResults = !showEmptyState && !hasResults;

  const expanded = useMemo(
    () => hits.find((h) => h.title === expandedTitle) ?? null,
    [hits, expandedTitle],
  );

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 56,
        width: 380,
        height: 520,
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
        <button onClick={onClose} aria-label="Close" className="icon-btn icon-btn-sm">
          <X size={14} />
        </button>
      </div>

      <div
        style={{
          position: "relative",
          padding: "10px 12px",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <Search
          size={13}
          style={{
            position: "absolute",
            left: 22,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--text-tertiary)",
          }}
        />
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help — try 'notification sound'"
          style={{
            width: "100%",
            height: 30,
            paddingLeft: 28,
            paddingRight: 10,
            background: "var(--bg-primary)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-md)",
            outline: "none",
            fontSize: 13,
            fontFamily: "inherit",
          }}
        />
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {showEmptyState && (
          <div
            style={{
              margin: "auto 0",
              padding: "20px 16px",
              textAlign: "center",
              color: "var(--text-tertiary)",
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            <div style={{ marginBottom: 10 }}>Ask how anything in Alfredo works.</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setQuery(s);
                    inputRef.current?.focus();
                  }}
                  style={{
                    padding: "4px 10px",
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 999,
                    color: "var(--text-secondary)",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {hasResults && (
          <>
            <div style={{ padding: "8px 10px 2px", display: "flex", flexDirection: "column", gap: 2 }}>
              {hits.map((hit) => {
                const isExpanded = hit.title === expandedTitle;
                const isTop = hit === topHit;
                return (
                  <button
                    key={hit.title}
                    onClick={() => setExpandedTitle(hit.title)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                      padding: "8px 10px",
                      background: isExpanded ? "var(--accent-muted)" : "transparent",
                      border: "1px solid",
                      borderColor: isExpanded ? "var(--accent-primary)" : "transparent",
                      borderRadius: "var(--radius-md)",
                      textAlign: "left",
                      cursor: "pointer",
                      color: "var(--text-primary)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 500 }}>
                      {isTop && <span style={{ fontSize: 10, color: "var(--accent-primary)" }}>★</span>}
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {hit.title}
                      </span>
                    </div>
                    {hit.uiPath && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 11,
                          color: "var(--text-secondary)",
                        }}
                      >
                        <ChevronRight size={10} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {hit.uiPath}
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {expanded && (
              <div
                style={{
                  padding: "6px 16px 16px",
                  borderTop: "1px solid var(--border-subtle)",
                  marginTop: 6,
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  color: "var(--text-secondary)",
                }}
              >
                <MarkdownBody text={expanded.body} compact />
              </div>
            )}
          </>
        )}

        {showNoResults && (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
              Nothing matched "{query.trim()}". It might not be documented yet.
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => tellChloe(query.trim(), appVersion)}
            >
              Tell Chloe →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

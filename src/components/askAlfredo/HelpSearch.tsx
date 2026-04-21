import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { X, Search, ChevronRight, Keyboard, Bug, BarChart3 } from "lucide-react";
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
];
const RETURNING_USER_SUGGESTIONS = [
  "rename a worktree",
  "notification sound",
  "mark as blocked",
];

function QuickAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        background: "transparent",
        border: "none",
        borderRadius: "var(--radius-md)",
        color: "var(--text-secondary)",
        fontSize: 12,
        textAlign: "left",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-elevated)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span style={{ color: "var(--text-tertiary)", display: "inline-flex" }}>{icon}</span>
      {label}
    </button>
  );
}

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
  const panelRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number; tailLeft: number } | null>(null);
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
    const onClickAway = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if ((target as Element | null)?.closest?.("[data-ask-trigger]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClickAway);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClickAway);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    const place = () => {
      const trigger = document.querySelector<HTMLElement>("[data-ask-trigger]");
      const panelWidth = 360;
      const gap = 8;
      if (!trigger) {
        setAnchor({ left: 16, top: 48, tailLeft: 16 });
        return;
      }
      const rect = trigger.getBoundingClientRect();
      const viewportRight = window.innerWidth - 8;
      // Align panel's left edge with trigger's left edge, but keep panel on screen.
      let left = rect.left;
      if (left + panelWidth > viewportRight) left = viewportRight - panelWidth;
      if (left < 8) left = 8;
      const top = rect.bottom + gap;
      const tailLeft = Math.max(10, Math.min(panelWidth - 20, rect.left + rect.width / 2 - left));
      setAnchor({ left, top, tailLeft });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

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
      ref={panelRef}
      style={{
        position: "fixed",
        left: anchor?.left ?? 16,
        top: anchor?.top ?? 48,
        width: 360,
        maxHeight: "calc(100vh - 64px)",
        background: "var(--bg-secondary)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "0 12px 32px rgba(0, 0, 0, 0.5)",
        display: "flex",
        flexDirection: "column",
        overflow: "visible",
        zIndex: 40,
        opacity: anchor ? 1 : 0,
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: -5,
          left: anchor?.tailLeft ?? 16,
          width: 9,
          height: 9,
          background: "var(--bg-secondary)",
          borderTop: "1px solid var(--border-default)",
          borderLeft: "1px solid var(--border-default)",
          transform: "rotate(45deg)",
        }}
      />
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
          <X size={13} />
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
              padding: "14px 14px 10px",
              color: "var(--text-tertiary)",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            <div style={{ marginBottom: 10, color: "var(--text-secondary)" }}>Ask how anything in Alfredo works.</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
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

        {showEmptyState && (
          <div
            style={{
              padding: "8px 10px 12px",
              borderTop: "1px solid var(--border-subtle)",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <QuickAction
              icon={<Keyboard size={13} />}
              label="Keyboard shortcuts"
              onClick={() => {
                onClose();
                window.dispatchEvent(new CustomEvent("alfredo:shortcuts-overlay"));
              }}
            />
            <QuickAction
              icon={<Bug size={13} />}
              label="Report bug or request feature"
              onClick={() => openUrl(`${REPO_URL}/issues/new/choose`)}
            />
            <QuickAction
              icon={<BarChart3 size={13} />}
              label="Claude usage"
              onClick={() => openUrl("https://claude.ai/settings/usage")}
            />
          </div>
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

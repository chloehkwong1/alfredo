import { useEffect } from "react";
import {
  CircleCheck,
  Eye,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { getCheckRuns, getPrDetail } from "../../api";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { CheckRun, PrPanelState, PrStatus } from "../../types";

interface PrPanelProps {
  worktreeId: string;
  repoPath: string;
  pr: PrStatus;
  panelState: PrPanelState;
  onTogglePanel: () => void;
  onJumpToComment: (filePath: string, line: number) => void;
}

export function PrPanel({
  worktreeId,
  repoPath,
  pr,
  panelState,
  onTogglePanel,
  onJumpToComment,
}: PrPanelProps) {
  const checkRuns = useWorkspaceStore((s) => s.checkRuns[worktreeId]) ?? [];
  const prDetail = useWorkspaceStore((s) => s.prDetail[worktreeId]);
  const setCheckRuns = useWorkspaceStore((s) => s.setCheckRuns);
  const setPrDetail = useWorkspaceStore((s) => s.setPrDetail);

  const reviews = prDetail?.reviews ?? [];
  const comments = prDetail?.comments ?? [];
  const mergeable = prDetail?.mergeable ?? null;
  const reviewDecision = prDetail?.reviewDecision ?? null;

  // Derived counts for badges
  const failingChecks = checkRuns.filter(
    (r) => r.status === "completed" && r.conclusion !== "success" && r.conclusion !== "skipped" && r.conclusion !== null,
  ).length;
  const pendingChecks = checkRuns.filter((r) => r.status !== "completed").length;
  const unresolvedComments = comments.filter((c) => !c.resolved).length;
  const approvals = reviews.filter((r) => r.state === "APPROVED").length;

  async function fetchData() {
    try {
      const [runs, detail] = await Promise.all([
        getCheckRuns(repoPath, pr.branch),
        getPrDetail(repoPath, pr.number),
      ]);
      setCheckRuns(worktreeId, runs);
      setPrDetail(worktreeId, detail);
    } catch {
      // silently ignore — stale data is acceptable
    }
  }

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worktreeId, repoPath, pr.number, pr.branch]);

  // ── Collapsed rail ─────────────────────────────────────────────
  if (panelState === "collapsed") {
    return (
      <div
        style={{
          width: 36,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: 8,
          paddingBottom: 8,
          gap: 16,
          background: "var(--color-surface-raised, #1e1e2e)",
          borderLeft: "1px solid var(--color-border, rgba(255,255,255,0.08))",
          cursor: "pointer",
        }}
        onClick={onTogglePanel}
        title="Expand PR panel"
      >
        {/* Expand arrow */}
        <div style={{ color: "var(--color-text-muted, #888)", marginBottom: 4 }}>
          <ChevronLeft size={16} />
        </div>

        {/* Checks icon + badge */}
        <RailIcon
          icon={<CircleCheck size={16} />}
          count={failingChecks > 0 ? failingChecks : pendingChecks > 0 ? pendingChecks : checkRuns.length}
          badgeVariant={failingChecks > 0 ? "error" : pendingChecks > 0 ? "pending" : "ok"}
          title="Check runs"
        />

        {/* Reviews icon + badge */}
        <RailIcon
          icon={<Eye size={16} />}
          count={approvals}
          badgeVariant={reviewDecision === "APPROVED" ? "ok" : reviewDecision === "CHANGES_REQUESTED" ? "error" : "neutral"}
          title="Reviews"
        />

        {/* Comments icon + badge */}
        <RailIcon
          icon={<MessageCircle size={16} />}
          count={unresolvedComments}
          badgeVariant="info"
          title="Comments"
        />
      </div>
    );
  }

  // ── Expanded panel ─────────────────────────────────────────────
  return (
    <div
      style={{
        width: 296, // 260px panel + 36px rail
        flexShrink: 0,
        display: "flex",
        flexDirection: "row",
        background: "var(--color-surface-raised, #1e1e2e)",
        borderLeft: "1px solid var(--color-border, rgba(255,255,255,0.08))",
        overflow: "hidden",
      }}
    >
      {/* Main panel content (260px) */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 10px",
            borderBottom: "1px solid var(--color-border, rgba(255,255,255,0.08))",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--color-text, #e0e0e0)",
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            PR #{pr.number}
          </span>
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ color: "var(--color-text-muted, #888)", lineHeight: 0 }}
            title="Open on GitHub"
          >
            <ExternalLink size={13} />
          </a>
          <button
            onClick={onTogglePanel}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--color-text-muted, #888)",
              padding: 0,
              lineHeight: 0,
            }}
            title="Collapse panel"
          >
            <ChevronRight size={15} />
          </button>
        </div>

        {/* Scrollable content */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "8px 0",
            display: "flex",
            flexDirection: "column",
            gap: 0,
          }}
        >
          {/* Checks section */}
          <Section title="Checks" count={checkRuns.length}>
            {checkRuns.length === 0 ? (
              <EmptyRow text="No checks" />
            ) : (
              checkRuns.map((run) => <CheckRunRow key={run.id} run={run} />)
            )}
          </Section>

          {/* Reviews section */}
          <Section title="Reviews" count={reviews.length}>
            {reviews.length === 0 ? (
              <EmptyRow text="No reviews yet" />
            ) : (
              reviews.map((r) => (
                <ReviewRow key={`${r.reviewer}-${r.submittedAt}`} reviewer={r.reviewer} state={r.state} submittedAt={r.submittedAt} />
              ))
            )}
          </Section>

          {/* Comments section */}
          <Section title="Comments" count={unresolvedComments > 0 ? unresolvedComments : comments.length}>
            {comments.length === 0 ? (
              <EmptyRow text="No comments" />
            ) : (
              comments.map((c) => (
                <CommentCard
                  key={c.id}
                  author={c.author}
                  body={c.body}
                  path={c.path}
                  line={c.line}
                  createdAt={c.createdAt}
                  resolved={c.resolved}
                  htmlUrl={c.htmlUrl}
                  onJump={
                    c.path && c.line != null
                      ? () => onJumpToComment(c.path!, c.line!)
                      : undefined
                  }
                />
              ))
            )}
          </Section>
        </div>

        {/* Merge status banner */}
        <MergeStatusBanner
          pr={pr}
          mergeable={mergeable}
          reviewDecision={reviewDecision}
        />
      </div>

      {/* Thin right rail (36px) with collapse arrow */}
      <div
        style={{
          width: 36,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: 8,
          paddingBottom: 8,
          gap: 16,
          borderLeft: "1px solid var(--color-border, rgba(255,255,255,0.08))",
          cursor: "pointer",
        }}
        onClick={onTogglePanel}
        title="Collapse PR panel"
      >
        <div style={{ color: "var(--color-text-muted, #888)", marginBottom: 4 }}>
          <ChevronRight size={16} />
        </div>
        <RailIcon
          icon={<CircleCheck size={16} />}
          count={failingChecks > 0 ? failingChecks : pendingChecks > 0 ? pendingChecks : checkRuns.length}
          badgeVariant={failingChecks > 0 ? "error" : pendingChecks > 0 ? "pending" : "ok"}
          title="Check runs"
        />
        <RailIcon
          icon={<Eye size={16} />}
          count={approvals}
          badgeVariant={reviewDecision === "APPROVED" ? "ok" : reviewDecision === "CHANGES_REQUESTED" ? "error" : "neutral"}
          title="Reviews"
        />
        <RailIcon
          icon={<MessageCircle size={16} />}
          count={unresolvedComments}
          badgeVariant="info"
          title="Comments"
        />
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

type BadgeVariant = "error" | "ok" | "pending" | "info" | "neutral";

function badgeColor(variant: BadgeVariant): string {
  switch (variant) {
    case "error": return "#ef4444";
    case "ok": return "#22c55e";
    case "pending": return "#f59e0b";
    case "info": return "#3b82f6";
    case "neutral": return "#6b7280";
  }
}

function RailIcon({
  icon,
  count,
  badgeVariant,
  title,
}: {
  icon: React.ReactNode;
  count: number;
  badgeVariant: BadgeVariant;
  title: string;
}) {
  return (
    <div
      style={{ position: "relative", color: "var(--color-text-muted, #888)", lineHeight: 0 }}
      title={title}
    >
      {icon}
      {count > 0 && (
        <span
          style={{
            position: "absolute",
            top: -5,
            right: -6,
            background: badgeColor(badgeVariant),
            color: "#fff",
            fontSize: 9,
            fontWeight: 700,
            borderRadius: 6,
            minWidth: 13,
            height: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 2px",
            lineHeight: 1,
          }}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px 4px",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--color-text-muted, #888)",
          }}
        >
          {title}
        </span>
        {count > 0 && (
          <span
            style={{
              fontSize: 10,
              background: "var(--color-surface, rgba(255,255,255,0.06))",
              color: "var(--color-text-muted, #888)",
              borderRadius: 9,
              padding: "1px 5px",
            }}
          >
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: "4px 10px",
        fontSize: 12,
        color: "var(--color-text-muted, #888)",
        fontStyle: "italic",
      }}
    >
      {text}
    </div>
  );
}

function CheckRunRow({ run }: { run: CheckRun }) {
  const isCompleted = run.status === "completed";
  const isSuccess = run.conclusion === "success" || run.conclusion === "skipped";
  const isFailed = isCompleted && !isSuccess && run.conclusion !== null;
  const isPending = !isCompleted;

  const dotColor = isFailed ? "#ef4444" : isPending ? "#f59e0b" : "#22c55e";

  const duration =
    run.startedAt && run.completedAt
      ? formatDuration(
          new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime(),
        )
      : null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        fontSize: 12,
      }}
    >
      {isPending ? (
        <RefreshCw
          size={10}
          style={{ color: dotColor, flexShrink: 0, animation: "spin 1.5s linear infinite" }}
        />
      ) : (
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: dotColor,
            flexShrink: 0,
            display: "inline-block",
          }}
        />
      )}
      <span
        style={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "var(--color-text, #e0e0e0)",
        }}
        title={run.name}
      >
        {run.name}
      </span>
      {duration && (
        <span style={{ color: "var(--color-text-muted, #888)", flexShrink: 0 }}>
          {duration}
        </span>
      )}
      {isFailed && (
        <a
          href={run.htmlUrl}
          target="_blank"
          rel="noreferrer"
          style={{ color: "#ef4444", lineHeight: 0, flexShrink: 0 }}
          title="View logs"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink size={11} />
        </a>
      )}
    </div>
  );
}

function ReviewRow({
  reviewer,
  state,
  submittedAt,
}: {
  reviewer: string;
  state: string;
  submittedAt: string | null;
}) {
  const stateColor =
    state === "APPROVED"
      ? "#22c55e"
      : state === "CHANGES_REQUESTED"
        ? "#ef4444"
        : "#6b7280";

  const stateLabel =
    state === "APPROVED"
      ? "Approved"
      : state === "CHANGES_REQUESTED"
        ? "Changes requested"
        : state === "DISMISSED"
          ? "Dismissed"
          : "Pending";

  const initial = reviewer.charAt(0).toUpperCase();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "4px 10px",
        fontSize: 12,
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "var(--color-surface, rgba(255,255,255,0.1))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          fontWeight: 700,
          color: "var(--color-text, #e0e0e0)",
          flexShrink: 0,
        }}
      >
        {initial}
      </div>
      <span
        style={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "var(--color-text, #e0e0e0)",
        }}
      >
        {reviewer}
      </span>
      <span style={{ color: stateColor, flexShrink: 0, fontSize: 11 }}>
        {stateLabel}
      </span>
      {submittedAt && (
        <span style={{ color: "var(--color-text-muted, #888)", flexShrink: 0, fontSize: 10 }}>
          {formatTimeAgo(submittedAt)}
        </span>
      )}
    </div>
  );
}

function CommentCard({
  author,
  body,
  path,
  line,
  createdAt,
  resolved,
  htmlUrl,
  onJump,
}: {
  author: string;
  body: string;
  path: string | null;
  line: number | null;
  createdAt: string;
  resolved: boolean;
  htmlUrl: string;
  onJump?: () => void;
}) {
  return (
    <div
      onClick={onJump}
      style={{
        margin: "2px 6px",
        padding: "6px 8px",
        background: "var(--color-surface, rgba(255,255,255,0.04))",
        borderRadius: 6,
        border: resolved
          ? "1px solid rgba(255,255,255,0.04)"
          : "1px solid rgba(255,255,255,0.08)",
        cursor: onJump ? "pointer" : "default",
        opacity: resolved ? 0.5 : 1,
        fontSize: 12,
      }}
    >
      {/* Author row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          marginBottom: 3,
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--color-text, #e0e0e0)" }}>
          {author}
        </span>
        {path && (
          <span
            style={{
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "var(--color-text-muted, #888)",
              fontSize: 11,
            }}
            title={line != null ? `${path}:${line}` : path}
          >
            {path.split("/").pop()}
            {line != null ? `:${line}` : ""}
          </span>
        )}
        <span style={{ color: "var(--color-text-muted, #888)", fontSize: 10, flexShrink: 0 }}>
          {formatTimeAgo(createdAt)}
        </span>
        <a
          href={htmlUrl}
          target="_blank"
          rel="noreferrer"
          style={{ color: "var(--color-text-muted, #888)", lineHeight: 0, flexShrink: 0 }}
          title="Open on GitHub"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink size={10} />
        </a>
      </div>

      {/* Body */}
      <p
        style={{
          margin: 0,
          color: "var(--color-text, #e0e0e0)",
          lineHeight: 1.4,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {body}
      </p>
    </div>
  );
}

function MergeStatusBanner({
  pr,
  mergeable,
  reviewDecision,
}: {
  pr: PrStatus;
  mergeable: boolean | null;
  reviewDecision: string | null;
}) {
  if (pr.merged) {
    return (
      <div
        style={{
          padding: "6px 10px",
          background: "rgba(139,92,246,0.15)",
          borderTop: "1px solid rgba(139,92,246,0.3)",
          fontSize: 12,
          color: "#a78bfa",
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        Merged{pr.mergedAt ? ` · ${formatTimeAgo(pr.mergedAt)}` : ""}
      </div>
    );
  }

  if (pr.state === "closed") {
    return (
      <div
        style={{
          padding: "6px 10px",
          background: "rgba(239,68,68,0.10)",
          borderTop: "1px solid rgba(239,68,68,0.2)",
          fontSize: 12,
          color: "#f87171",
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        Closed
      </div>
    );
  }

  if (mergeable === true && reviewDecision === "APPROVED") {
    return (
      <div
        style={{
          padding: "6px 10px",
          background: "rgba(34,197,94,0.10)",
          borderTop: "1px solid rgba(34,197,94,0.2)",
          fontSize: 12,
          color: "#4ade80",
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        Ready to merge
      </div>
    );
  }

  if (mergeable === false) {
    return (
      <div
        style={{
          padding: "6px 10px",
          background: "rgba(239,68,68,0.10)",
          borderTop: "1px solid rgba(239,68,68,0.2)",
          fontSize: 12,
          color: "#f87171",
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        Merge conflict
      </div>
    );
  }

  if (reviewDecision === "CHANGES_REQUESTED") {
    return (
      <div
        style={{
          padding: "6px 10px",
          background: "rgba(239,68,68,0.10)",
          borderTop: "1px solid rgba(239,68,68,0.2)",
          fontSize: 12,
          color: "#f87171",
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        Changes requested
      </div>
    );
  }

  if (pr.draft) {
    return (
      <div
        style={{
          padding: "6px 10px",
          background: "rgba(107,114,128,0.10)",
          borderTop: "1px solid rgba(107,114,128,0.2)",
          fontSize: 12,
          color: "#9ca3af",
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        Draft
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "6px 10px",
        background: "rgba(59,130,246,0.10)",
        borderTop: "1px solid rgba(59,130,246,0.2)",
        fontSize: 12,
        color: "#60a5fa",
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      Open
    </div>
  );
}

// ── Helper functions ───────────────────────────────────────────────

/** Converts a millisecond duration to a human-readable string like "42s" or "1m 12s". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/** Converts an ISO timestamp to a relative time string like "2h ago" or "3d ago". */
export function formatTimeAgo(timestamp: string): string {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const diffSecs = Math.round(diffMs / 1000);

  if (diffSecs < 60) return "just now";
  if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
  if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
  if (diffSecs < 86400 * 30) return `${Math.floor(diffSecs / 86400)}d ago`;
  if (diffSecs < 86400 * 365) return `${Math.floor(diffSecs / (86400 * 30))}mo ago`;
  return `${Math.floor(diffSecs / (86400 * 365))}y ago`;
}

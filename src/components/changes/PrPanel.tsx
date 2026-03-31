import { useState } from "react";
import {
  CircleCheck,
  Eye,
  MessageCircle,
  ExternalLink,
  RefreshCw,
  GitPullRequestDraft,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { usePrStore } from "../../stores/prStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { CheckRun, PrStatus } from "../../types";
import { formatDuration, formatTimeAgo } from "./formatRelativeTime";
import { rerunFailedChecks, fixFailingChecks, fixMergeConflicts } from "../../services/prActions";
import { useTabStore } from "../../stores/tabStore";
import { IconButton } from "../ui/IconButton";
import { Button } from "../ui/Button";

// ── Shared badge-count helpers ─────────────────────────────────────

export function usePrBadgeCounts(worktreeId: string) {
  const checkRuns = usePrStore((s) => s.checkRuns[worktreeId]) ?? [];
  const prDetail = usePrStore((s) => s.prDetail[worktreeId]);

  const reviews = prDetail?.reviews ?? [];
  const comments = prDetail?.comments ?? [];
  const mergeable = prDetail?.mergeable ?? null;
  const reviewDecision = prDetail?.reviewDecision ?? null;

  const failingChecks = checkRuns.filter(
    (r) => r.status === "completed" && r.conclusion !== "success" && r.conclusion !== "skipped" && r.conclusion !== null,
  ).length;
  const pendingChecks = checkRuns.filter((r) => r.status !== "completed").length;
  const unresolvedComments = comments.filter((c) => !c.resolved).length;
  const approvals = reviews.filter((r) => r.state === "APPROVED").length;

  return { checkRuns, prDetail, reviews, comments, mergeable, reviewDecision, failingChecks, pendingChecks, unresolvedComments, approvals };
}

// ── PrPanelContent ─────────────────────────────────────────────────
// Renders ONLY the scrollable content + merge banner (no header, no rail, no expand/collapse).

interface PrPanelContentProps {
  worktreeId: string;
  onJumpToComment: (filePath: string, line: number) => void;
}

export function PrPanelContent({ worktreeId, onJumpToComment }: PrPanelContentProps) {
  const worktree = useWorkspaceStore((s) => s.worktrees.find((w) => w.id === worktreeId));
  const pr = worktree?.prStatus ?? null;
  const prDetail = usePrStore((s) => s.prDetail[worktreeId]);

  const { checkRuns, reviews, comments, unresolvedComments } = usePrBadgeCounts(worktreeId);

  const [descExpanded, setDescExpanded] = useState(false);

  // Loading skeleton: prDetail not yet loaded
  if (prDetail === undefined) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden py-4">
        <div className="animate-pulse bg-bg-hover rounded h-3 mx-2.5 my-2 w-3/4" />
        <div className="animate-pulse bg-bg-hover rounded h-3 mx-2.5 my-2 w-1/2" />
        <div className="animate-pulse bg-bg-hover rounded h-3 mx-2.5 my-2 w-2/3" />
        <div className="animate-pulse bg-bg-hover rounded h-3 mx-2.5 my-2 w-1/2" />
      </div>
    );
  }

  // Empty state: no PR
  if (!pr) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 px-4 py-8 text-center">
        <GitPullRequestDraft className="text-lg text-text-tertiary/30 mb-2" size={32} />
        <span className="text-xs text-text-tertiary">No pull request</span>
        <span className="text-[10px] text-text-tertiary/60 mt-1">
          Push this branch and open a PR to see checks, reviews, and comments.
        </span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto py-2 flex flex-col">
        {/* Description */}
        {pr.body && (
          <PrDescription body={pr.body} prUrl={pr.url} expanded={descExpanded} onToggle={() => setDescExpanded(!descExpanded)} />
        )}

        {/* Checks section */}
        <Section title="Checks" count={checkRuns.length} summary={checkRuns.length > 0 ? <CheckRunSummary checkRuns={checkRuns} /> : undefined}>
          {checkRuns.length === 0 ? (
            <EmptyRow text="No checks" />
          ) : (
            sortCheckRuns(checkRuns).map((run) => <CheckRunRow key={run.id} run={run} />)
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

    </div>
  );
}

// ── PrRailIcons ────────────────────────────────────────────────────
// Renders the three rail icons (checks, reviews, comments) with badges.

interface PrRailIconsProps {
  worktreeId: string;
}

export function PrRailIcons({ worktreeId }: PrRailIconsProps) {
  const { checkRuns, reviewDecision, failingChecks, pendingChecks, unresolvedComments, approvals } = usePrBadgeCounts(worktreeId);

  return (
    <>
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
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

/** Count media items in a PR body string. */
function countMedia(body: string): { images: number; videos: number } {
  const imgTags = (body.match(/<img[^>]*\/?>/gi) ?? []).length;
  const videoTags = (body.match(/<video[^>]*>[\s\S]*?<\/video>/gi) ?? []).length +
    (body.match(/<video[^>]*\/>/gi) ?? []).length;
  const mdImages = (body.match(/!\[[^\]]*\]\([^)]+\)/g) ?? []).length;
  return { images: imgTags + mdImages, videos: videoTags };
}

/** Lightly format a PR body for display: strip media, render headers as bold, preserve line breaks. */
function formatPrBody(body: string): React.ReactNode[] {
  // Strip HTML img tags, video tags, and markdown images
  const cleaned = body
    .replace(/<img[^>]*\/?>/gi, "")
    .replace(/<video[^>]*>[\s\S]*?<\/video>/gi, "")
    .replace(/<video[^>]*\/?>/gi, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\|[-|]+\|/g, "");

  return cleaned.split("\n").map((line, i) => {
    // ## Headers → bold
    const headerMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headerMatch) {
      return (
        <span key={i} className="block text-text-primary font-semibold mt-1 first:mt-0">
          {headerMatch[1]}
        </span>
      );
    }
    // Blank lines → small spacer
    if (line.trim() === "") {
      return <span key={i} className="block h-1" />;
    }
    // **bold** → <strong>
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return (
      <span key={i} className="block">
        {parts.map((part, j) => {
          const boldMatch = part.match(/^\*\*(.+)\*\*$/);
          if (boldMatch) {
            return <strong key={j} className="text-text-primary">{boldMatch[1]}</strong>;
          }
          return part;
        })}
      </span>
    );
  });
}

function PrDescription({
  body,
  prUrl,
  expanded,
  onToggle,
}: {
  body: string;
  prUrl: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { images, videos } = countMedia(body);
  const hasMedia = images + videos > 0;

  const mediaSummary = [
    images > 0 ? `${images} image${images !== 1 ? "s" : ""}` : null,
    videos > 0 ? `${videos} video${videos !== 1 ? "s" : ""}` : null,
  ].filter(Boolean).join(", ");

  return (
    <div className="px-2.5 py-2 border-b border-border-subtle text-xs text-text-secondary leading-[1.5] overflow-hidden">
      <div className={expanded ? "" : "max-h-[4.5em] overflow-hidden"}>
        {formatPrBody(body)}
      </div>
      <button
        onClick={onToggle}
        className="text-accent-primary text-[10px] mt-1 bg-transparent border-none cursor-pointer p-0 font-[inherit]"
      >
        {expanded ? "Show less" : "Show more"}
      </button>
      {hasMedia && (
        <div className="mt-1.5 pt-1.5 border-t border-border-subtle">
          <a
            href={prUrl}
            target="_blank"
            rel="noreferrer"
            className="text-accent-primary text-[10px] hover:underline"
          >
            View full description on GitHub ↗
          </a>
          <div className="text-[10px] text-text-tertiary mt-0.5">
            {mediaSummary} not shown
          </div>
        </div>
      )}
    </div>
  );
}

type BadgeVariant = "error" | "ok" | "pending" | "info" | "neutral";

function badgeBgClass(variant: BadgeVariant): string {
  switch (variant) {
    case "error": return "bg-diff-removed";
    case "ok": return "bg-diff-added";
    case "pending": return "bg-status-busy";
    case "info": return "bg-accent-primary";
    case "neutral": return "bg-text-tertiary";
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
      className="relative text-text-tertiary leading-none"
      title={title}
    >
      {icon}
      {count > 0 && (
        <span
          className={[
            "absolute -top-[5px] -right-[6px] flex items-center justify-center text-[10px] font-bold text-white rounded-md min-w-[15px] h-[15px] px-0.5 leading-none",
            badgeBgClass(badgeVariant),
          ].join(" ")}
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
  summary,
  children,
}: {
  title: string;
  count: number;
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-1">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <span className="text-2xs uppercase tracking-wider text-text-tertiary font-semibold leading-normal">
          {title}
        </span>
        {count > 0 && (
          <span className="text-[10px] bg-bg-secondary text-text-tertiary rounded-full px-1.5 py-px">
            {count}
          </span>
        )}
        {summary}
      </div>
      {children}
    </div>
  );
}

function CheckRunSummary({ checkRuns }: { checkRuns: CheckRun[] }) {
  const passed = checkRuns.filter((r) => r.status === "completed" && r.conclusion === "success").length;
  const failing = checkRuns.filter((r) => r.status === "completed" && r.conclusion === "failure").length;
  const pending = checkRuns.filter((r) => r.status !== "completed").length;

  const parts: React.ReactNode[] = [];
  if (passed > 0) parts.push(<span key="passed" className="text-diff-added">{passed} passed</span>);
  if (failing > 0) parts.push(<span key="failing" className="text-diff-removed">{failing} failing</span>);
  if (pending > 0) parts.push(<span key="pending" className="text-status-busy">{pending} pending</span>);

  if (parts.length === 0) return null;

  return (
    <span className="text-[10px] ml-auto">
      {parts.reduce<React.ReactNode[]>((acc, part, i) => {
        if (i > 0) acc.push(<span key={`sep-${i}`} className="text-text-tertiary"> &middot; </span>);
        acc.push(part);
        return acc;
      }, [])}
    </span>
  );
}

function sortCheckRuns(checkRuns: CheckRun[]): CheckRun[] {
  return [...checkRuns].sort((a, b) => {
    const priority = (r: CheckRun) => {
      if (r.status === "completed" && r.conclusion === "failure") return 0;
      if (r.status !== "completed") return 1;
      return 2;
    };
    return priority(a) - priority(b);
  });
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="px-2.5 py-1 text-xs text-text-tertiary italic">
      {text}
    </div>
  );
}

function CheckRunRow({ run }: { run: CheckRun }) {
  const isCompleted = run.status === "completed";
  const isSuccess = run.conclusion === "success" || run.conclusion === "skipped";
  const isFailed = isCompleted && !isSuccess && run.conclusion !== null;
  const isPending = !isCompleted;

  const dotColorClass = isFailed
    ? "text-diff-removed"
    : isPending
      ? "text-status-busy"
      : "text-diff-added";

  const bgColorClass = isFailed
    ? "bg-diff-removed"
    : isPending
      ? "bg-status-busy"
      : "bg-diff-added";

  const duration =
    run.startedAt && run.completedAt
      ? formatDuration(
          new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime(),
        )
      : null;

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs">
      {isPending ? (
        <RefreshCw
          size={10}
          className={`${dotColorClass} shrink-0 animate-spin`}
        />
      ) : (
        <span
          className={`w-2 h-2 rounded-full ${bgColorClass} shrink-0 inline-block`}
        />
      )}
      <span
        className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-text-primary"
        title={run.name}
      >
        {run.name}
      </span>
      {duration && (
        <span className="text-text-tertiary shrink-0">
          {duration}
        </span>
      )}
      {isFailed && run.htmlUrl && (
        <IconButton
          size="sm"
          label="View logs"
          className="h-auto w-auto p-0 text-diff-removed hover:text-diff-removed/80 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            openUrl(run.htmlUrl!);
          }}
        >
          <ExternalLink size={11} />
        </IconButton>
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
  const stateColorClass =
    state === "APPROVED"
      ? "text-diff-added"
      : state === "CHANGES_REQUESTED"
        ? "text-diff-removed"
        : "text-text-tertiary";

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
    <div className="flex items-center gap-2 px-2.5 py-1 text-xs">
      {/* Avatar */}
      <div className="w-5 h-5 rounded-full bg-bg-hover flex items-center justify-center text-[10px] font-bold text-text-primary shrink-0">
        {initial}
      </div>
      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-text-primary">
        {reviewer}
      </span>
      <span className={`${stateColorClass} shrink-0 text-[11px]`}>
        {stateLabel}
      </span>
      {submittedAt && (
        <span className="text-text-tertiary shrink-0 text-[10px]">
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
  const [expanded, setExpanded] = useState(false);
  const isLong = body.length > 150;

  return (
    <div
      onClick={onJump}
      className={`mx-1.5 px-2 py-1.5 bg-bg-secondary rounded-md text-xs ${
        resolved ? "border border-border-subtle opacity-50" : "border border-border-default"
      } ${onJump ? "cursor-pointer hover:border-accent-primary/40" : ""}`}
    >
      {/* Author row */}
      <div
        className="flex items-center gap-[5px] mb-[3px]"
      >
        <span className="font-semibold text-text-primary">
          {author}
        </span>
        {path && (
          <span
            className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-text-tertiary text-[11px]"
            title={line != null ? `${path}:${line}` : path}
          >
            {path.split("/").pop()}
            {line != null ? `:${line}` : ""}
          </span>
        )}
        <span className="text-text-tertiary text-[10px] shrink-0">
          {formatTimeAgo(createdAt)}
        </span>
        <IconButton
          size="sm"
          label="Open on GitHub"
          className="h-auto w-auto p-0 text-text-tertiary hover:text-text-primary shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            openUrl(htmlUrl);
          }}
        >
          <ExternalLink size={10} />
        </IconButton>
      </div>

      {/* Body */}
      <p
        className={`m-0 text-text-primary leading-[1.4] ${expanded ? "" : "line-clamp-3"}`}
      >
        {body}
      </p>
      {isLong && (
        <button
          className="text-accent-primary text-[10px] mt-1 bg-transparent border-none cursor-pointer p-0 font-[inherit]"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((prev) => !prev);
          }}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export function MergeStatusBanner({
  worktreeId,
  pr,
  checkRuns,
  mergeable,
  reviewDecision,
  repoPath,
}: {
  worktreeId: string;
  pr: PrStatus;
  checkRuns: CheckRun[];
  mergeable: boolean | null;
  reviewDecision: string | null;
  repoPath: string;
}) {
  const [loading, setLoading] = useState<"rerun" | "fix" | "conflicts" | null>(null);

  const failedChecks = checkRuns.filter(
    (r) => r.status === "completed" && r.conclusion !== "success" && r.conclusion !== "skipped" && r.conclusion !== null,
  );

  const switchToClaudeTab = () => {
    const tabs = useTabStore.getState().tabs[worktreeId] ?? [];
    const claudeTab = tabs.find((t) => t.type === "claude");
    if (claudeTab) {
      useTabStore.getState().setActiveTabId(worktreeId, claudeTab.id);
    }
  };

  const handleRerun = async () => {
    setLoading("rerun");
    try {
      await rerunFailedChecks(repoPath, failedChecks);
    } finally {
      setLoading(null);
    }
  };

  const handleFixChecks = async () => {
    setLoading("fix");
    try {
      const sent = await fixFailingChecks(worktreeId, repoPath, failedChecks);
      if (sent) switchToClaudeTab();
    } finally {
      setLoading(null);
    }
  };

  const handleFixConflicts = async () => {
    setLoading("conflicts");
    try {
      const sent = await fixMergeConflicts(worktreeId, pr.baseBranch ?? "main");
      if (sent) switchToClaudeTab();
    } finally {
      setLoading(null);
    }
  };

  // ── Merged ──
  if (pr.merged) {
    return (
      <div className="px-2.5 py-1.5 bg-accent-primary/10 border-t border-accent-primary/20 text-xs text-accent-primary font-semibold shrink-0">
        Merged{pr.mergedAt ? ` · ${formatTimeAgo(pr.mergedAt)}` : ""}
      </div>
    );
  }

  // ── Closed ──
  if (pr.state === "closed") {
    return (
      <div className="px-2.5 py-1.5 bg-diff-removed/10 border-t border-diff-removed/20 text-xs text-diff-removed font-semibold shrink-0">
        Closed
      </div>
    );
  }

  // ── Priority 1: Merge conflict ──
  if (mergeable === false) {
    return (
      <div className="px-2.5 py-1.5 bg-diff-removed/10 border-t border-diff-removed/20 text-xs text-diff-removed font-semibold shrink-0 flex items-center gap-2">
        <span className="flex-1">Merge conflict</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleFixConflicts}
          disabled={loading !== null}
          className="text-[10px] px-2 py-0.5 h-auto bg-accent-primary/10 border border-accent-primary/30 text-accent-primary hover:bg-accent-primary/20 disabled:opacity-50 font-medium"
        >
          {loading === "conflicts" ? "Sending…" : "Fix conflicts"}
        </Button>
      </div>
    );
  }

  // ── Priority 2: Failing checks ──
  if (failedChecks.length > 0) {
    return (
      <div className="px-2.5 py-1.5 bg-diff-removed/10 border-t border-diff-removed/20 text-xs text-diff-removed font-semibold shrink-0 flex items-center gap-2">
        <span className="flex-1">{failedChecks.length} check{failedChecks.length !== 1 ? "s" : ""} failing</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleRerun}
          disabled={loading !== null}
          className="text-[10px] px-2 py-0.5 h-auto bg-bg-secondary border border-border-default text-text-secondary hover:bg-bg-hover disabled:opacity-50 font-medium"
        >
          {loading === "rerun" ? "Rerunning…" : "Rerun"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleFixChecks}
          disabled={loading !== null}
          className="text-[10px] px-2 py-0.5 h-auto bg-accent-primary/10 border border-accent-primary/30 text-accent-primary hover:bg-accent-primary/20 disabled:opacity-50 font-medium"
        >
          {loading === "fix" ? "Sending…" : "Fix with agent"}
        </Button>
      </div>
    );
  }

  // ── Ready to merge ──
  if (mergeable === true && reviewDecision === "APPROVED") {
    return (
      <div className="px-2.5 py-1.5 bg-diff-added/10 border-t border-diff-added/20 text-xs text-diff-added font-semibold shrink-0">
        Ready to merge
      </div>
    );
  }

  // ── Changes requested ──
  if (reviewDecision === "CHANGES_REQUESTED") {
    return (
      <div className="px-2.5 py-1.5 bg-diff-removed/10 border-t border-diff-removed/20 text-xs text-diff-removed font-semibold shrink-0">
        Changes requested
      </div>
    );
  }

  return null;
}

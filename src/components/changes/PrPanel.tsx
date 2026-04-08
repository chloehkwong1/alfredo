import { useState } from "react";
import {
  ChevronRight,
  CircleCheck,
  Eye,
  MessageCircle,
  GitPullRequestDraft,
} from "lucide-react";
import { usePrStore } from "../../stores/prStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { PrComment, PrReview, Worktree } from "../../types";
import { sendPrCommentToClaude } from "../../services/sendPrCommentToClaude";
import { PrDescription } from "./PrDescription";
import { CheckRunRow, CheckRunSummary, sortCheckRuns } from "./CheckRunRow";
import { ReviewRow } from "./ReviewRow";
import { CommentCard } from "./CommentCard";

// ── Shared badge-count helpers ─────────────────────────────────────

export function usePrBadgeCounts(worktreeId: string) {
  const checkRuns = usePrStore((s) => s.checkRuns[worktreeId]) ?? [];
  const prDetail = usePrStore((s) => s.prDetail[worktreeId]);

  const reviews = prDetail?.reviews ?? [];
  const comments = prDetail?.comments ?? [];
  const mergeable = prDetail?.mergeable ?? null;
  const reviewDecision = prDetail?.reviewDecision ?? null;
  const requestedReviewers = prDetail?.requestedReviewers ?? [];

  // Merge requested reviewers into the reviews list as synthetic "REQUESTED" entries,
  // excluding anyone who already has a submitted review.
  const reviewerLogins = new Set(reviews.map((r) => r.reviewer.toLowerCase()));
  const requestedEntries: PrReview[] = requestedReviewers
    .filter((login) => !reviewerLogins.has(login.toLowerCase()))
    .map((login) => ({ reviewer: login, state: "REQUESTED", submittedAt: null }));
  const allReviews = [...reviews, ...requestedEntries];

  const failingChecks = checkRuns.filter(
    (r) => r.status === "completed" && r.conclusion !== "success" && r.conclusion !== "skipped" && r.conclusion !== null,
  ).length;
  const pendingChecks = checkRuns.filter((r) => r.status !== "completed").length;
  const unresolvedComments = comments.filter((c) => !c.resolved).length;
  const approvals = reviews.filter((r) => r.state === "APPROVED").length;

  return { checkRuns, prDetail, reviews: allReviews, comments, mergeable, reviewDecision, failingChecks, pendingChecks, unresolvedComments, approvals };
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
      <div className="flex-1 overflow-y-auto py-1 flex flex-col">
        {/* Description section */}
        {pr.body && (
          <Section title="Description">
            <PrDescription body={pr.body} prUrl={pr.url} />
          </Section>
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
            <CommentsByFile
              comments={comments}
              worktreeId={worktreeId}
              worktree={worktree}
              onJumpToComment={onJumpToComment}
            />
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

// ── CommentsByFile ────────────────────────────────────────────────
// Groups comments by file path, with each file collapsible.

const FILE_COLLAPSED_KEY = "pr-panel-file-collapsed";

function fileCollapsedKey(worktreeId: string) {
  return `${FILE_COLLAPSED_KEY}:${worktreeId}`;
}

function readFileCollapsedSet(worktreeId: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(fileCollapsedKey(worktreeId)) || "[]"));
  } catch {
    return new Set();
  }
}

function persistFileCollapsedSet(worktreeId: string, s: Set<string>) {
  localStorage.setItem(fileCollapsedKey(worktreeId), JSON.stringify([...s]));
}

function CommentsByFile({
  comments,
  worktreeId,
  worktree,
  onJumpToComment,
}: {
  comments: PrComment[];
  worktreeId: string;
  worktree: Worktree | undefined;
  onJumpToComment: (filePath: string, line: number) => void;
}) {
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(() => readFileCollapsedSet(worktreeId));

  // Group by file path (null path → "General")
  const grouped = new Map<string, PrComment[]>();
  for (const c of comments) {
    const key = c.path ?? "General";
    const arr = grouped.get(key);
    if (arr) arr.push(c);
    else grouped.set(key, [c]);
  }

  function toggleFile(key: string) {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persistFileCollapsedSet(worktreeId, next);
      return next;
    });
  }

  function renderComment(c: PrComment) {
    return (
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
        onSendToClaude={
          worktree
            ? () => sendPrCommentToClaude(worktreeId, worktree.repoPath, worktree.branch, c)
            : undefined
        }
      />
    );
  }

  // Single file (or all general) — render flat, no sub-headers
  if (grouped.size === 1) {
    return <>{comments.map(renderComment)}</>;
  }

  return (
    <>
      {[...grouped.entries()].map(([filePath, fileComments]) => {
        const isCollapsed = collapsedFiles.has(filePath);
        const unresolvedCount = fileComments.filter((c) => !c.resolved).length;
        const displayName = filePath === "General" ? "General" : filePath.split("/").pop() ?? filePath;
        return (
          <div key={filePath} className="mb-px">
            <button
              onClick={() => toggleFile(filePath)}
              className="flex items-center gap-1 px-4 py-1 w-full bg-transparent border-none cursor-pointer text-left font-[inherit] hover:bg-bg-hover/50 rounded-sm"
              title={filePath}
            >
              <ChevronRight
                size={11}
                className={`text-text-tertiary shrink-0 transition-transform duration-150 ${isCollapsed ? "" : "rotate-90"}`}
              />
              <span className="text-[11px] text-text-tertiary font-medium truncate">
                {displayName}
              </span>
              <span className="text-[10px] text-text-tertiary/60 ml-auto shrink-0">
                {unresolvedCount > 0 ? `${unresolvedCount} unresolved` : `${fileComments.length}`}
              </span>
            </button>
            {!isCollapsed && fileComments.map(renderComment)}
          </div>
        );
      })}
    </>
  );
}

// ── Layout primitives (internal) ──────────────────────────────────

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

const STORAGE_KEY = "pr-panel-collapsed";

function readCollapsedMap(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function Section({
  title,
  count,
  summary,
  children,
}: {
  title: string;
  count?: number;
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => readCollapsedMap()[title] ?? false);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    const map = readCollapsedMap();
    map[title] = next;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  }

  return (
    <div className="mb-0.5">
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 px-2.5 py-1.5 w-full bg-transparent border-none cursor-pointer text-left font-[inherit] hover:bg-bg-hover/50 rounded-sm"
      >
        <ChevronRight
          size={14}
          className={`text-text-tertiary shrink-0 transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`}
        />
        <span className="text-xs text-text-secondary font-semibold leading-normal">
          {title}
        </span>
        {count != null && count > 0 && (
          <span className="text-[10px] bg-bg-secondary text-text-tertiary rounded-full px-1.5 py-px">
            {count}
          </span>
        )}
        {summary}
      </button>
      {!collapsed && children}
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="px-2.5 py-1 text-xs text-text-tertiary italic">
      {text}
    </div>
  );
}

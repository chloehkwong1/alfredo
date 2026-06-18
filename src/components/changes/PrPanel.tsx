import { useState } from "react";
import {
  Check,
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
  onJumpToComment: (filePath: string, line?: number) => void;
}

export function PrPanelContent({ worktreeId, onJumpToComment }: PrPanelContentProps) {
  const worktree = useWorkspaceStore((s) => s.worktrees.find((w) => w.id === worktreeId));
  const pr = worktree?.prStatus ?? null;
  const prDetail = usePrStore((s) => s.prDetail[worktreeId]);

  const { checkRuns, reviews, comments } = usePrBadgeCounts(worktreeId);

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
        <span className="text-[13px] text-text-tertiary">No pull request</span>
        <span className="text-[11px] text-text-tertiary/60 mt-1">
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
              <ReviewRow key={`${r.reviewer}-${r.submittedAt}`} reviewer={r.reviewer} state={r.state} submittedAt={r.submittedAt} body={r.body} />
            ))
          )}
        </Section>

        {/* Comments section */}
        <Section title="Comments" count={comments.length}>
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

  // Monochrome badges drop the colour cue, so the tooltip carries the state
  // (pass/fail/pending, review decision) the colour used to convey on hover.
  const checksTitle =
    failingChecks > 0 ? `${failingChecks} check${failingChecks !== 1 ? "s" : ""} failing`
    : pendingChecks > 0 ? `${pendingChecks} check${pendingChecks !== 1 ? "s" : ""} running`
    : checkRuns.length > 0 ? `${checkRuns.length} check${checkRuns.length !== 1 ? "s" : ""} passing`
    : "No checks";
  const reviewsTitle =
    reviewDecision === "CHANGES_REQUESTED" ? "Changes requested"
    : reviewDecision === "APPROVED" ? "Approved"
    : approvals > 0 ? `${approvals} approval${approvals !== 1 ? "s" : ""}`
    : "Reviews";
  const commentsTitle =
    unresolvedComments > 0 ? `${unresolvedComments} unresolved comment${unresolvedComments !== 1 ? "s" : ""}` : "Comments";

  return (
    <>
      {/* Checks icon + badge — icon turns red when checks are failing */}
      <RailIcon
        icon={<CircleCheck size={16} />}
        count={failingChecks > 0 ? failingChecks : pendingChecks > 0 ? pendingChecks : checkRuns.length}
        attention={failingChecks > 0}
        title={checksTitle}
      />

      {/* Reviews icon + badge — icon turns red when changes are requested */}
      <RailIcon
        icon={<Eye size={16} />}
        count={approvals}
        attention={reviewDecision === "CHANGES_REQUESTED"}
        title={reviewsTitle}
      />

      {/* Comments icon + badge */}
      <RailIcon
        icon={<MessageCircle size={16} />}
        count={unresolvedComments}
        title={commentsTitle}
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
  onJumpToComment: (filePath: string, line?: number) => void;
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
          c.path
            ? () => onJumpToComment(c.path!, c.line ?? undefined)
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

  const unresolved = comments.filter((c) => !c.resolved);
  const resolved = comments.filter((c) => c.resolved);

  // Single file (or all general) — render flat, no sub-headers
  if (grouped.size === 1) {
    return (
      <>
        {unresolved.length > 0 && (
          <div className="space-y-1.5">
            {unresolved.map(renderComment)}
          </div>
        )}
        {resolved.length > 0 && (
          <ResolvedToggle count={resolved.length}>
            {resolved.map(renderComment)}
          </ResolvedToggle>
        )}
      </>
    );
  }

  return (
    <>
      {[...grouped.entries()].map(([filePath, fileComments]) => {
        const fileUnresolved = fileComments.filter((c) => !c.resolved);
        const fileResolved = fileComments.filter((c) => c.resolved);
        const allFileResolved = fileUnresolved.length === 0 && fileResolved.length > 0;
        // Auto-collapse fully-resolved files unless the user explicitly expanded them
        const isCollapsed = allFileResolved
          ? !collapsedFiles.has(`${filePath}:expanded`)
          : collapsedFiles.has(filePath);
        const displayName = filePath === "General" ? "PR conversation" : filePath.split("/").pop() ?? filePath;

        // Fully-resolved files: compact single row
        if (allFileResolved && isCollapsed) {
          return (
            <button
              key={filePath}
              onClick={() => toggleFile(`${filePath}:expanded`)}
              className="flex items-center gap-1.5 px-4 py-1 w-full bg-transparent border-none cursor-pointer text-left font-[inherit] hover:bg-bg-hover/50 rounded-sm"
              title={filePath}
            >
              <Check size={11} className="text-diff-added shrink-0" />
              <span className="text-[13px] text-text-tertiary/70 truncate">
                {displayName}
              </span>
              <span className="text-[11px] text-text-tertiary/60 ml-auto shrink-0">
                {fileResolved.length} resolved
              </span>
              <ChevronRight size={11} className="text-text-tertiary/40 shrink-0" />
            </button>
          );
        }

        return (
          <div key={filePath} className="mb-px">
            <button
              onClick={() => toggleFile(allFileResolved ? `${filePath}:expanded` : filePath)}
              className="flex items-center gap-1.5 px-4 py-1.5 w-full bg-transparent border-none cursor-pointer text-left font-[inherit] hover:bg-bg-hover/50 rounded-sm"
              title={filePath}
            >
              <ChevronRight
                size={12}
                className={`text-text-tertiary shrink-0 transition-transform duration-150 ${isCollapsed ? "" : "rotate-90"}`}
              />
              <span className="text-[13px] text-text-primary font-medium truncate">
                {displayName}
              </span>
              <span className={`text-[11px] ml-auto shrink-0 ${fileUnresolved.length > 0 ? "text-status-busy" : "text-text-tertiary"}`}>
                {fileUnresolved.length > 0 ? `${fileUnresolved.length} unresolved` : `${fileComments.length}`}
              </span>
            </button>
            {!isCollapsed && (
              <>
                {fileUnresolved.length > 0 && (
                  <div className="space-y-1.5">
                    {fileUnresolved.map(renderComment)}
                  </div>
                )}
                {fileResolved.length > 0 && (
                  <ResolvedToggle count={fileResolved.length}>
                    {fileResolved.map(renderComment)}
                  </ResolvedToggle>
                )}
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

// ── ResolvedToggle ───────────────────────────────────────────────

function ResolvedToggle({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-1.5 mt-2 pt-1.5 border-t border-border-subtle">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-1.5 py-1 w-full bg-transparent border-none cursor-pointer text-left font-[inherit] hover:bg-bg-hover/50 rounded-sm"
      >
        <Check size={11} className="text-diff-added shrink-0" />
        <span className="text-[11px] text-text-tertiary">
          {count} resolved
        </span>
        <ChevronRight
          size={11}
          className={`text-text-tertiary shrink-0 transition-transform duration-150 ml-auto ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && children}
    </div>
  );
}

// ── Layout primitives (internal) ──────────────────────────────────


function RailIcon({
  icon,
  count,
  attention = false,
  title,
}: {
  icon: React.ReactNode;
  count: number;
  // Tints the icon (not the badge) to flag something that needs attention —
  // failing checks, changes requested. Badges stay neutral; colour lives on
  // the icon, matching how status is signalled elsewhere in the app.
  attention?: boolean;
  title: string;
}) {
  return (
    <div
      className={`relative leading-none ${attention ? "text-status-error" : "text-text-tertiary"}`}
      title={title}
    >
      {icon}
      {count > 0 && (
        <span className="absolute -top-1 -right-1 flex items-center justify-center text-[9px] font-semibold leading-none min-w-[14px] px-1 py-px rounded-sm bg-white/5 text-text-tertiary">
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
  attentionCount,
  summary,
  children,
}: {
  title: string;
  count?: number;
  attentionCount?: number;
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

  const hasAttention = attentionCount != null && attentionCount > 0;

  return (
    <div className="mb-0.5">
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 px-2.5 py-2 w-full bg-transparent border-none cursor-pointer text-left font-[inherit] hover:bg-bg-hover/50 rounded-sm"
      >
        <ChevronRight
          size={14}
          className={`text-text-tertiary shrink-0 transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`}
        />
        <span className="text-[13px] text-text-secondary font-semibold leading-normal">
          {title}
        </span>
        {count != null && count > 0 && (
          <span className="text-[11px] bg-bg-hover text-text-secondary rounded-full px-1.5 py-px">
            {count}
          </span>
        )}
        {hasAttention && (
          <span className="text-[11px] text-status-busy">
            {attentionCount} unresolved
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
    <div className="px-2.5 py-1.5 text-[13px] text-text-tertiary italic">
      {text}
    </div>
  );
}

import type { ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CommentsByFile, PR_STATE_ICONS, usePrBadgeCounts } from "./PrPanel";
import { PrDescription } from "./PrDescription";
import { ReviewDraftSection } from "./ReviewDraftSection";
import { CheckRunRow, CheckRunSummary, sortCheckRuns } from "./CheckRunRow";
import { ReviewRow } from "./ReviewRow";
import { PrFileList } from "./PrFileList";
import { useGithubUsername } from "../../hooks/useGithubUsername";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { prStateKind, prStatusLabel } from "../../lib/prStatus";
import type { DiffFile } from "../../types";

interface PrOverviewProps {
  worktreeId: string;
  repoPath: string;
  files: DiffFile[];
  activeFilePath: string | null;
  onSelectFile: (path: string) => void;
  onJumpToComment: (filePath: string, line?: number) => void;
}

/** Wide PR review layout shown when the Changes panel is focus-mode-widened
 *  on the PR tab — a hero + persistent rail (Linear's Overview tab), as
 *  opposed to PrPanelContent's narrow collapsible-sections sidebar. */
export function PrOverview({ worktreeId, repoPath, files, activeFilePath, onSelectFile, onJumpToComment }: PrOverviewProps) {
  const githubUsername = useGithubUsername();
  const worktree = useWorkspaceStore((s) => s.worktrees.find((w) => w.id === worktreeId));
  const pr = worktree?.prStatus ?? null;
  const { checkRuns, prDetail, reviews, comments } = usePrBadgeCounts(worktreeId);

  if (!pr) return null;

  const isOwnPr =
    pr.author != null && githubUsername != null && pr.author.toLowerCase() === githubUsername.toLowerCase();

  const status = prStatusLabel(pr);
  const StatusIcon = PR_STATE_ICONS[prStateKind(pr)];
  // get_pr_detail still in flight — mirror PrPanelContent's skeleton so the
  // rail never asserts a definitive "No checks" / "No reviewers" it can't know.
  const detailLoading = prDetail === undefined;

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Main column */}
      <div className="flex-1 overflow-y-auto min-w-0">
        <div className="px-4 py-3 border-b border-border-subtle">
          <div className={`flex items-center gap-1.5 text-[11px] font-medium mb-1.5 ${status.className}`}>
            <StatusIcon size={13} />
            {status.text}
            <span className="text-text-tertiary font-normal">#{pr.number}</span>
          </div>
          <h2 className="text-[15px] font-semibold text-text-primary leading-snug mb-1.5">
            <button
              onClick={() => openUrl(pr.url)}
              className="text-left hover:underline bg-transparent border-none cursor-pointer p-0 font-[inherit] text-inherit"
            >
              {pr.title}
            </button>
          </h2>
          <div className="flex items-center gap-2 text-[12px] text-text-tertiary">
            {pr.author && (
              <span className="flex items-center gap-1">
                <span className="w-4 h-4 rounded-full bg-bg-hover flex items-center justify-center text-[10px] font-semibold text-text-primary">
                  {pr.author.charAt(0).toUpperCase()}
                </span>
                {pr.author}
              </span>
            )}
            <span className="font-mono truncate">
              {pr.baseBranch ?? "main"} ← {pr.branch}
            </span>
          </div>
        </div>

        {pr.body && (
          <div className="px-4 py-3 border-b border-border-subtle">
            <PrDescription body={pr.body} prUrl={pr.url} />
          </div>
        )}

        <div className="px-4 py-3 border-b border-border-subtle">
          <ReviewDraftSection worktreeId={worktreeId} repoPath={repoPath} prNumber={pr.number} isOwnPr={isOwnPr} />
        </div>

        {/* Comments — same grouped-by-file UI as the narrow PR panel, so
            review threads stay reachable without leaving focus mode. */}
        <div className="px-4 py-3">
          <div className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide mb-2">
            Comments
          </div>
          {detailLoading ? (
            <RailSkeleton />
          ) : comments.length === 0 ? (
            <EmptyRailRow text="No comments" />
          ) : (
            <CommentsByFile
              comments={comments}
              worktreeId={worktreeId}
              worktree={worktree}
              onJumpToComment={onJumpToComment}
            />
          )}
        </div>
      </div>

      {/* Rail */}
      <div className="w-64 shrink-0 border-l border-border-subtle overflow-y-auto flex flex-col">
        <RailSection title="Checks">
          {detailLoading ? (
            <RailSkeleton />
          ) : checkRuns.length === 0 ? (
            <EmptyRailRow text="No checks" />
          ) : (
            <>
              <div className="px-2.5 pb-1">
                <CheckRunSummary checkRuns={checkRuns} />
              </div>
              {sortCheckRuns(checkRuns).map((run) => (
                <CheckRunRow key={run.id} run={run} />
              ))}
            </>
          )}
        </RailSection>

        <RailSection title="Reviewers">
          {detailLoading ? (
            <RailSkeleton />
          ) : reviews.length === 0 ? (
            <EmptyRailRow text="No reviewers" />
          ) : (
            reviews.map((r) => (
              <ReviewRow key={`${r.reviewer}-${r.submittedAt}`} reviewer={r.reviewer} state={r.state} submittedAt={r.submittedAt} body={r.body} />
            ))
          )}
        </RailSection>

        <RailSection title="Files changed" flush>
          <PrFileList
            worktreeId={worktreeId}
            repoPath={repoPath}
            prNumber={pr.number}
            files={files}
            activeFilePath={activeFilePath}
            onSelectFile={onSelectFile}
          />
        </RailSection>
      </div>
    </div>
  );
}

function RailSection({ title, children, flush }: { title: string; children: ReactNode; flush?: boolean }) {
  return (
    <div className="border-b border-border-subtle last:border-b-0">
      <div className="px-2.5 py-2 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">{title}</div>
      <div className={flush ? "" : "pb-1"}>{children}</div>
    </div>
  );
}

function EmptyRailRow({ text }: { text: string }) {
  return <div className="px-2.5 py-1.5 text-[13px] text-text-tertiary italic">{text}</div>;
}

function RailSkeleton() {
  return (
    <div className="px-2.5 pb-2">
      <div className="animate-pulse bg-bg-hover rounded h-3 my-2 w-3/4" />
      <div className="animate-pulse bg-bg-hover rounded h-3 my-2 w-1/2" />
    </div>
  );
}

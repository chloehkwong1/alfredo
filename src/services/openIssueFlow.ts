import { createWorktreeFrom, searchLinearIssues, setWorktreeLinearTicket } from "../api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { useToastStore } from "../stores/toastStore";
import { useOpenIssueProgress } from "../stores/openIssueProgressStore";
import { ensureAgentSession, getAgentSessionInfo, writeToSession, focusAgentTab } from "./agentMessenger";
import { sessionManager } from "./sessionManager";
import type { OpenIssueRequest } from "./linearOpenIssue";
import type { Worktree, LinearTicket } from "../types";

/**
 * Window event asking the UI to let the user pick a repo for an open-issue
 * request whose repo couldn't be resolved. Linear's "Custom link" mode sends
 * only `{{prompt}}` (no workdir), so the deep-link handler dispatches this and
 * `OpenIssueRepoPicker` (mounted in AppShell) runs `openIssueInRepo` on choice.
 */
export const OPEN_ISSUE_PICK_REPO_EVENT = "alfredo:open-issue-pick-repo";

/** The normalised, repo-agnostic essence of an open-issue request. */
export interface OpenIssuePayload {
  /** Fully-formatted text to paste into the agent's input. */
  prompt: string;
  /** Branch the worktree is created on. */
  branch: string;
  /** Linear identifier for the StatusBar chip (best-effort), or null. */
  issueId: string | null;
}

/** Detail payload of {@link OPEN_ISSUE_PICK_REPO_EVENT}. */
export type PickRepoDetail = OpenIssuePayload;

// Linear's prompt template (Settings → coding tools) renders as e.g.
//   "Work on Linear issue ENG-412:\n\nSuggested branch name: chloe/eng-412-…\n\n<context>"
const ISSUE_HEADER_RE = /Work on (?:this )?Linear issue(?:\s+([^\s:]+))?:/;
const BRANCH_RE = /^Suggested branch name:\s*(\S+)\s*$/m;

/**
 * Normalise a raw {@link OpenIssueRequest} into `{prompt, branch, issueId}`.
 *
 * Linear's "Custom link" mode fills only `{{prompt}}` (the rendered template),
 * so branch/issueId arrive empty and we recover them from the prompt text — and
 * the prompt is already a complete message, so it's pasted as-is. The legacy
 * argv path supplies branch/issueId structurally and sends only the `<issue>`
 * block, so we synthesise the "Work on … / Suggested branch name: …" header to
 * match what Linear's template would have produced.
 */
export function prepareOpenIssue(req: OpenIssueRequest): OpenIssuePayload {
  const promptHasHeader = ISSUE_HEADER_RE.test(req.prompt);
  const branch = req.branch || req.prompt.match(BRANCH_RE)?.[1] || "";
  const issueId = req.issueId || req.prompt.match(ISSUE_HEADER_RE)?.[1] || null;

  const prompt = promptHasHeader
    ? req.prompt
    : [
        issueId ? `Work on Linear issue ${issueId}:` : "Work on this Linear issue:",
        "",
        `Suggested branch name: ${branch}`,
        "",
        req.prompt,
      ].join("\n");

  return { prompt, branch, issueId };
}

/**
 * Wait until a freshly-spawned agent's boot output has settled, so a pasted
 * prompt lands in the input box instead of colliding with the still-rendering
 * boot banner. Resolves once output has been quiet for `quietMs`, or after
 * `timeoutMs` (paste anyway rather than hang).
 */
async function waitForAgentReady(
  session: { lastOutputAt: number; agentState: string },
  { quietMs = 1200, timeoutMs = 20000 }: { quietMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const booted = session.lastOutputAt > 0;
    const settled = Date.now() - session.lastOutputAt > quietMs;
    const notBusy = session.agentState !== "busy" && session.agentState !== "notRunning";
    if (booted && settled && notBusy) return;
    await new Promise((r) => setTimeout(r, 150));
  }
}

/**
 * Poll until the terminal component's usePty hook has spawned a PTY for this
 * worktree's agent tab — i.e. a session exists in the manager WITH a real
 * sessionId. We resolve the session key the same way usePty does
 * (getAgentSessionInfo) so we observe the exact session it spawned. Returns the
 * session, or null on timeout. usePty must be the SOLE spawner: an eager spawn
 * here would race it and leave input/resize unwired.
 */
async function waitForSpawnedSession(
  worktreeId: string,
  { timeoutMs = 15000 }: { timeoutMs?: number } = {},
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { sessionKey } = getAgentSessionInfo(worktreeId);
    const session = sessionManager.getSession(sessionKey);
    if (session?.sessionId) return session;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/**
 * Build the full prompt from a fetched ticket. Linear truncates `{{prompt}}` in
 * the Custom-link URL for long issues (it appends "[Truncated …]"), so we paste
 * the API's complete title + description instead, under the same "Work on … /
 * Suggested branch name: …" header Linear's template uses.
 */
function buildIssuePrompt(ticket: LinearTicket, branch: string): string {
  return [
    `Work on Linear issue ${ticket.identifier}:`,
    "",
    `Suggested branch name: ${branch}`,
    "",
    `# ${ticket.title}`,
    "",
    ticket.description ?? "",
  ].join("\n");
}

/**
 * Create-or-focus the worktree for `branch` in `repoPath`, launch Claude, wait
 * until its boot output settles, then paste `prompt` into the input for the user
 * to edit + submit. Shared by the matched-repo deep-link path and the repo
 * picker. Mirrors CreateWorktreeDialog's create flow (placeholder → create →
 * replace → ensureDefaultTabs); in particular it never activates the placeholder
 * (a creating:true, path:"" worktree), which would wedge the layout.
 */
export async function openIssueInRepo(
  repoPath: string,
  { prompt, branch, issueId }: OpenIssuePayload,
): Promise<void> {
  // Progress overlay: create → boot → paste takes a few seconds and otherwise
  // reads as "nothing happened". Shown until the paste lands (or the flow bails)
  // via the `finally` below.
  const repoName = repoPath.split("/").filter(Boolean).pop() ?? "the repo";
  const worktreeId = `${repoPath}::${branch}`;
  useOpenIssueProgress.getState().start({ worktreeId, label: issueId ?? branch, repo: repoName });

  // Fetch the full issue up front so it overlaps worktree creation + Claude boot
  // rather than adding latency before the paste. Linear truncates {{prompt}} in
  // the Custom-link URL for long issues, so we paste the API's complete body —
  // and reuse the same ticket for the StatusBar chip (one fetch, not two). Falls
  // back to the (possibly truncated) URL prompt if the lookup fails (offline).
  const ticketPromise: Promise<LinearTicket | null> = issueId
    ? searchLinearIssues(issueId)
        .then((m) => m.find((t) => t.identifier === issueId) ?? null)
        .catch(() => null)
    : Promise.resolve(null);

  try {
    if (!useWorkspaceStore.getState().worktrees.some((wt) => wt.id === worktreeId)) {
      const placeholder: Worktree = {
        id: worktreeId,
        name: branch,
        path: "",
        branch,
        prStatus: null,
        agentStatus: "notRunning",
        column: "inProgress",
        isBranchMode: false,
        additions: null,
        deletions: null,
        repoPath,
        creating: true,
      };
      useWorkspaceStore.getState().addWorktree(placeholder);
      try {
        const real = await createWorktreeFrom(repoPath, {
          kind: "newBranch",
          name: branch,
          base: "main", // TODO: resolve the repo's real default branch instead of assuming main
        });
        useWorkspaceStore.getState().replaceWorktree(worktreeId, real);
        try {
          useTabStore.getState().ensureDefaultTabs(real.id);
        } catch (e) {
          console.error("[linear] ensureDefaultTabs failed:", e);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const marked = useWorkspaceStore.getState().failWorktree(worktreeId, message);
        if (!marked) {
          useToastStore.getState().show({ message: `Worktree creation failed: ${message}` });
        }
        return;
      }
    }

    // Don't yank focus away from a worktree the user is already working in: if one
    // is focused, open this issue in the BACKGROUND (spawn its agent + paste the
    // prompt, but leave the active worktree alone). Only auto-navigate when nothing
    // is focused — a cold start or an empty workspace.
    const focusedId = useWorkspaceStore.getState().activeWorktreeId;
    const openInBackground = !!focusedId && focusedId !== worktreeId;

    let session;
    if (openInBackground) {
      // No terminal mounts to spawn the PTY for us, so spawn it directly. Safe to
      // be the spawner here precisely because the worktree isn't active — usePty
      // isn't racing us, and when the user switches to it later usePty attaches to
      // this already-spawned session and wires up input/resize.
      try {
        session = await ensureAgentSession(worktreeId, repoPath, branch);
      } catch (e) {
        console.error("[linear] background agent spawn failed:", e);
        return;
      }
    } else {
      // Navigate to the worktree and focus its agent tab. This MOUNTS the terminal
      // component, whose usePty hook spawns the PTY (it must be the SOLE spawner —
      // an eager spawn here would race it and leave input/resize unwired). Wait for
      // that spawn to finish, then paste.
      useWorkspaceStore.getState().setActiveWorktree(worktreeId);
      focusAgentTab(worktreeId);
      session = await waitForSpawnedSession(worktreeId);
    }

    if (!session?.sessionId) return;
    await waitForAgentReady(session);

    // Prefer the full fetched issue; fall back to the URL prompt (may be Linear-
    // truncated) if the lookup failed.
    const ticket = await ticketPromise;
    await writeToSession(
      session.sessionId,
      ticket?.description ? buildIssuePrompt(ticket, branch) : prompt,
    );

    // StatusBar chip — reuse the ticket we already fetched (no second lookup).
    if (ticket) {
      useWorkspaceStore.getState().updateWorktree(worktreeId, {
        linearTicketUrl: ticket.url,
        linearTicketIdentifier: ticket.identifier,
      });
      const name = useWorkspaceStore.getState().worktrees.find((w) => w.id === worktreeId)?.name;
      if (name) {
        void setWorktreeLinearTicket(repoPath, name, ticket.url, ticket.identifier).catch((e) =>
          console.warn("[linear] failed to persist ticket link:", e),
        );
      }
    }
  } finally {
    useOpenIssueProgress.getState().stop();
  }
}

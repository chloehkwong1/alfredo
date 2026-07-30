import { createWorktreeFrom, debugLog, getConfig, getDefaultBranch, listWorktrees, searchLinearIssues, setWorktreeLinearTicket } from "../api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { useToastStore } from "../stores/toastStore";
import { useOpenIssueProgress } from "../stores/openIssueProgressStore";
import { ensureAgentSession, getAgentSessionInfo, writeToSession, focusAgentTab } from "./agentMessenger";
import { sessionManager } from "./sessionManager";
import { buildPasteMessage } from "./linearPrompt";
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
 * Strip the "Work on … / Suggested branch name: …" preamble from a deep-link
 * prompt, leaving the issue body. Used as the `{{description}}` fallback when
 * the ticket fetch failed — a template's description slot should get the body,
 * not the whole synthesized header.
 */
function deriveFallbackDescription(prompt: string): string {
  const lines = prompt.split("\n");
  const headerIdx = lines.findIndex((l) => ISSUE_HEADER_RE.test(l));
  if (headerIdx !== -1) lines.splice(headerIdx, 1);
  const branchIdx = lines.findIndex((l) => BRANCH_RE.test(l));
  if (branchIdx !== -1) lines.splice(branchIdx, 1);
  while (lines.length && lines[0].trim() === "") lines.shift();
  return lines.join("\n");
}

/**
 * Wait until a freshly-spawned agent's boot output has settled, so a pasted
 * prompt lands in the input box instead of colliding with the still-rendering
 * boot banner. Returns true once output has been quiet for `quietMs` with the
 * agent in a non-busy state; returns false after `timeoutMs` — callers paste
 * anyway rather than hang, but the auto-submit gate must see a real ready.
 */
async function waitForAgentReady(
  session: { lastOutputAt: number; agentState: string },
  { quietMs = 1200, timeoutMs = 20000 }: { quietMs?: number; timeoutMs?: number } = {},
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const booted = session.lastOutputAt > 0;
    const settled = Date.now() - session.lastOutputAt > quietMs;
    const notBusy = session.agentState !== "busy" && session.agentState !== "notRunning";
    if (booted && settled && notBusy) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

/**
 * Wait until the paste's echo has stopped advancing the terminal: quiet for
 * `quietMs` measured from the paste itself or the last output byte, whichever
 * is later, hard-capped at `capMs`. A multi-KB paste can still be mid-ingestion
 * after any fixed delay, and an Enter landing mid-ingestion splits the text
 * into a partial submit. Returns false when the cap elapsed without a quiet
 * window — callers must then skip the submit rather than risk the split.
 */
async function waitForPasteEchoSettle(
  session: { lastOutputAt: number },
  { quietMs = 250, capMs = 2000 }: { quietMs?: number; capMs?: number } = {},
): Promise<boolean> {
  const pastedAt = Date.now();
  while (Date.now() - pastedAt < capMs) {
    if (Date.now() - Math.max(session.lastOutputAt, pastedAt) >= quietMs) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
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
 * Poll until a worktree id appears in the workspace store, or time out. Used on
 * cold start, where an open-issue request can outrun useSessionRestore's
 * hydration: a worktree that already exists on disk (same Linear link
 * re-clicked after a restart) isn't in the store yet, and we must wait for
 * hydration to surface it — never seed it ourselves, because restoreTabs
 * replaces a worktree's tabs wholesale and would orphan any session we'd
 * spawned against self-made tabs.
 */
async function waitForWorktreeInStore(
  worktreeId: string,
  { timeoutMs = 15000 }: { timeoutMs?: number } = {},
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (useWorkspaceStore.getState().worktrees.some((wt) => wt.id === worktreeId)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
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
  baseOverride?: string,
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

  // Per-repo personal config (linearPromptTemplate / linearAutoSubmit),
  // fetched in parallel with the ticket so it adds no latency before the
  // paste. Failure falls through to the default prompt — never block the flow.
  const configPromise = getConfig(repoPath).catch(() => null);

  // True only when THIS invocation created the worktree (and therefore its
  // session is freshly spawned with an empty input box). Re-opens of existing
  // worktrees may target a session holding the user's half-typed draft, so
  // auto-submit is restricted to fresh creates.
  let createdWorktree = false;

  try {
    if (!useWorkspaceStore.getState().worktrees.some((wt) => wt.id === worktreeId)) {
      // The store isn't ground truth on cold start (hydration may still be
      // running), and re-creating an on-disk worktree throws a git "already
      // exists" error that aborts the whole flow. Ask git itself; when the
      // worktree exists, wait for hydration to surface it and fall through to
      // the shared focus/spawn/paste path below.
      const onDisk = await listWorktrees(repoPath).catch(() => [] as Worktree[]);
      if (onDisk.some((wt) => wt.id === worktreeId)) {
        if (!(await waitForWorktreeInStore(worktreeId))) {
          useToastStore.getState().show({
            message: `A worktree for ${branch} already exists but its repo didn't load — open it from the sidebar.`,
          });
          return;
        }
      } else {
        const placeholder: Worktree = {
          id: worktreeId,
          name: branch,
          // Empty path: setup-complete buffer's path-fallback match is a no-op (id-match only)
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
          // Use the caller's chosen base branch when supplied (the repo picker lets
          // the user override it). Otherwise resolve the repo's real default branch
          // (master/develop/trunk/…) rather than assuming "main" — createWorktreeFrom
          // throws on any repo without a `main` ref. Falls back to "main" only if
          // resolution fails (matches the prior behaviour).
          const base = baseOverride || (await getDefaultBranch(repoPath).catch(() => "main"));
          const real = await createWorktreeFrom(repoPath, {
            kind: "newBranch",
            name: branch,
            base,
          });
          useWorkspaceStore.getState().replaceWorktree(worktreeId, real);
          createdWorktree = true;
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
    const ready = await waitForAgentReady(session);

    // Prefer the full fetched issue; fall back to the URL prompt (may be Linear-
    // truncated) if the lookup failed. A configured per-repo template overrides
    // the built-in format entirely.
    const ticket = await ticketPromise;
    const repoConfig = await configPromise;
    await writeToSession(
      session.sessionId,
      buildPasteMessage({
        template: repoConfig?.linearPromptTemplate,
        ticket,
        fallbackPrompt: prompt,
        fallbackDescription: deriveFallbackDescription(prompt),
        branch,
        issueId,
      }),
    );

    // Opt-in hands-off mode: press Enter for the user — but only when every
    // safety gate holds. Pasting is harmless; submitting is not, so any doubt
    // downgrades to paste-only with a log of the first failing gate.
    if (repoConfig?.linearAutoSubmit) {
      // Mirror every auto-submit outcome into alfredo.log: on an installed
      // build the webview console is unreachable, and a silently-skipped
      // submit is otherwise indistinguishable from a broken flow.
      const note = (msg: string) => {
        console.info(msg);
        void debugLog(msg).catch(() => {});
      };
      const skipReason =
        // Fresh worktree ⇒ freshly-spawned session ⇒ no half-typed user draft
        // in the input that Enter would submit as part of the prompt.
        !createdWorktree
          ? "existing worktree (session input may hold a user draft)"
          // waitForAgentReady timing out means we never observed a settled,
          // non-busy agent — Enter could land on a trust dialog or mid-boot.
          : !ready
            ? "agent never settled before the ready timeout"
            // Degraded input: only the possibly-Linear-truncated URL prompt was
            // pasted. Never go hands-off on it.
            : !ticket
              ? "ticket fetch failed (pasted prompt may be truncated)"
              : null;
      if (skipReason) {
        note(`[linear] auto-submit skipped: ${skipReason}`);
      } else if (!(await waitForPasteEchoSettle(session))) {
        // The paste's echo never went quiet — Enter now could split the text.
        note("[linear] auto-submit skipped: paste echo never settled");
      } else if (session.agentState !== "idle") {
        // Submit-time state must be affirmatively safe: "idle" is the only
        // AgentState meaning "awaiting a new message". waitingForInput means a
        // parked question/trust dialog whose default Enter would accept;
        // busy/notRunning mean the input isn't ours to submit.
        note(`[linear] auto-submit skipped: agent state is "${session.agentState}", not idle`);
      } else {
        await writeToSession(session.sessionId, "\r");
        note(`[linear] auto-submit: Enter sent to session ${session.sessionId} (worktree ${worktreeId})`);
      }
    }

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

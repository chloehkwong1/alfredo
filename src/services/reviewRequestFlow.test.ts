import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api", () => ({
  createWorktreeFrom: vi.fn(),
  listWorktrees: vi.fn().mockResolvedValue([]),
}));
// Session machinery mocked solely so the no-spawn invariant below can assert
// against it — the flow must never import/call these (usePty is the sole
// spawner; these worktrees are auto-created for the whole team every poll).
vi.mock("./agentMessenger", () => ({
  writeToSession: vi.fn(),
  focusAgentTab: vi.fn(),
}));
vi.mock("./openIssueFlow", () => ({
  waitForSpawnedSession: vi.fn(),
  waitForAgentReady: vi.fn().mockResolvedValue(true),
}));

import { createWorktreeFrom, listWorktrees } from "../api";
import { writeToSession } from "./agentMessenger";
import { waitForSpawnedSession } from "./openIssueFlow";
import { handleReviewRequests } from "./reviewRequestFlow";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { usePrStore } from "../stores/prStore";

function makePr(overrides: Record<string, unknown> = {}) {
  return {
    number: 42,
    state: "open",
    title: "Fix the flux capacitor",
    url: "https://github.com/acme/app/pull/42",
    draft: false,
    merged: false,
    branch: "feat/flux",
    autoColumn: "needsReview",
    repoPath: "/repos/app",
    author: "teammate",
    requestedReviewers: ["chloe"],
    reviewRequested: true,
    baseBranch: "main",
    checkRuns: [],
    reviews: [],
    comments: null,
    ...overrides,
  } as never;
}

describe("handleReviewRequests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({ worktrees: [], activeWorktreeId: null });
    usePrStore.getState().clearStore();
    vi.mocked(listWorktrees).mockResolvedValue([]);
  });

  it("creates a worktree for a review-requested PR via the pullRequest source", async () => {
    vi.mocked(createWorktreeFrom).mockResolvedValue({
      id: "/repos/app::feat/flux", name: "feat/flux", path: "/repos/app-wt/feat-flux",
      branch: "feat/flux", prStatus: null, agentStatus: "notRunning", column: "inProgress",
      isBranchMode: false, additions: null, deletions: null, repoPath: "/repos/app",
    } as never);
    await handleReviewRequests([makePr()]);
    expect(createWorktreeFrom).toHaveBeenCalledWith("/repos/app", { kind: "pullRequest", number: 42 });
    const wt = useWorkspaceStore.getState().worktrees.find((w) => w.id === "/repos/app::feat/flux");
    expect(wt).toBeDefined();
    expect(wt?.column).toBe("needsReview");
  });

  // Rust's determine_column now sends "needsReview" even for review-requested
  // drafts, so "draftPr" is a synthetic value here — the point is the store
  // honours whatever column Rust computed instead of hardcoding one.
  it("seeds the store column from the PR's autoColumn rather than hardcoding needsReview", async () => {
    vi.mocked(createWorktreeFrom).mockResolvedValue({
      id: "/repos/app::feat/flux", name: "feat/flux", path: "/repos/app-wt/feat-flux",
      branch: "feat/flux", prStatus: null, agentStatus: "notRunning", column: "inProgress",
      isBranchMode: false, additions: null, deletions: null, repoPath: "/repos/app",
    } as never);
    await handleReviewRequests([makePr({ draft: true, autoColumn: "draftPr" })]);
    const wt = useWorkspaceStore.getState().worktrees.find((w) => w.id === "/repos/app::feat/flux");
    expect(wt?.column).toBe("draftPr");
  });

  it("ignores PRs not flagged reviewRequested", async () => {
    await handleReviewRequests([makePr({ reviewRequested: false })]);
    expect(createWorktreeFrom).not.toHaveBeenCalled();
  });

  it("skips PRs whose worktree already exists in the store (incl. failed placeholders)", async () => {
    useWorkspaceStore.setState({
      worktrees: [{ id: "/repos/app::feat/flux", name: "feat/flux", path: "", branch: "feat/flux",
        prStatus: null, agentStatus: "notRunning", column: "needsReview", isBranchMode: false,
        additions: null, deletions: null, repoPath: "/repos/app", creating: true } as never],
      activeWorktreeId: null,
    });
    await handleReviewRequests([makePr()]);
    expect(createWorktreeFrom).not.toHaveBeenCalled();
  });

  it("skips worktrees that exist on disk but aren't hydrated yet", async () => {
    vi.mocked(listWorktrees).mockResolvedValue([{ id: "/repos/app::feat/flux" } as never]);
    await handleReviewRequests([makePr()]);
    expect(createWorktreeFrom).not.toHaveBeenCalled();
  });

  it("does not double-create when the same PR arrives while creation is in flight", async () => {
    let resolveCreate!: (wt: unknown) => void;
    vi.mocked(createWorktreeFrom).mockReturnValue(new Promise((r) => { resolveCreate = r; }) as never);
    const first = handleReviewRequests([makePr()]);
    const second = handleReviewRequests([makePr()]);
    resolveCreate({ id: "/repos/app::feat/flux", name: "feat/flux", path: "/p", branch: "feat/flux",
      prStatus: null, agentStatus: "notRunning", column: "inProgress", isBranchMode: false,
      additions: null, deletions: null, repoPath: "/repos/app" });
    await Promise.all([first, second]);
    expect(createWorktreeFrom).toHaveBeenCalledTimes(1);
  });

  it("never spawns an agent session", async () => {
    vi.mocked(createWorktreeFrom).mockResolvedValue({
      id: "/repos/app::feat/flux", name: "feat/flux", path: "/p", branch: "feat/flux",
      prStatus: null, agentStatus: "notRunning", column: "inProgress", isBranchMode: false,
      additions: null, deletions: null, repoPath: "/repos/app",
    } as never);
    await handleReviewRequests([makePr()]);
    expect(waitForSpawnedSession).not.toHaveBeenCalled();
    expect(writeToSession).not.toHaveBeenCalled();
  });

  it("marks the placeholder failed when creation throws", async () => {
    vi.mocked(createWorktreeFrom).mockRejectedValue(new Error("branch diverged"));
    await handleReviewRequests([makePr()]);
    const wt = useWorkspaceStore.getState().worktrees.find((w) => w.id === "/repos/app::feat/flux");
    expect(wt?.createError).toContain("branch diverged");
  });

  describe("archived worktrees", () => {
    function seed(overrides: Record<string, unknown>) {
      useWorkspaceStore.setState({
        worktrees: [{
          id: "/repos/app::feat/flux", name: "feat/flux", path: "/p", branch: "feat/flux",
          prStatus: null, agentStatus: "notRunning", column: "needsReview", isBranchMode: false,
          additions: null, deletions: null, repoPath: "/repos/app", ...overrides,
        } as never],
        activeWorktreeId: null,
      });
    }
    const current = () =>
      useWorkspaceStore.getState().worktrees.find((w) => w.id === "/repos/app::feat/flux");

    it("un-archives when a review request arrives for an archived worktree", async () => {
      seed({ archived: true, archivedAt: 1000 });
      await handleReviewRequests([makePr()]);
      expect(current()?.archived).toBe(false);
      expect(current()?.lastReviewRequestedAt).toBeDefined();
      // The worktree is already there — un-archiving must not also re-create it.
      expect(createWorktreeFrom).not.toHaveBeenCalled();
    });

    it("drops a manual column placement so the card can't resurface in a collapsed group", async () => {
      seed({ archived: true, archivedAt: 1000, column: "done" });
      usePrStore.getState().setManualColumn("/repos/app::feat/flux", "done", "needsReview");

      await handleReviewRequests([makePr()]);

      expect(current()?.archived).toBe(false);
      expect(current()?.column).toBe("needsReview");
      expect(usePrStore.getState().columnOverrides["/repos/app::feat/flux"]).toBeUndefined();
    });

    it("leaves a manual placement alone when nothing was archived", async () => {
      seed({ column: "done" });
      usePrStore.getState().setManualColumn("/repos/app::feat/flux", "done", "needsReview");

      await handleReviewRequests([makePr()]);

      expect(usePrStore.getState().columnOverrides["/repos/app::feat/flux"]?.column).toBe("done");
    });

    it("leaves it archived while the same request is still standing", async () => {
      seed({ archived: true, archivedAt: 1000, lastReviewRequestedAt: 500 });
      await handleReviewRequests([makePr()]);
      expect(current()?.archived).toBe(true);
    });

    it("re-arms once the request is withdrawn so a re-request un-archives", async () => {
      seed({ archived: true, archivedAt: 1000, lastReviewRequestedAt: 500 });

      await handleReviewRequests([makePr({ reviewRequested: false })]);
      expect(current()?.lastReviewRequestedAt).toBeUndefined();
      // Withdrawal on its own is not inflow — it must not resurrect the card.
      expect(current()?.archived).toBe(true);

      await handleReviewRequests([makePr()]);
      expect(current()?.archived).toBe(false);
    });

    it("records the request on an unarchived worktree without touching archived", async () => {
      seed({});
      await handleReviewRequests([makePr()]);
      expect(current()?.lastReviewRequestedAt).toBeDefined();
      expect(current()?.archived).toBeFalsy();
    });
  });

});

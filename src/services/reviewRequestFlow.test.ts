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

  it("seeds the store column from the PR's autoColumn (draft PR sits in Draft PR, not Needs Review)", async () => {
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

});

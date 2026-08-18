import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api", () => ({
  setPrAssociation: vi.fn().mockResolvedValue(undefined),
  clearPrAssociation: vi.fn().mockResolvedValue(undefined),
  getPrByNumber: vi.fn(),
  findPrForBranch: vi.fn(),
  setWorktreeColumn: vi.fn().mockResolvedValue(undefined),
  clearWorktreeColumn: vi.fn().mockResolvedValue(undefined),
}));

import { setPrAssociation, clearPrAssociation, getPrByNumber, findPrForBranch } from "../api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { usePrStore } from "../stores/prStore";
import { useToastStore } from "../stores/toastStore";
import { reconcileStalePrs, persistAssociationsFromPatches, _resetForTests } from "./prAssociation";
import type { Worktree, PrStatus } from "../types";

function makeWorktree(over: Partial<Worktree>): Worktree {
  return {
    id: "/repo::feat/x",
    name: "feat-x",
    path: "/wt/feat-x",
    branch: "feat/x",
    prStatus: null,
    agentStatus: "notRunning",
    column: "openPr",
    isBranchMode: false,
    additions: null,
    deletions: null,
    repoPath: "/repo",
    ...over,
  } as Worktree;
}

function makePr(over: Partial<PrStatus>): PrStatus {
  return {
    number: 23277,
    state: "closed",
    title: "CORE-2892",
    url: "https://github.com/x/y/pull/23277",
    draft: false,
    merged: false,
    branch: "feat/x",
    ...over,
  } as PrStatus;
}

// Marks "/repo" as a repo the payload actually heard from, on a branch no
// test worktree uses. Since reconcileStalePrs now requires a worktree's repo
// to be present in the payload before treating it as a genuine stale
// candidate (fix 5 — partial poll failure must not burn the retry budget),
// every call below that used to pass `[]` now passes this instead.
const SYNCED_REPO_PAYLOAD = [{ repoPath: "/repo", branch: "unrelated-branch" } as never];

beforeEach(() => {
  _resetForTests();
  useWorkspaceStore.setState({ worktrees: [] });
  usePrStore.getState().clearStore();
  useToastStore.setState({ toasts: [] });
  vi.clearAllMocks();
});

describe("reconcileStalePrs", () => {
  it("moves a closed-while-away orphan to Done and toasts", async () => {
    const wt = makeWorktree({ prStatus: makePr({ state: "open" }) });
    useWorkspaceStore.setState({ worktrees: [wt] });
    vi.mocked(getPrByNumber).mockResolvedValue(makePr({ state: "closed" }));

    await reconcileStalePrs(SYNCED_REPO_PAYLOAD);

    const after = useWorkspaceStore.getState().worktrees[0];
    expect(after.column).toBe("done");
    expect(after.prStatus?.state).toBe("closed");
    expect(setPrAssociation).toHaveBeenCalledWith("/repo", "feat-x",
      expect.objectContaining({ number: 23277, state: "closed", merged: false }));
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe("While you were away: PR #23277 closed — moved to Done");
  });

  it("uses the branch fallback for legacy orphans without prStatus", async () => {
    const wt = makeWorktree({ prStatus: null });
    useWorkspaceStore.setState({ worktrees: [wt] });
    vi.mocked(findPrForBranch).mockResolvedValue(makePr({ merged: true, state: "closed" }));

    await reconcileStalePrs(SYNCED_REPO_PAYLOAD);

    expect(findPrForBranch).toHaveBeenCalledWith("/repo", "feat/x");
    expect(useWorkspaceStore.getState().worktrees[0].column).toBe("done");
    expect(useToastStore.getState().toasts[0].message).toBe(
      "While you were away: PR #23277 merged — moved to Done");
  });

  it("skips worktrees whose branch is in the payload, and reconciles each worktree once", async () => {
    const wt = makeWorktree({ prStatus: makePr({ state: "open" }) });
    useWorkspaceStore.setState({ worktrees: [wt] });

    await reconcileStalePrs([{ repoPath: "/repo", branch: "feat/x" } as never]);
    expect(getPrByNumber).not.toHaveBeenCalled();

    vi.mocked(getPrByNumber).mockResolvedValue(makePr({ state: "open" }));
    await reconcileStalePrs(SYNCED_REPO_PAYLOAD);
    await reconcileStalePrs(SYNCED_REPO_PAYLOAD);
    expect(getPrByNumber).toHaveBeenCalledTimes(1);
  });

  it("keeps an open PR's column and shows no toast", async () => {
    const wt = makeWorktree({ prStatus: makePr({ state: "open" }) });
    useWorkspaceStore.setState({ worktrees: [wt] });
    vi.mocked(getPrByNumber).mockResolvedValue(makePr({ state: "open" }));

    await reconcileStalePrs(SYNCED_REPO_PAYLOAD);

    expect(useWorkspaceStore.getState().worktrees[0].column).toBe("openPr");
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("retries a failed fetch on the next tick, up to 3 attempts", async () => {
    const wt = makeWorktree({ prStatus: makePr({ state: "open" }) });
    useWorkspaceStore.setState({ worktrees: [wt] });
    vi.mocked(getPrByNumber).mockRejectedValue(new Error("offline"));

    await reconcileStalePrs(SYNCED_REPO_PAYLOAD);
    await reconcileStalePrs(SYNCED_REPO_PAYLOAD);
    await reconcileStalePrs(SYNCED_REPO_PAYLOAD);
    await reconcileStalePrs(SYNCED_REPO_PAYLOAD);

    expect(getPrByNumber).toHaveBeenCalledTimes(3);
    expect(useWorkspaceStore.getState().worktrees[0].column).toBe("openPr");
  });

  it("preserves an active manual column override on a non-terminal reconcile", async () => {
    // User dragged this card to "toDo" while the PR's real auto-column was
    // "openPr" — that's the override's whole premise (column !== autoColumnWhenSet).
    const wt = makeWorktree({ column: "toDo", prStatus: makePr({ state: "open" }) });
    useWorkspaceStore.setState({ worktrees: [wt] });
    usePrStore.setState((s) => ({
      columnOverrides: { ...s.columnOverrides, [wt.id]: { column: "toDo", autoColumnWhenSet: "openPr" } },
    }));
    vi.mocked(getPrByNumber).mockResolvedValue(makePr({ state: "open" }));

    await reconcileStalePrs(SYNCED_REPO_PAYLOAD);

    expect(useWorkspaceStore.getState().worktrees[0].column).toBe("toDo");
    expect(usePrStore.getState().columnOverrides[wt.id]).toEqual({
      column: "toDo",
      autoColumnWhenSet: "openPr",
    });
  });

  it("counts a mixed batch in one toast", async () => {
    const a = makeWorktree({ id: "/repo::a", name: "a", branch: "a", prStatus: makePr({ number: 1, branch: "a", state: "open" }) });
    const b = makeWorktree({ id: "/repo::b", name: "b", branch: "b", prStatus: makePr({ number: 2, branch: "b", state: "open" }) });
    const c = makeWorktree({ id: "/repo::c", name: "c", branch: "c", prStatus: makePr({ number: 3, branch: "c", state: "open" }) });
    useWorkspaceStore.setState({ worktrees: [a, b, c] });
    vi.mocked(getPrByNumber)
      .mockResolvedValueOnce(makePr({ number: 1, branch: "a", state: "closed" }))
      .mockResolvedValueOnce(makePr({ number: 2, branch: "b", state: "closed" }))
      .mockResolvedValueOnce(makePr({ number: 3, branch: "c", state: "closed", merged: true }));

    await reconcileStalePrs(SYNCED_REPO_PAYLOAD);

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe("While you were away: 2 PRs closed, 1 merged — moved to Done");
  });

  it("does not toast when a manual override keeps a terminal PR's card out of Done", async () => {
    // A prior sync auto-Doned this card (autoColumn was "done" at the time),
    // then the user dragged it back to "inProgress" — the override's
    // autoColumnWhenSet records that prior "done" auto-column. On this
    // reconcile the PR is (still) terminal, so the incoming autoColumn is
    // "done" too, which matches autoColumnWhenSet — the override survives
    // and the card stays in "inProgress". Regression coverage for fix 1:
    // the old code toasted "moved to Done" here every launch regardless.
    const wt = makeWorktree({ column: "inProgress", prStatus: makePr({ state: "open" }) });
    useWorkspaceStore.setState({ worktrees: [wt] });
    usePrStore.setState((s) => ({
      columnOverrides: { ...s.columnOverrides, [wt.id]: { column: "inProgress", autoColumnWhenSet: "done" } },
    }));
    vi.mocked(getPrByNumber).mockResolvedValue(makePr({ state: "closed" }));

    await reconcileStalePrs(SYNCED_REPO_PAYLOAD);

    expect(useWorkspaceStore.getState().worktrees[0].column).toBe("inProgress");
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("skips the fetch entirely for a worktree already Done with a terminal hydrated prStatus", async () => {
    const wt = makeWorktree({ column: "done", prStatus: makePr({ state: "closed" }) });
    useWorkspaceStore.setState({ worktrees: [wt] });

    await reconcileStalePrs([]);

    expect(getPrByNumber).not.toHaveBeenCalled();
    expect(findPrForBranch).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  // Regression coverage for fix A: a Force-Quit can lose the in-memory column
  // override that keeps a user-moved card out of Done, but the backend
  // column ("inProgress" here) survives. A terminal hydrated prStatus must
  // skip the fetch regardless of column, or this card would get yanked back
  // to Done as if the user never moved it.
  it("skips the fetch for a terminal-hydrated card the user moved out of Done", async () => {
    const wt = makeWorktree({ column: "inProgress", prStatus: makePr({ state: "closed" }) });
    useWorkspaceStore.setState({ worktrees: [wt] });

    await reconcileStalePrs([]);

    expect(getPrByNumber).not.toHaveBeenCalled();
    expect(findPrForBranch).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().worktrees[0].column).toBe("inProgress");
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  // Regression coverage for fix B: "done" is no longer a PR-tracking column,
  // so a manually-Doned worktree with no persisted PR never fires the branch
  // fallback — a reused branch name could otherwise bind a long-dead PR.
  it("does not call the branch fallback for a Done worktree with no persisted PR", async () => {
    const wt = makeWorktree({ column: "done", prStatus: null });
    useWorkspaceStore.setState({ worktrees: [wt] });

    await reconcileStalePrs(SYNCED_REPO_PAYLOAD);

    expect(findPrForBranch).not.toHaveBeenCalled();
    expect(getPrByNumber).not.toHaveBeenCalled();
    // Marked settled/skipped without a fetch: a second pass doesn't retry it.
    await reconcileStalePrs(SYNCED_REPO_PAYLOAD);
    expect(findPrForBranch).not.toHaveBeenCalled();
  });

  // Regression coverage for fix C: a 404 on the by-number fetch means the PR
  // is gone, not a transient failure — reconcile must not toast, must clear
  // the dangling association, and must not retry it on a later tick.
  it("clears the association and does not retry when getPrByNumber 404s", async () => {
    const wt = makeWorktree({ prStatus: makePr({ state: "open" }) });
    useWorkspaceStore.setState({ worktrees: [wt] });
    vi.mocked(getPrByNumber).mockResolvedValue(null);

    await reconcileStalePrs(SYNCED_REPO_PAYLOAD);

    expect(getPrByNumber).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(clearPrAssociation).toHaveBeenCalledWith("/repo", "feat-x");

    await reconcileStalePrs(SYNCED_REPO_PAYLOAD);
    expect(getPrByNumber).toHaveBeenCalledTimes(1);
  });

  // Regression coverage for fix E: reconcile passes `reviews: undefined` (not
  // `[]`), so prStore's enrichment preserve must keep cached reviews from an
  // earlier full sync instead of wiping them.
  it("preserves cached reviews across a non-terminal reconcile", async () => {
    const wt = makeWorktree({ prStatus: makePr({ state: "open" }) });
    useWorkspaceStore.setState({ worktrees: [wt] });
    usePrStore.getState().applyPrUpdates(
      [{
        ...makePr({ state: "open" }),
        autoColumn: "openPr",
        repoPath: "/repo",
        checkRuns: [],
        reviews: [{ author: "reviewer", state: "APPROVED" } as never],
        comments: [],
        reviewRequested: false,
      }],
      [wt],
    );
    expect(usePrStore.getState().prDetail[wt.id].reviews).toHaveLength(1);

    vi.mocked(getPrByNumber).mockResolvedValue(makePr({ state: "open" }));
    await reconcileStalePrs(SYNCED_REPO_PAYLOAD);

    expect(usePrStore.getState().prDetail[wt.id].reviews).toHaveLength(1);
  });

  it("does not call the branch fallback for a plain worktree with no prStatus", async () => {
    const wt = makeWorktree({ column: "toDo", prStatus: null });
    useWorkspaceStore.setState({ worktrees: [wt] });

    await reconcileStalePrs(SYNCED_REPO_PAYLOAD);

    expect(findPrForBranch).not.toHaveBeenCalled();
    expect(getPrByNumber).not.toHaveBeenCalled();
  });

  it("guards against overlapping reconcile passes double-fetching and double-toasting", async () => {
    const wt = makeWorktree({ prStatus: makePr({ state: "open" }) });
    useWorkspaceStore.setState({ worktrees: [wt] });
    let resolveFetch!: (pr: PrStatus) => void;
    vi.mocked(getPrByNumber).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    // Fire two passes without awaiting the first — mirrors the fast + enriched
    // github:pr-update emits both calling reconcileStalePrs fire-and-forget.
    const first = reconcileStalePrs(SYNCED_REPO_PAYLOAD);
    const second = reconcileStalePrs(SYNCED_REPO_PAYLOAD);

    resolveFetch(makePr({ state: "closed" }));
    await Promise.all([first, second]);

    expect(getPrByNumber).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
});

describe("reconcileStalePrs — post-review fixes", () => {
  it("reconciles a repo whose successful poll returned zero PRs (aged-out case)", async () => {
    const wt = makeWorktree({ prStatus: makePr({ state: "open" }) });
    useWorkspaceStore.setState({ worktrees: [wt] });
    vi.mocked(getPrByNumber).mockResolvedValue(makePr({ merged: true, state: "closed" }));

    // Empty payload, but the repo's poll succeeded — the pre-fix derivation
    // (syncedRepos from payload PRs) would skip this worktree forever.
    await reconcileStalePrs([], ["/repo"]);

    expect(useWorkspaceStore.getState().worktrees[0].column).toBe("done");
  });

  it("still skips repos absent from succeededRepos (failed poll)", async () => {
    const wt = makeWorktree({ prStatus: makePr({ state: "open" }) });
    useWorkspaceStore.setState({ worktrees: [wt] });

    await reconcileStalePrs([], ["/some-other-repo"]);

    expect(getPrByNumber).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().worktrees[0].column).toBe("openPr");
  });

  it("refuses a by-number PR whose head branch is not this worktree's branch", async () => {
    const wt = makeWorktree({ prStatus: makePr({ state: "open" }) });
    useWorkspaceStore.setState({ worktrees: [wt] });
    // The association belonged to a dead predecessor: the real PR lives on
    // another branch and has since merged.
    vi.mocked(getPrByNumber).mockResolvedValue(
      makePr({ merged: true, state: "closed", branch: "someone/elses-branch" }),
    );

    await reconcileStalePrs(SYNCED_REPO_PAYLOAD);

    const after = useWorkspaceStore.getState().worktrees[0];
    expect(after.column).toBe("openPr"); // NOT auto-Doned
    expect(after.prStatus).toBeNull();
    expect(after.prStatusCleared).toBe(true);
    expect(clearPrAssociation).toHaveBeenCalledWith("/repo", "feat-x");
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("marks a 404-cleared prStatus as deliberately cleared", async () => {
    const wt = makeWorktree({ prStatus: makePr({ state: "open" }) });
    useWorkspaceStore.setState({ worktrees: [wt] });
    vi.mocked(getPrByNumber).mockResolvedValue(null);

    await reconcileStalePrs(SYNCED_REPO_PAYLOAD);

    const after = useWorkspaceStore.getState().worktrees[0];
    expect(after.prStatus).toBeNull();
    expect(after.prStatusCleared).toBe(true);
  });

  it("does not pollute lastAutoColumn on a non-terminal reconcile with no override", async () => {
    // Worktree sits in a column that is NOT the PR's true auto-column.
    const wt = makeWorktree({ column: "inProgress", prStatus: makePr({ state: "open" }) });
    useWorkspaceStore.setState({ worktrees: [wt] });
    vi.mocked(getPrByNumber).mockResolvedValue(makePr({ state: "open" }));

    await reconcileStalePrs(SYNCED_REPO_PAYLOAD);

    const after = useWorkspaceStore.getState().worktrees[0];
    expect(after.column).toBe("inProgress"); // placement preserved
    // The poisoning vector: recording wt.column as if it were an auto-column
    // would make the user's next drag snapshot a fake autoColumnWhenSet.
    expect(usePrStore.getState().lastAutoColumn[wt.id]).toBeUndefined();
  });

  it("persists head branch and draftness in the association", async () => {
    const wt = makeWorktree({ prStatus: makePr({ state: "open" }) });
    useWorkspaceStore.setState({ worktrees: [wt] });
    vi.mocked(getPrByNumber).mockResolvedValue(makePr({ state: "open", draft: true }));

    await reconcileStalePrs(SYNCED_REPO_PAYLOAD);

    expect(setPrAssociation).toHaveBeenCalledWith("/repo", "feat-x",
      expect.objectContaining({ branch: "feat/x", draft: true }));
  });
});

describe("persistAssociationsFromPatches", () => {
  it("persists only when the association actually changed", () => {
    const unchanged = makeWorktree({ prStatus: makePr({ state: "open" }) });
    const changed = makeWorktree({ id: "/repo::y", name: "y", branch: "y", prStatus: makePr({ number: 9, branch: "y", state: "open" }) });
    useWorkspaceStore.setState({ worktrees: [unchanged, changed] });

    const patches = new Map([
      [unchanged.id, { prStatus: makePr({ state: "open" }) }],
      [changed.id, { prStatus: makePr({ number: 9, branch: "y", state: "closed" }) }],
    ]);
    persistAssociationsFromPatches(patches as never);

    expect(setPrAssociation).toHaveBeenCalledTimes(1);
    expect(setPrAssociation).toHaveBeenCalledWith("/repo", "y",
      expect.objectContaining({ number: 9, state: "closed" }));
  });
});

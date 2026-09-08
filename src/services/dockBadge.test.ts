import { describe, it, expect } from "vitest";
import { computeBadgeCount, worktreeNeedsYou } from "./dockBadge";
import type { Worktree } from "../types";

function wt(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: "wt-1",
    repoPath: "/r",
    branch: "feat",
    path: "/r/wt",
    agentStatus: "idle",
    channelAlive: true,
    archived: false,
    ...(overrides as object),
  } as Worktree;
}

describe("computeBadgeCount", () => {
  it("returns 0 when notifications are disabled", () => {
    const count = computeBadgeCount({
      worktrees: [wt({ id: "a", agentStatus: "waitingForInput" })],
      seen: new Set(),
      unread: new Set(),
      notificationsEnabled: false,
    });
    expect(count).toBe(0);
  });

  it("counts a waitingForInput worktree", () => {
    const count = computeBadgeCount({
      worktrees: [wt({ id: "a", agentStatus: "waitingForInput" })],
      seen: new Set(),
      unread: new Set(),
      notificationsEnabled: true,
    });
    expect(count).toBe(1);
  });

  it("counts an idle worktree as done when not seen", () => {
    const count = computeBadgeCount({
      worktrees: [wt({ id: "a", agentStatus: "idle" })],
      seen: new Set(),
      unread: new Set(),
      notificationsEnabled: true,
    });
    expect(count).toBe(1);
  });

  it("does not count an idle worktree once seen", () => {
    const count = computeBadgeCount({
      worktrees: [wt({ id: "a", agentStatus: "idle" })],
      seen: new Set(["a"]),
      unread: new Set(),
      notificationsEnabled: true,
    });
    expect(count).toBe(0);
  });

  it("re-counts a seen worktree once marked unread", () => {
    const count = computeBadgeCount({
      worktrees: [wt({ id: "a", agentStatus: "idle" })],
      seen: new Set(["a"]),
      unread: new Set(["a"]),
      notificationsEnabled: true,
    });
    expect(count).toBe(1);
  });

  it("does not count a busy worktree", () => {
    const count = computeBadgeCount({
      worktrees: [wt({ id: "a", agentStatus: "busy" })],
      seen: new Set(),
      unread: new Set(),
      notificationsEnabled: true,
    });
    expect(count).toBe(0);
  });

  it("does not count notRunning", () => {
    const count = computeBadgeCount({
      worktrees: [wt({ id: "a", agentStatus: "notRunning" })],
      seen: new Set(),
      unread: new Set(),
      notificationsEnabled: true,
    });
    expect(count).toBe(0);
  });

  it("skips archived worktrees", () => {
    const count = computeBadgeCount({
      worktrees: [wt({ id: "a", agentStatus: "waitingForInput", archived: true })],
      seen: new Set(),
      unread: new Set(),
      notificationsEnabled: true,
    });
    expect(count).toBe(0);
  });

  it("counts justCreated worktrees as ready", () => {
    const count = computeBadgeCount({
      worktrees: [wt({ id: "a", agentStatus: "notRunning", justCreated: true })],
      seen: new Set(),
      unread: new Set(),
      notificationsEnabled: true,
    });
    expect(count).toBe(1);
  });

  it("agrees with worktreeNeedsYou per worktree", () => {
    const worktrees = [
      wt({ id: "a", agentStatus: "waitingForInput" }),
      wt({ id: "b", agentStatus: "idle" }),
      wt({ id: "c", agentStatus: "busy" }),
      wt({ id: "d", agentStatus: "idle", archived: true }),
    ];
    const seen = new Set(["b"]);
    const unread = new Set(["b"]);
    const count = computeBadgeCount({
      worktrees,
      seen,
      unread,
      notificationsEnabled: true,
    });
    const perWorktree = worktrees.filter((w) =>
      worktreeNeedsYou(w, seen, unread),
    );
    expect(perWorktree.map((w) => w.id)).toEqual(["a", "b"]);
    expect(count).toBe(perWorktree.length);
  });

  // Stack trouble stays off the badge: routine drift (a root behind main,
  // needsPush after a local-only restack) would pin a permanent count. The
  // chip's amber "!" and the stack map are its surfaces.
  it("does not count stack trouble", () => {
    const conflicted = wt({ id: "a", agentStatus: "busy", stackRebaseStatus: { kind: "conflict" } });
    const behind = wt({ id: "b", agentStatus: "busy", stackRebaseStatus: { kind: "behind", count: 3 } });
    const pending = wt({ id: "c", agentStatus: "busy", stackPending: { mergedParent: "main", blockedBy: "dirty" } });
    expect(worktreeNeedsYou(conflicted, new Set(["a"]), new Set())).toBe(false);
    expect(worktreeNeedsYou(behind, new Set(["b"]), new Set())).toBe(false);
    expect(worktreeNeedsYou(pending, new Set(["c"]), new Set())).toBe(false);
  });

  it("sums across multiple attention worktrees", () => {
    const count = computeBadgeCount({
      worktrees: [
        wt({ id: "a", agentStatus: "waitingForInput" }),
        wt({ id: "b", agentStatus: "idle" }),
        wt({ id: "c", agentStatus: "busy" }),
      ],
      seen: new Set(),
      unread: new Set(),
      notificationsEnabled: true,
    });
    expect(count).toBe(2);
  });
});

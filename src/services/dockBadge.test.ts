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

  // Stack trouble needs the user like a waiting agent — without this a
  // troubled member in a collapsed status group surfaces nowhere, since the
  // chip's amber "!" is per-row.
  it("counts stack trouble even on a busy, seen worktree", () => {
    const worktrees = [
      wt({ id: "a", agentStatus: "busy", stackRebaseStatus: { kind: "conflict" } }),
    ];
    expect(worktreeNeedsYou(worktrees[0], new Set(["a"]), new Set())).toBe(true);
  });

  it("does not count in-flight rebasing or merged members' leftover statuses", () => {
    const rebasing = wt({ id: "a", agentStatus: "busy", stackRebaseStatus: { kind: "rebasing" } });
    const merged = wt({
      id: "b",
      agentStatus: "busy",
      prStatus: { merged: true } as Worktree["prStatus"],
      stackRebaseStatus: { kind: "needsPush" },
    });
    expect(worktreeNeedsYou(rebasing, new Set(["a"]), new Set())).toBe(false);
    expect(worktreeNeedsYou(merged, new Set(["b"]), new Set())).toBe(false);
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

import { describe, it, expect } from "vitest";
import { computeBadgeCount } from "./dockBadge";
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

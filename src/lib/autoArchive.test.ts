import { describe, expect, it } from "vitest";
import { shouldAutoArchive } from "./autoArchive";
import type { Worktree } from "../types";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;
const ARCHIVE_AFTER_MS = 7 * DAY;

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: "/repo::feature-1",
    name: "feature-1",
    path: "/path/feature-1",
    branch: "feature-1",
    repoPath: "/repo",
    prStatus: null,
    agentStatus: "notRunning",
    column: "done",
    isBranchMode: false,
    additions: null,
    deletions: null,
    lastActivityAt: NOW - 30 * DAY,
    ...overrides,
  };
}

const opts = { now: NOW, archiveAfterMs: ARCHIVE_AFTER_MS, hasRunningServer: false };

describe("shouldAutoArchive", () => {
  it("archives a Done worktree idle past the threshold", () => {
    expect(shouldAutoArchive(makeWorktree(), opts)).toBe(true);
  });

  it("never archives a worktree with a running dev server", () => {
    // The reason this exists: restarting a server on a long-merged worktree
    // refreshes none of the timestamps below, so without this the next sync
    // tick would archive it and kill the server mid-session.
    expect(shouldAutoArchive(makeWorktree(), { ...opts, hasRunningServer: true })).toBe(false);
  });

  it("still exempts a running server when the PR merged long ago", () => {
    // mergedAt takes priority over lastActivityAt and never moves, so this is
    // the case a timestamp-based fix could not have covered.
    const wt = makeWorktree({
      prStatus: { mergedAt: new Date(NOW - 90 * DAY).toISOString() } as Worktree["prStatus"],
    });

    expect(shouldAutoArchive(wt, opts)).toBe(true);
    expect(shouldAutoArchive(wt, { ...opts, hasRunningServer: true })).toBe(false);
  });

  it("leaves worktrees outside Done alone", () => {
    expect(shouldAutoArchive(makeWorktree({ column: "inProgress" }), opts)).toBe(false);
  });

  it("skips already-archived worktrees", () => {
    expect(shouldAutoArchive(makeWorktree({ archived: true }), opts)).toBe(false);
  });

  it("respects a recent manual unarchive", () => {
    const wt = makeWorktree({ unarchivedAt: NOW - 1 * DAY });
    expect(shouldAutoArchive(wt, opts)).toBe(false);
  });

  it("re-archives once the unarchive grace has elapsed", () => {
    const wt = makeWorktree({ unarchivedAt: NOW - 8 * DAY });
    expect(shouldAutoArchive(wt, opts)).toBe(true);
  });

  it("keeps a worktree that has not been idle long enough", () => {
    expect(shouldAutoArchive(makeWorktree({ lastActivityAt: NOW - 1 * DAY }), opts)).toBe(false);
  });

  it("never archives a worktree with no activity timestamp at all", () => {
    expect(shouldAutoArchive(makeWorktree({ lastActivityAt: undefined }), opts)).toBe(false);
  });

  it("prefers the PR merge time over lastActivityAt", () => {
    // Merged recently but no agent activity for a month — merge time wins, so
    // it stays.
    const wt = makeWorktree({
      lastActivityAt: NOW - 30 * DAY,
      prStatus: { mergedAt: new Date(NOW - 1 * DAY).toISOString() } as Worktree["prStatus"],
    });

    expect(shouldAutoArchive(wt, opts)).toBe(false);
  });
});

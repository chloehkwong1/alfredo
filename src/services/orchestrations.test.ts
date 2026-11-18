import { describe, it, expect } from "vitest";
import {
  orchestrationsFromRules,
  yourTurnRows,
  nextNeedsYouSince,
  formatWaitingAge,
  type Orchestration,
} from "./orchestrations";
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

const pr = (number: number) => ({ number }) as Worktree["prStatus"];
const none = new Set<string>();

describe("orchestrationsFromRules", () => {
  it("collects worktrees of the repo whose branch starts with the prefix, archived included", () => {
    const result = orchestrationsFromRules(
      "/r",
      [{ name: "Billing", branchPrefix: "bill/" }],
      [
        wt({ id: "a", branch: "bill/one" }),
        wt({ id: "b", branch: "bill/two", archived: true }),
        wt({ id: "c", branch: "other" }),
      ],
    );
    expect(result).toEqual([
      {
        repoPath: "/r",
        name: "Billing",
        items: [
          { worktreeId: "a", title: "one" },
          { worktreeId: "b", title: "two" },
        ],
      },
    ]);
  });

  it("uses the full branch as title when the prefix is the whole branch", () => {
    const [o] = orchestrationsFromRules(
      "/r",
      [{ name: "B", branchPrefix: "bill" }],
      [wt({ id: "a", branch: "bill" })],
    );
    expect(o.items[0].title).toBe("bill");
  });

  it("ignores rules with an empty name or prefix", () => {
    expect(
      orchestrationsFromRules(
        "/r",
        [
          { name: "", branchPrefix: "a/" },
          { name: "X", branchPrefix: "" },
        ],
        [wt({ branch: "a/b" })],
      ),
    ).toEqual([]);
  });

  it("orders by PR number ascending, then no-PR worktrees by branch", () => {
    const [o] = orchestrationsFromRules(
      "/r",
      [{ name: "B", branchPrefix: "b/" }],
      [
        wt({ id: "z", branch: "b/z" }),
        wt({ id: "p9", branch: "b/p9", prStatus: pr(9) }),
        wt({ id: "a", branch: "b/a" }),
        wt({ id: "p2", branch: "b/p2", prStatus: pr(2) }),
      ],
    );
    expect(o.items.map((i) => i.worktreeId)).toEqual(["p2", "p9", "a", "z"]);
  });

  it("gives an empty orchestration when nothing matches", () => {
    const result = orchestrationsFromRules(
      "/r",
      [{ name: "B", branchPrefix: "nope/" }],
      [wt({ branch: "feat" })],
    );
    expect(result).toEqual([{ repoPath: "/r", name: "B", items: [] }]);
  });

  it("does not include a worktree of another repo", () => {
    const [o] = orchestrationsFromRules(
      "/r",
      [{ name: "B", branchPrefix: "b/" }],
      [wt({ id: "x", repoPath: "/other", branch: "b/x" })],
    );
    expect(o.items).toEqual([]);
  });
});

function orch(name: string, ids: string[]): Orchestration {
  return {
    repoPath: "/r",
    name,
    items: ids.map((id) => ({ worktreeId: id, title: `t-${id}` })),
  };
}

describe("yourTurnRows", () => {
  it("makes a row only for worktrees that need you", () => {
    const rows = yourTurnRows(
      [orch("O", ["a", "b"])],
      [
        wt({ id: "a", agentStatus: "waitingForInput" }),
        wt({ id: "b", agentStatus: "busy" }),
      ],
      none,
      none,
      { a: { kind: "answer", at: 5 } },
    );
    expect(rows.map((r) => r.worktreeId)).toEqual(["a"]);
    expect(rows[0]).toMatchObject({
      kind: "answer",
      orchestrationName: "O",
      itemTitle: "t-a",
      since: 5,
    });
  });

  it("does not make a row for an archived or seen worktree", () => {
    const rows = yourTurnRows(
      [orch("O", ["a", "b"])],
      [
        wt({ id: "a", agentStatus: "waitingForInput", archived: true }),
        wt({ id: "b", agentStatus: "idle" }),
      ],
      new Set(["b"]),
      none,
      {},
    );
    expect(rows).toEqual([]);
  });

  it("answer text is the question or a fallback; fullText is untruncated", () => {
    const long = "x".repeat(300);
    const rows = yourTurnRows(
      [orch("O", ["a", "b"])],
      [
        wt({ id: "a", agentStatus: "waitingForInput", question: { text: long } }),
        wt({ id: "b", agentStatus: "waitingForInput" }),
      ],
      none,
      none,
      { a: { kind: "answer", at: 1 }, b: { kind: "answer", at: 2 } },
    );
    expect(rows[0].fullText).toBe(long);
    expect(rows[0].text).toBe(long);
    expect(rows[1].text).toBe("Waiting for input");
    expect(rows[1].fullText).toBe("Waiting for input");
  });

  it("check text is Finished for a done worktree with kind check", () => {
    const [row] = yourTurnRows(
      [orch("O", ["a"])],
      [wt({ id: "a", agentStatus: "idle" })],
      none,
      none,
      {},
    );
    expect(row.kind).toBe("check");
    expect(row.text).toBe("Finished");
  });

  it("check text is Ready to start for a just-created worktree", () => {
    const [row] = yourTurnRows(
      [orch("O", ["a"])],
      [wt({ id: "a", agentStatus: "notRunning", justCreated: true })],
      none,
      none,
      {},
    );
    expect(row.kind).toBe("check");
    expect(row.text).toBe("Ready to start");
  });

  it("gives one row for a worktree in two orchestrations, under the first", () => {
    const rows = yourTurnRows(
      [orch("First", ["a"]), orch("Second", ["a"])],
      [wt({ id: "a", agentStatus: "waitingForInput" })],
      none,
      none,
      {},
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].orchestrationName).toBe("First");
  });

  it("sorts oldest first, with no-since rows last", () => {
    const rows = yourTurnRows(
      [orch("O", ["a", "b", "c"])],
      [
        wt({ id: "a", agentStatus: "waitingForInput" }),
        wt({ id: "b", agentStatus: "waitingForInput" }),
        wt({ id: "c", agentStatus: "waitingForInput" }),
      ],
      none,
      none,
      { a: { kind: "answer", at: 30 }, c: { kind: "answer", at: 10 } },
    );
    expect(rows.map((r) => r.worktreeId)).toEqual(["c", "a", "b"]);
  });
});

describe("nextNeedsYouSince", () => {
  it("adds an entry when a worktree starts to need you", () => {
    const next = nextNeedsYouSince(
      {},
      [wt({ id: "a", agentStatus: "waitingForInput" })],
      none,
      none,
      100,
    );
    expect(next).toEqual({ a: { kind: "answer", at: 100 } });
  });

  it("removes the entry when it stops needing you", () => {
    const next = nextNeedsYouSince(
      { a: { kind: "answer", at: 100 } },
      [wt({ id: "a", agentStatus: "busy" })],
      none,
      none,
      200,
    );
    expect(next).toEqual({});
  });

  it("resets the time when kind goes from check to answer", () => {
    const next = nextNeedsYouSince(
      { a: { kind: "check", at: 100 } },
      [wt({ id: "a", agentStatus: "waitingForInput" })],
      none,
      none,
      200,
    );
    expect(next).toEqual({ a: { kind: "answer", at: 200 } });
  });

  it("keeps the age on answer to check and resets it on the next check to answer", () => {
    const waiting = wt({ id: "a", agentStatus: "waitingForInput" });
    const done = wt({ id: "a", agentStatus: "idle" });
    const step2 = nextNeedsYouSince({ a: { kind: "answer", at: 100 } }, [done], none, none, 200);
    expect(step2).toEqual({ a: { kind: "check", at: 100 } });
    const step3 = nextNeedsYouSince(step2, [waiting], none, none, 300);
    expect(step3).toEqual({ a: { kind: "answer", at: 300 } });
  });

  it("returns prev itself when nothing changed", () => {
    const prev = { a: { kind: "answer" as const, at: 100 } };
    const next = nextNeedsYouSince(
      prev,
      [wt({ id: "a", agentStatus: "waitingForInput" })],
      none,
      none,
      999,
    );
    expect(next).toBe(prev);
  });
});

describe("formatWaitingAge", () => {
  const T = 1_000_000;
  it.each([
    [0, "now"],
    [59_000, "now"],
    [12 * 60_000, "12 min"],
    [119 * 60_000, "119 min"],
    [2 * 3_600_000, "2 h"],
    [3 * 86_400_000, "3 d"],
  ])("%i ms waited -> %s", (ms, expected) => {
    expect(formatWaitingAge(T, T + ms)).toBe(expected);
  });
});

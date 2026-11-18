import { describe, it, expect } from "vitest";
import {
  orchestrationsFromRules,
  orchestrationsFromNotes,
  mergeOrchestrations,
  yourTurnRows,
  nextNeedsYouSince,
  formatWaitingAge,
  countRuleMatches,
  cleanOrchestrationRules,
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

describe("orchestrationsFromNotes", () => {
  it("makes one orchestration per distinct note orchestration, archived worktrees included", () => {
    const result = orchestrationsFromNotes("/r", [
      wt({ id: "a", branch: "a", note: { orchestration: "Documents" } }),
      wt({ id: "b", branch: "b", note: { orchestration: "Billing" } }),
      wt({ id: "c", branch: "c", archived: true, note: { orchestration: "Documents" } }),
    ]);
    expect(result).toEqual([
      {
        repoPath: "/r",
        name: "Documents",
        items: [
          { worktreeId: "a", title: "a" },
          { worktreeId: "c", title: "c" },
        ],
      },
      { repoPath: "/r", name: "Billing", items: [{ worktreeId: "b", title: "b" }] },
    ]);
  });

  it("orders orchestrations by where their name first appears among the sorted worktrees", () => {
    const result = orchestrationsFromNotes("/r", [
      wt({ id: "z", branch: "z", note: { orchestration: "No PR yet" } }),
      wt({ id: "p9", branch: "p9", prStatus: pr(9), note: { orchestration: "Later PR" } }),
      wt({ id: "p2", branch: "p2", prStatus: pr(2), note: { orchestration: "Earlier PR" } }),
    ]);
    expect(result.map((o) => o.name)).toEqual(["Earlier PR", "Later PR", "No PR yet"]);
  });

  it("titles an item with the note's label, or the branch when the note has no label", () => {
    const [o] = orchestrationsFromNotes("/r", [
      wt({ id: "a", branch: "docs/a", note: { label: "PR 1 · Scopes", orchestration: "Documents" } }),
      wt({ id: "b", branch: "docs/b", note: { orchestration: "Documents" } }),
    ]);
    expect(o.items).toEqual([
      { worktreeId: "a", title: "PR 1 · Scopes" },
      { worktreeId: "b", title: "docs/b" },
    ]);
  });

  it("orders items by PR number ascending, then no-PR worktrees by branch", () => {
    const note = { orchestration: "Documents" };
    const [o] = orchestrationsFromNotes("/r", [
      wt({ id: "z", branch: "z", note }),
      wt({ id: "p9", branch: "p9", prStatus: pr(9), note }),
      wt({ id: "a", branch: "a", note }),
      wt({ id: "p2", branch: "p2", prStatus: pr(2), note }),
    ]);
    expect(o.items.map((i) => i.worktreeId)).toEqual(["p2", "p9", "a", "z"]);
  });

  it("gives nothing for a worktree of another repo", () => {
    expect(
      orchestrationsFromNotes("/r", [
        wt({ id: "x", repoPath: "/other", note: { orchestration: "Documents" } }),
      ]),
    ).toEqual([]);
  });

  it("gives nothing for a note with no orchestration, or a worktree with no note", () => {
    expect(
      orchestrationsFromNotes("/r", [
        wt({ id: "a", note: { label: "Only a name" } }),
        wt({ id: "b" }),
      ]),
    ).toEqual([]);
  });
});

describe("mergeOrchestrations", () => {
  it("puts note orchestrations first, then rule orchestrations unchanged", () => {
    const fromNotes = [orch("Noted", ["a"])];
    const fromRules = [orch("Ruled", ["b"]), orch("Empty rule", [])];
    expect(mergeOrchestrations(fromNotes, fromRules)).toEqual([
      orch("Noted", ["a"]),
      orch("Ruled", ["b"]),
      orch("Empty rule", []),
    ]);
  });

  it("gives the rule orchestrations as they are when there are no notes", () => {
    const fromRules = [orch("One", ["a"]), orch("Two", ["b"])];
    expect(mergeOrchestrations([], fromRules)).toEqual(fromRules);
  });

  it("folds a rule orchestration into the note orchestration of the same repo and name", () => {
    const fromNotes: Orchestration[] = [
      { repoPath: "/r", name: "Documents", items: [{ worktreeId: "a", title: "PR 1" }] },
    ];
    const fromRules: Orchestration[] = [
      {
        repoPath: "/r",
        name: "Documents",
        items: [
          { worktreeId: "a", title: "a-from-rule" },
          { worktreeId: "b", title: "b-from-rule" },
        ],
      },
    ];
    expect(mergeOrchestrations(fromNotes, fromRules)).toEqual([
      {
        repoPath: "/r",
        name: "Documents",
        items: [
          { worktreeId: "a", title: "PR 1" },
          { worktreeId: "b", title: "b-from-rule" },
        ],
      },
    ]);
  });

  it("does not fold a rule orchestration of another repo with the same name", () => {
    const fromNotes = [orch("Documents", ["a"])];
    const fromRules = [{ ...orch("Documents", ["b"]), repoPath: "/other" }];
    expect(mergeOrchestrations(fromNotes, fromRules)).toEqual([...fromNotes, ...fromRules]);
  });

  it("names the row from the note when a rule also matches the worktree", () => {
    const worktrees = [
      wt({
        id: "a",
        branch: "docs/scopes",
        agentStatus: "waitingForInput",
        note: { label: "PR 1 · Scopes", orchestration: "Documents refactor" },
      }),
    ];
    const rows = yourTurnRows(
      mergeOrchestrations(
        orchestrationsFromNotes("/r", worktrees),
        orchestrationsFromRules("/r", [{ name: "Docs", branchPrefix: "docs/" }], worktrees),
      ),
      worktrees,
      none,
      none,
      {},
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orchestrationName: "Documents refactor",
      itemTitle: "PR 1 · Scopes",
    });
  });

  it("adds a same-named rule's extra worktree and makes no second orchestration", () => {
    const worktrees = [
      wt({ id: "a", branch: "docs/a", note: { label: "PR 1", orchestration: "Documents" } }),
      wt({ id: "b", branch: "docs/b" }),
    ];
    expect(
      mergeOrchestrations(
        orchestrationsFromNotes("/r", worktrees),
        orchestrationsFromRules("/r", [{ name: "Documents", branchPrefix: "docs/" }], worktrees),
      ),
    ).toEqual([
      {
        repoPath: "/r",
        name: "Documents",
        items: [
          { worktreeId: "a", title: "PR 1" },
          { worktreeId: "b", title: "b" },
        ],
      },
    ]);
  });

  it.each([
    ["the folded orchestration sorts first", { a: pr(1), b: null }],
    ["the worktree's own orchestration sorts first", { a: null, b: pr(1) }],
  ])(
    "keeps a noted worktree in its own orchestration when a same-named rule also matches it (%s)",
    (_order, prStatus) => {
      const worktrees = [
        wt({
          id: "a",
          branch: "docs/a",
          prStatus: prStatus.a,
          agentStatus: "waitingForInput",
          note: { label: "PR 1", orchestration: "Documents" },
        }),
        wt({
          id: "b",
          branch: "docs/b",
          prStatus: prStatus.b,
          agentStatus: "waitingForInput",
          note: { label: "PR 7 · Invoices", orchestration: "Billing" },
        }),
      ];
      const merged = mergeOrchestrations(
        orchestrationsFromNotes("/r", worktrees),
        orchestrationsFromRules("/r", [{ name: "Documents", branchPrefix: "docs/" }], worktrees),
      );
      const rows = yourTurnRows(merged, worktrees, none, none, {});
      expect(rows.find((r) => r.worktreeId === "b")).toMatchObject({
        orchestrationName: "Billing",
        itemTitle: "PR 7 · Invoices",
      });
      expect(merged.find((o) => o.name === "Documents")?.items).toEqual([
        { worktreeId: "a", title: "PR 1" },
      ]);
    },
  );
});

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

describe("countRuleMatches", () => {
  const worktrees = [
    wt({ id: "a", branch: "bill/one" }),
    wt({ id: "b", branch: "bill/two", archived: true }),
    wt({ id: "c", branch: "other" }),
    wt({ id: "d", branch: "bill/three", repoPath: "/elsewhere" }),
  ];
  it("counts this repo's worktrees under the trimmed prefix, archived included", () => {
    expect(countRuleMatches("/r", " bill/ ", worktrees)).toBe(2);
  });
  it("is 0 for an empty or blank prefix", () => {
    expect(countRuleMatches("/r", "", worktrees)).toBe(0);
    expect(countRuleMatches("/r", "   ", worktrees)).toBe(0);
  });
});

describe("cleanOrchestrationRules", () => {
  it("trims name and prefix and drops rows missing either", () => {
    expect(
      cleanOrchestrationRules([
        { name: " Billing ", branchPrefix: " bill/ " },
        { name: "", branchPrefix: "x/" },
        { name: "No prefix", branchPrefix: "  " },
      ]),
    ).toEqual([{ name: "Billing", branchPrefix: "bill/" }]);
  });
});

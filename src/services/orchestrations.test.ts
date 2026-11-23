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
  worktreeForPath,
  applyActivityToLinks,
  endAgentWork,
  withQuietLink,
  workedFromByWorktree,
  orchestrationsFromLinks,
  orchestrationsForRepo,
  claimWorktrees,
  shownOrchestrations,
  orchestrationMarks,
  orchestrationMarksFor,
  orchestrationOf,
  markLine,
  noPlanHint,
  planLayout,
  planSquareLook,
  type Orchestration,
  type SessionLinks,
} from "./orchestrations";
import type { PlanItem, Worktree } from "../types";

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

describe("orchestrationsFromNotes with an orchestrator", () => {
  const p1: PlanItem = { key: "p1", title: "Rule", state: "todo" };
  it("puts the orchestrator first, titled `orchestrator`, with its plan", () => {
    const a = wt({ id: "a", branch: "z", note: { label: "Agency staff", orchestration: "Agency staff", isOrchestrator: true, plan: [p1] } });
    const b = wt({ id: "b", branch: "b", note: { label: "PR 1 · Rule", orchestration: "Agency staff" } });
    const result = orchestrationsFromNotes("/r", [a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].orchestratorId).toBe("a");
    expect(result[0].plan).toEqual([p1]);
    expect(result[0].items).toEqual([
      { worktreeId: "a", title: "orchestrator" },
      { worktreeId: "b", title: "PR 1 · Rule" },
    ]);
    expect(result[0].fromLinks).toBeUndefined();
  });
  it("takes the first orchestrator note; a second one is a plain item", () => {
    const a = wt({ id: "a", branch: "a", note: { orchestration: "N", isOrchestrator: true } });
    const c = wt({ id: "c", branch: "c", note: { label: "Second", orchestration: "N", isOrchestrator: true } });
    const [o] = orchestrationsFromNotes("/r", [c, a]);
    expect(o.orchestratorId).toBe("a");
    expect(o.items).toEqual([
      { worktreeId: "a", title: "orchestrator" },
      { worktreeId: "c", title: "Second" },
    ]);
  });
  it("has no orchestratorId and no plan when no note says orchestrator", () => {
    const [o] = orchestrationsFromNotes("/r", [wt({ id: "a", note: { orchestration: "N", plan: [p1] } })]);
    expect(o.orchestratorId).toBeUndefined();
    expect(o.plan).toBeUndefined();
    expect("orchestratorId" in o).toBe(false);
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
  it("lists the head of a link orchestration under its own name, after notes and rules", () => {
    const head = wt({ id: "r::orch", path: "/wt/orch", branch: "jack/billing-orchestrator", repoPath: "r", agentStatus: "waitingForInput" });
    const linked = wt({ id: "r::api", path: "/wt/api", branch: "jack/billing-api", repoPath: "r", agentStatus: "notRunning", workedFrom: { worktreeId: "r::orch", running: true } });
    const fromLinks = orchestrationsFromLinks("r", [head, linked], { "/wt/orch": "Billing" });

    const rows = yourTurnRows(fromLinks, [head, linked], new Set(["r::orch"]), new Set(), {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ worktreeId: "r::orch", kind: "answer", orchestrationName: "Billing", itemTitle: "orchestrator" });

    const rule = { repoPath: "r", name: "Rule first", items: [{ worktreeId: "r::orch", title: "x" }] };
    const both = yourTurnRows([rule, ...fromLinks], [head, linked], new Set(["r::orch"]), new Set(), {});
    expect(both).toHaveLength(1);
    expect(both[0].orchestrationName).toBe("Rule first");
  });
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

const trees = [
  { id: "r::a", path: "/wt/a" },
  { id: "r::b", path: "/wt/b" },
  { id: "r::agent", path: "/wt/a/.claude/worktrees/agent-1" },
];

describe("worktreeForPath", () => {
  it("picks the longest containing worktree", () => {
    expect(worktreeForPath("/wt/a/.claude/worktrees/agent-1/src/x.ts", trees, "r::a")).toBe("r::agent");
    expect(worktreeForPath("/wt/a/src/x.ts", trees, "r::a")).toBe("r::a");
  });
  it("matches on a path boundary only", () => {
    expect(worktreeForPath("/wt/abc/x.ts", trees, "r::a")).toBeUndefined();
  });
  it("prefers the session's own worktree on a tie", () => {
    const same = [{ id: "r::main", path: "/repo" }, { id: "r::feature", path: "/repo" }];
    expect(worktreeForPath("/repo/x.ts", same, "r::feature")).toBe("r::feature");
  });
});

describe("applyActivityToLinks", () => {
  const none: SessionLinks = {};
  it("returns the same object when there is nothing to record", () => {
    expect(applyActivityToLinks(none, "r::a", undefined, "toolStart", trees)).toBe(none);
    expect(applyActivityToLinks(none, "r::a", { cwd: "/wt/a" }, "toolStart", trees)).toBe(none);
    expect(applyActivityToLinks(none, "r::a", { cwd: "/elsewhere" }, "toolStart", trees)).toBe(none);
  });
  it("links a sub-agent to the worktree in its cwd, once", () => {
    const one = applyActivityToLinks(none, "r::a", { cwd: "/wt/b", agentId: "a1" }, "subagentStart", trees);
    expect(one).toEqual({ "r::b": { agentIds: ["a1"], mainIn: false } });
    expect(applyActivityToLinks(one, "r::a", { cwd: "/wt/b", agentId: "a1" }, "toolStart", trees)).toBe(one);
  });
  it("links a sub-agent with no isolation at its first write", () => {
    expect(applyActivityToLinks(none, "r::a", { cwd: "/wt/a", writePath: "/wt/b/x.ts", agentId: "a2" }, "toolStart", trees))
      .toEqual({ "r::b": { agentIds: ["a2"], mainIn: false } });
  });
  it("ends a sub-agent's work at its subagentEnd and keeps the link", () => {
    const one = { "r::b": { agentIds: ["a1"], mainIn: false } };
    expect(applyActivityToLinks(one, "r::a", { cwd: "/wt/b", agentId: "a1" }, "subagentEnd", trees))
      .toEqual({ "r::b": { agentIds: [], mainIn: false } });
  });
  it("ignores a subagentEnd for an unknown agent", () => {
    const one = { "r::b": { agentIds: ["a1"], mainIn: false } };
    expect(applyActivityToLinks(one, "r::a", { cwd: "/wt/a", agentId: "stray" }, "subagentEnd", trees)).toBe(one);
  });
  it("follows the main session's cwd in and out", () => {
    const inB = applyActivityToLinks(none, "r::a", { cwd: "/wt/b" }, "toolStart", trees);
    expect(inB).toEqual({ "r::b": { agentIds: [], mainIn: true } });
    expect(applyActivityToLinks(inB, "r::a", { cwd: "/wt/a" }, "toolStart", trees))
      .toEqual({ "r::b": { agentIds: [], mainIn: false } });
  });
  it("returns the same object when a main session parked in another worktree sends the same cwd again", () => {
    const inB = applyActivityToLinks(none, "r::a", { cwd: "/wt/b" }, "toolStart", trees);
    expect(applyActivityToLinks(inB, "r::a", { cwd: "/wt/b" }, "toolStart", trees)).toBe(inB);
    expect(applyActivityToLinks(inB, "r::a", { cwd: "/wt/b/src" }, "toolEnd", trees)).toBe(inB);
  });
  it("ignores a sub-agent event that names no agent", () => {
    // A Claude Code version that leaves `agent_id` out of SubagentStart / SubagentStop:
    // the cwd is the sub-agent's, so it must not move the main session.
    expect(applyActivityToLinks(none, "r::a", { cwd: "/wt/b" }, "subagentStart", trees)).toBe(none);
    expect(applyActivityToLinks(none, "r::a", { cwd: "/wt/a", writePath: "/wt/b/x.ts" }, "subagentStart", trees)).toBe(none);
    const inB = { "r::b": { agentIds: [], mainIn: true } };
    expect(applyActivityToLinks(inB, "r::a", { cwd: "/wt/a" }, "subagentEnd", trees)).toBe(inB);
  });
  it("records a main-session write as a link that is not running", () => {
    const linked = applyActivityToLinks(none, "r::a", { cwd: "/wt/a", writePath: "/wt/b/x.ts" }, "toolStart", trees);
    expect(linked).toEqual({ "r::b": { agentIds: [], mainIn: false } });
    expect(applyActivityToLinks(linked, "r::a", { cwd: "/wt/a", writePath: "/wt/b/y.ts" }, "toolStart", trees)).toBe(linked);
  });
});

describe("endAgentWork", () => {
  it("empties agentIds and keeps mainIn", () => {
    expect(endAgentWork({ "r::b": { agentIds: ["a1"], mainIn: true } })).toEqual({ "r::b": { agentIds: [], mainIn: true } });
  });
  it("returns the same object when no agent was working", () => {
    const quiet = { "r::b": { agentIds: [], mainIn: false } };
    expect(endAgentWork(quiet)).toBe(quiet);
    const empty: SessionLinks = {};
    expect(endAgentWork(empty)).toBe(empty);
  });
});

describe("withQuietLink", () => {
  it("adds a link that is not running for a worktree with none", () => {
    const prev = { "r::b": { agentIds: ["a1"], mainIn: false } };
    expect(withQuietLink(prev, "r::c")).toEqual({
      "r::b": { agentIds: ["a1"], mainIn: false },
      "r::c": { agentIds: [], mainIn: false },
    });
  });
  it("returns the same object when the worktree already has a link", () => {
    const running = { "r::b": { agentIds: ["a1"], mainIn: true } };
    expect(withQuietLink(running, "r::b")).toBe(running);
    const quiet = { "r::b": { agentIds: [], mainIn: false } };
    expect(withQuietLink(quiet, "r::b")).toBe(quiet);
  });
});

describe("workedFromByWorktree", () => {
  const working = { "r::b": { agentIds: ["a1"], mainIn: false } };
  it("is running only while the source session is active", () => {
    expect(workedFromByWorktree([{ worktreeId: "r::a", active: true, links: working }], {}))
      .toEqual({ "r::b": { worktreeId: "r::a", running: true } });
    expect(workedFromByWorktree([{ worktreeId: "r::a", active: false, links: working }], {}))
      .toEqual({ "r::b": { worktreeId: "r::a", running: false } });
  });
  it("prefers a running link, then running external work, then a quiet link", () => {
    const quiet = { "r::b": { agentIds: [], mainIn: false } };
    expect(workedFromByWorktree([{ worktreeId: "r::a", active: true, links: quiet }], { "r::b": { running: true } }))
      .toEqual({ "r::b": { running: true } });
    expect(workedFromByWorktree([{ worktreeId: "r::a", active: true, links: working }], { "r::b": { running: true } }))
      .toEqual({ "r::b": { worktreeId: "r::a", running: true } });
  });
});

describe("orchestrationsFromLinks", () => {
  it("names the orchestration after the head and puts the head first", () => {
    const worktrees = [
      wt({ id: "r::orch", path: "/wt/orch", branch: "jack/billing-orchestrator", repoPath: "r" }),
      wt({ id: "r::ui", path: "/wt/ui", branch: "jack/billing-ui", repoPath: "r", workedFrom: { worktreeId: "r::orch", running: true } }),
      wt({ id: "r::api", path: "/wt/api", branch: "jack/billing-api", repoPath: "r", workedFrom: { worktreeId: "r::orch", running: false } }),
      wt({ id: "r::term", path: "/wt/term", branch: "x", repoPath: "r", workedFrom: { running: true } }),
    ];
    expect(orchestrationsFromLinks("r", worktrees, { "/wt/orch": "Billing" })).toEqual([
      { repoPath: "r", name: "Billing", orchestratorId: "r::orch", fromLinks: true, items: [
        { worktreeId: "r::orch", title: "orchestrator" },
        { worktreeId: "r::api", title: "jack/billing-api" },
        { worktreeId: "r::ui", title: "jack/billing-ui" },
      ] },
    ]);
  });
  it("sets orchestratorId to the head and fromLinks to true", () => {
    const worktrees = [
      wt({ id: "r::orch", path: "/wt/orch", branch: "o", repoPath: "r" }),
      wt({ id: "r::ui", path: "/wt/ui", branch: "ui", repoPath: "r", workedFrom: { worktreeId: "r::orch", running: true } }),
    ];
    const [o] = orchestrationsFromLinks("r", worktrees, {});
    expect(o.orchestratorId).toBe("r::orch");
    expect(o.fromLinks).toBe(true);
    expect(o.plan).toBeUndefined();
  });
  it("ignores a head in another repo", () => {
    const worktrees = [wt({ id: "r::b", repoPath: "r", workedFrom: { worktreeId: "other::a", running: true } })];
    expect(orchestrationsFromLinks("r", worktrees, {})).toEqual([]);
  });
});

describe("orchestrationsForRepo", () => {
  const rules = [{ name: "Billing rule", branchPrefix: "jack/billing-" }];
  const head = wt({ id: "r::orch", path: "/wt/orch", branch: "jack/orchestrator", repoPath: "r", agentStatus: "busy" });
  const both = wt({
    id: "r::api", path: "/wt/api", branch: "jack/billing-api", repoPath: "r",
    agentStatus: "waitingForInput", workedFrom: { worktreeId: "r::orch", running: false },
  });

  it("puts note and rule orchestrations before link orchestrations", () => {
    const noted = wt({ id: "r::n", path: "/wt/n", branch: "n", repoPath: "r", note: { orchestration: "Noted" } });
    expect(orchestrationsForRepo("r", [head, both, noted], rules, { "/wt/orch": "Billing" })).toEqual([
      { repoPath: "r", name: "Noted", items: [{ worktreeId: "r::n", title: "n" }] },
      { repoPath: "r", name: "Billing rule", items: [{ worktreeId: "r::api", title: "api" }] },
      { repoPath: "r", name: "Billing", orchestratorId: "r::orch", fromLinks: true, items: [
        { worktreeId: "r::orch", title: "orchestrator" },
        { worktreeId: "r::api", title: "jack/billing-api" },
      ] },
    ]);
  });
  it("leaves a worktree that a rule and a link both list in the rule's orchestration", () => {
    const rows = yourTurnRows(orchestrationsForRepo("r", [head, both], rules, {}), [head, both], new Set(["r::api"]), new Set(), {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ worktreeId: "r::api", orchestrationName: "Billing rule", itemTitle: "api" });
  });
  it("has no fromLinks on a note or rule orchestration", () => {
    const noted = wt({ id: "r::n", path: "/wt/n", branch: "n", repoPath: "r", note: { orchestration: "Noted" } });
    const [fromNote, fromRule] = orchestrationsForRepo("r", [noted, both], rules, {});
    expect(fromNote.fromLinks).toBeUndefined();
    expect(fromRule.fromLinks).toBeUndefined();
  });
  it("lists only the given repo", () => {
    expect(orchestrationsForRepo("other", [head, both], rules, {})).toEqual([
      { repoPath: "other", name: "Billing rule", items: [] },
    ]);
  });
});

describe("claimWorktrees", () => {
  const link = (name: string, head: string, ids: string[]): Orchestration => ({
    ...orch(name, ids),
    orchestratorId: head,
    fromLinks: true,
  });
  it("keeps a worktree only in the first orchestration that lists it", () => {
    const result = claimWorktrees([orch("N", ["x", "y"]), link("L", "h", ["h", "x"])]);
    expect(result.map((o) => o.items.map((i) => i.worktreeId))).toEqual([["x", "y"], ["h"]]);
    expect(result[1].orchestratorId).toBe("h");
    expect(result[1].fromLinks).toBe(true);
  });
  it("removes an orchestration left with no items", () => {
    const result = claimWorktrees([orch("N", ["x"]), orch("M", ["x"])]);
    expect(result.map((o) => o.name)).toEqual(["N"]);
  });
  it("clears orchestratorId when an earlier orchestration holds that worktree", () => {
    const result = claimWorktrees([orch("N", ["h"]), link("L", "h", ["h", "z"])]);
    expect(result[1].items.map((i) => i.worktreeId)).toEqual(["z"]);
    expect(result[1].orchestratorId).toBeUndefined();
    expect("orchestratorId" in result[1]).toBe(false);
  });
  it("keeps plan on the orchestration it returns", () => {
    const plan: PlanItem[] = [{ key: "p1", state: "todo" }];
    const [o] = claimWorktrees([{ ...orch("N", ["a"]), orchestratorId: "a", plan }]);
    expect(o.plan).toEqual(plan);
    expect(o.orchestratorId).toBe("a");
  });
});

describe("shownOrchestrations", () => {
  const link = (name: string, head: string, ids: string[]): Orchestration => ({
    ...orch(name, ids),
    orchestratorId: head,
    fromLinks: true,
  });
  it("drops a link orchestration whose other worktrees a note already places", () => {
    const shown = shownOrchestrations([orch("N", ["x", "y"]), link("L", "h", ["h", "x"])]);
    expect(shown.map((o) => o.name)).toEqual(["N"]);
  });
  it("keeps an orchestration with one item when it has a plan", () => {
    const plan: PlanItem[] = [{ key: "p1", state: "todo" }];
    const shown = shownOrchestrations([{ ...orch("N", ["a"]), orchestratorId: "a", plan }, orch("M", ["b"])]);
    expect(shown.map((o) => o.name)).toEqual(["N"]);
  });
  it("drops an orchestration with one item and a plan but no orchestrator", () => {
    const plan: PlanItem[] = [{ key: "p1", state: "todo" }];
    expect(shownOrchestrations([{ ...orch("N", ["a"]), plan }])).toEqual([]);
  });
});

describe("orchestrationMarks", () => {
  const worktrees = (...ids: string[]) => ids.map((id) => wt({ id, path: `/r/${id}` }));
  const withOrchestrator = (name: string, head: string, ids: string[]): Orchestration => ({
    ...orch(name, ids),
    orchestratorId: head,
  });
  it("marks members and the orchestrator, and leaves other worktrees out", () => {
    const marks = orchestrationMarks([withOrchestrator("N", "a", ["a", "b"])], worktrees("a", "b", "c"), new Map());
    expect(marks.get("a")).toEqual({ orchestrator: true, hue: null });
    expect(marks.get("b")).toEqual({ orchestrator: false, hue: null });
    expect(marks.has("c")).toBe(false);
  });
  it("gives no mark to an archived worktree", () => {
    const list = [wt({ id: "a" }), wt({ id: "b", archived: true })];
    const marks = orchestrationMarks([orch("N", ["a", "b"])], list, new Map());
    expect([...marks.keys()]).toEqual(["a"]);
  });
  it("uses the accent tint for one orchestration and a hue each for two", () => {
    const list = worktrees("a", "b", "c", "d");
    const one = orchestrationMarks([orch("N", ["a", "b"])], list, new Map());
    expect(one.get("a")?.hue).toBeNull();
    const two = orchestrationMarks([orch("N", ["a", "b"]), orch("M", ["c", "d"])], list, new Map());
    expect([two.get("a")?.hue, two.get("c")?.hue]).toEqual([0, 1]);
  });
  it("does not count an orchestration with only archived rows toward the two", () => {
    const list = [wt({ id: "a" }), wt({ id: "b" }), wt({ id: "c", archived: true }), wt({ id: "d", archived: true })];
    const marks = orchestrationMarks([orch("N", ["a", "b"]), orch("M", ["c", "d"])], list, new Map());
    expect(marks.get("a")?.hue).toBeNull();
  });
  it("does not count an orchestration whose only live item is in branch mode, and gives it no slot", () => {
    const list = [wt({ id: "a" }), wt({ id: "b" }), wt({ id: "c", isBranchMode: true }), wt({ id: "d", archived: true })];
    const marks = orchestrationMarks([orch("N", ["a", "b"]), orch("M", ["c", "d"])], list, new Map());
    expect(marks.get("a")?.hue).toBeNull();
    const three = [...list, wt({ id: "e" }), wt({ id: "f" })];
    const withThird = orchestrationMarks(
      [orch("N", ["a", "b"]), orch("M", ["c", "d"]), orch("P", ["e", "f"])],
      three,
      new Map(),
    );
    expect([withThird.get("a")?.hue, withThird.get("e")?.hue]).toEqual([0, 1]);
  });
  it("takes the slots after the ones stacks use", () => {
    const list = worktrees("a", "b", "c", "d");
    const marks = orchestrationMarks(
      [orch("N", ["a", "b"]), orch("M", ["c", "d"])],
      list,
      new Map([["s1", 0], ["s2", 1]]),
    );
    expect([marks.get("a")?.hue, marks.get("c")?.hue]).toEqual([2, 3]);
  });
  it("wraps when no slot is free", () => {
    const list = worktrees("a", "b", "c", "d");
    const marks = orchestrationMarks(
      [orch("N", ["a", "b"]), orch("M", ["c", "d"])],
      list,
      new Map([0, 1, 2, 3, 4, 5].map((slot) => [`s${slot}`, slot])),
    );
    expect([marks.get("a")?.hue, marks.get("c")?.hue]).toEqual([0, 1]);
  });
});

describe("orchestrationMarksFor", () => {
  const noted = (id: string, orchestration: string, extra: Partial<Worktree> = {}) =>
    wt({ id, path: `/r/${id}`, branch: id, note: { orchestration }, ...extra });
  const list = () => [noted("a", "N"), noted("b", "N"), noted("c", "M"), noted("d", "M")];

  it("returns the same map for the same worktrees array and rules", () => {
    const worktrees = list();
    const rules = {};
    expect(orchestrationMarksFor(worktrees, rules)).toBe(orchestrationMarksFor(worktrees, rules));
  });
  it("recomputes when rules change but worktrees is the same array", () => {
    const worktrees = [wt({ id: "a", path: "/r/a", branch: "bill/a" }), wt({ id: "b", path: "/r/b", branch: "bill/b" })];
    expect(orchestrationMarksFor(worktrees, {}).size).toBe(0);
    const marks = orchestrationMarksFor(worktrees, { "/r": [{ name: "Billing", branchPrefix: "bill/" }] });
    expect([...marks.keys()].sort()).toEqual(["a", "b"]);
  });
  it("keeps each mark's identity across a new array with the same content", () => {
    const worktrees = list();
    const rules = {};
    const a = orchestrationMarksFor(worktrees, rules);
    const b = orchestrationMarksFor([...worktrees], rules);
    expect(b).not.toBe(a);
    expect(a.size).toBe(4);
    for (const id of a.keys()) expect(b.get(id)).toBe(a.get(id));
  });
  it("gives a new mark object when a mark's content changed", () => {
    const rules = {};
    const before = orchestrationMarksFor(list(), rules);
    const after = orchestrationMarksFor([noted("a", "N"), noted("b", "N")], rules);
    expect(before.get("a")?.hue).toBe(0);
    expect(after.get("a")).not.toBe(before.get("a"));
    expect(after.get("a")?.hue).toBeNull();
  });
  it("lists repo B's orchestrations first when B's worktrees come first", () => {
    const inRepo = (repoPath: string, id: string, orchestration: string) =>
      wt({ id, repoPath, path: `${repoPath}/${id}`, branch: id, note: { orchestration } });
    const worktrees = [
      inRepo("/b", "b1", "B"), inRepo("/b", "b2", "B"),
      inRepo("/a", "a1", "A"), inRepo("/a", "a2", "A"),
    ];
    const marks = orchestrationMarksFor(worktrees, {});
    expect([marks.get("b1")?.hue, marks.get("a1")?.hue]).toEqual([0, 1]);
  });
  it("takes the slots after the ones that stacks on screen use", () => {
    const worktrees = [
      wt({ id: "r1", path: "/r/r1", branch: "feat/r1" }),
      wt({ id: "c1", path: "/r/c1", branch: "feat/c1", stackParent: "feat/r1" }),
      wt({ id: "r2", path: "/r/r2", branch: "feat/r2" }),
      wt({ id: "c2", path: "/r/c2", branch: "feat/c2", stackParent: "feat/r2" }),
      noted("a", "N"), noted("b", "N"), noted("c", "M"), noted("d", "M"),
    ];
    const marks = orchestrationMarksFor(worktrees, {});
    expect([marks.get("a")?.hue, marks.get("c")?.hue]).toEqual([2, 3]);
  });
  it("gives one mark to a worktree that a note places and a session works in", () => {
    const worktrees = [
      noted("x", "N"),
      noted("y", "N"),
      wt({ id: "h", path: "/r/h", branch: "h" }),
      wt({ id: "w", path: "/r/w", branch: "w", workedFrom: { worktreeId: "h", running: true } }),
      noted("z", "N", { workedFrom: { worktreeId: "h", running: true } }),
    ];
    const marks = orchestrationMarksFor(worktrees, {});
    expect(marks.get("z")).toEqual(marks.get("x"));
    expect(marks.get("h")?.orchestrator).toBe(true);
  });
});

describe("orchestrationOf", () => {
  it("returns the shown orchestration that holds the worktree, named from labels", () => {
    const head = wt({ id: "h", path: "/r/h", branch: "h" });
    const w = wt({ id: "w", path: "/r/w", branch: "w", workedFrom: { worktreeId: "h", running: true } });
    const found = orchestrationOf("w", [head, w], {}, { "/r/h": "Billing" });
    expect(found?.name).toBe("Billing");
    expect(orchestrationOf("nope", [head, w], {}, {})).toBeUndefined();
  });
});

describe("markLine", () => {
  const plan: PlanItem[] = [
    { key: "1", name: "PR 1", state: "merged", folder: "rule" },
    { key: "2", name: "PR 2", after: "1", state: "active", folder: "payroll" },
    { key: "5", name: "PR 5", after: "1", alsoAfter: ["4", "2"], state: "active", folder: "set-up" },
    { key: "6", name: "PR 6", after: "5", state: "todo" },
    { key: "7", after: "5", state: "todo" },
  ];
  const items = ["o", "a", "b", "c", "d"].map((worktreeId) => ({ worktreeId, title: worktreeId }));
  const withPlan: Orchestration = { repoPath: "/r", name: "N", items, orchestratorId: "o", plan };
  const noPlan: Orchestration = { repoPath: "/r", name: "N", items: items.slice(0, 3), orchestratorId: "o" };

  it("names the item, its parents and what waits for it", () => {
    expect(markLine(withPlan, { id: "b", path: "/r/set-up" })).toBe(
      "PR 5 · after PR 1 · also after PR 2 · PR 6 and 7 wait for it",
    );
  });
  it("leaves out the parts that are empty", () => {
    expect(markLine(withPlan, { id: "a", path: "/r/rule" })).toBe("PR 1");
  });
  it("counts merged items for the orchestrator", () => {
    expect(markLine(withPlan, { id: "o", path: "/r/orch" })).toBe("Orchestrator · 1 of 5 merged");
  });
  it("counts worktrees when there is no plan", () => {
    expect(markLine(noPlan, { id: "o", path: "/r/orch" })).toBe("Orchestrator · 3 worktrees");
    expect(markLine(noPlan, { id: "a", path: "/r/a" })).toBe("3 worktrees");
  });
  it("counts worktrees for a member that no plan item names", () => {
    expect(markLine(withPlan, { id: "c", path: "/r/unknown" })).toBe("5 worktrees");
  });
  it("lists three waiting names with commas", () => {
    const p: PlanItem[] = [
      { key: "1", name: "A", state: "active", folder: "a" },
      { key: "2", name: "B", after: "1", state: "todo" },
      { key: "3", name: "C", after: "1", state: "todo" },
      { key: "4", name: "D", after: "1", state: "todo" },
    ];
    expect(markLine({ ...withPlan, plan: p }, { id: "a", path: "/r/a" })).toBe("A · B, C and D wait for it");
  });
  it("says waits for a single name", () => {
    const p: PlanItem[] = [
      { key: "1", name: "A", state: "active", folder: "a" },
      { key: "2", name: "B", after: "1", state: "todo" },
    ];
    expect(markLine({ ...withPlan, plan: p }, { id: "a", path: "/r/a" })).toBe("A · B waits for it");
  });
});

describe("noPlanHint", () => {
  const base: Orchestration = {
    repoPath: "/r",
    name: "N",
    items: [
      { worktreeId: "a", title: "a" },
      { worktreeId: "b", title: "b" },
    ],
  };
  it("tells a note or rule orchestration with no plan where to look", () => {
    expect(noPlanHint(base)).toBe("No map: this orchestration has no plan. See Help › Worktree notes.");
  });
  it("is null with a plan", () => {
    expect(noPlanHint({ ...base, plan: [{ key: "1", state: "todo" }] })).toBeNull();
  });
  it("is null for an orchestration made from links", () => {
    expect(noPlanHint({ ...base, fromLinks: true })).toBeNull();
  });
});

describe("planLayout", () => {
  const at = (layout: ReturnType<typeof planLayout>, key: string) => layout.nodes.find((n) => n.key === key);
  it("lays out the mockup's plan", () => {
    const layout = planLayout([
      { key: "1", state: "merged" },
      { key: "2", after: "1", state: "active" },
      { key: "5", after: "1", state: "active" },
      { key: "6", after: "5", state: "todo" },
    ]);
    expect(layout.nodes).toEqual([
      { key: "1", col: 0, row: 0.5 },
      { key: "2", col: 1, row: 0 },
      { key: "5", col: 1, row: 1 },
      { key: "6", col: 2, row: 1 },
    ]);
    expect(layout.edges).toEqual([
      { from: "1", to: "2" },
      { from: "1", to: "5" },
      { from: "5", to: "6" },
    ]);
    expect(layout.cols).toBe(3);
    expect(layout.rows).toBe(2);
  });
  it("makes a root of an item whose parent is missing or is itself", () => {
    const layout = planLayout([
      { key: "a", after: "zzz", state: "todo" },
      { key: "b", after: "b", state: "todo" },
      { key: "c", state: "todo" },
    ]);
    expect(layout.nodes).toEqual([
      { key: "a", col: 0, row: 0 },
      { key: "b", col: 0, row: 1 },
      { key: "c", col: 0, row: 2 },
    ]);
    expect(layout.edges).toEqual([]);
    expect(layout.cols).toBe(1);
    expect(layout.rows).toBe(3);
  });
  it("makes roots of the items of a cycle and still places what hangs off them", () => {
    const layout = planLayout([
      { key: "a", after: "b", state: "todo" },
      { key: "b", after: "a", state: "todo" },
      { key: "c", after: "a", state: "todo" },
    ]);
    expect(at(layout, "a")).toEqual({ key: "a", col: 0, row: 0 });
    expect(at(layout, "b")).toEqual({ key: "b", col: 0, row: 1 });
    expect(at(layout, "c")).toEqual({ key: "c", col: 1, row: 0 });
    expect(layout.edges).toEqual([{ from: "a", to: "c" }]);
  });
  it("ignores an item whose key an earlier item has", () => {
    const layout = planLayout([
      { key: "p", state: "todo" },
      { key: "q", state: "todo" },
      { key: "q", after: "p", state: "todo" },
      { key: "p", after: "q", state: "todo" },
    ]);
    expect(layout.nodes).toEqual([
      { key: "p", col: 0, row: 0 },
      { key: "q", col: 0, row: 1 },
    ]);
    expect(layout.edges).toEqual([]);
  });
  it("returns an empty layout for an empty plan", () => {
    expect(planLayout([])).toEqual({ nodes: [], edges: [], cols: 0, rows: 0 });
  });
  it("handles 50 items in one chain", () => {
    const plan: PlanItem[] = Array.from({ length: 50 }, (_, i) => ({
      key: `k${i}`,
      ...(i > 0 ? { after: `k${i - 1}` } : {}),
      state: "todo" as const,
    }));
    const layout = planLayout(plan);
    expect(layout.cols).toBe(50);
    expect(layout.rows).toBe(1);
    expect(layout.nodes).toHaveLength(50);
  });
});

describe("planSquareLook", () => {
  it("follows the state for merged, closed and todo", () => {
    expect(planSquareLook({ key: "1", state: "merged" }, undefined, none, none)).toBe("merged");
    expect(planSquareLook({ key: "1", state: "closed" }, undefined, none, none)).toBe("closed");
    expect(planSquareLook({ key: "1", state: "todo" }, undefined, none, none)).toBe("todo");
  });
  it("is needsYou for an active item whose worktree waits for input", () => {
    const waiting = wt({ agentStatus: "waitingForInput" });
    expect(planSquareLook({ key: "1", state: "active" }, waiting, none, none)).toBe("needsYou");
  });
  it("is active for an active item with no worktree", () => {
    expect(planSquareLook({ key: "1", state: "active" }, undefined, none, none)).toBe("active");
  });
});

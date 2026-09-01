import { describe, expect, it } from "vitest";
import type { PrComment } from "../../types";
import { groupPrCommentsByLine, getRowComments, splitIntoThreads } from "./prCommentLookup";

function comment(overrides: Partial<PrComment>): PrComment {
  return {
    id: 1,
    author: "tester",
    body: "looks fine",
    path: "src/foo.rb",
    line: 10,
    side: "new",
    resolved: false,
    threadId: null,
    inReplyToId: null,
    createdAt: "2026-05-19T00:00:00Z",
    updatedAt: "2026-05-19T00:00:00Z",
    htmlUrl: "https://example.test",
    ...overrides,
  };
}

describe("groupPrCommentsByLine", () => {
  it("excludes comments for other files", () => {
    const map = groupPrCommentsByLine(
      [comment({ id: 1, path: "src/foo.rb" }), comment({ id: 2, path: "src/bar.rb" })],
      "src/foo.rb",
    );
    const all = [...map.values()].flat();
    expect(all.map((c) => c.id)).toEqual([1]);
  });

  it("excludes comments with no line anchor", () => {
    const map = groupPrCommentsByLine(
      [comment({ id: 1, line: 5 }), comment({ id: 2, line: null })],
      "src/foo.rb",
    );
    expect([...map.values()].flat().map((c) => c.id)).toEqual([1]);
  });

  it("keys on side and line so RIGHT and LEFT do not collide", () => {
    const map = groupPrCommentsByLine(
      [
        comment({ id: 1, side: "new", line: 89 }),
        comment({ id: 2, side: "old", line: 89 }),
      ],
      "src/foo.rb",
    );
    expect(map.get("new:89")?.map((c) => c.id)).toEqual([1]);
    expect(map.get("old:89")?.map((c) => c.id)).toEqual([2]);
  });

  it("matches comments under the old path for renamed files", () => {
    const map = groupPrCommentsByLine(
      [
        comment({ id: 1, path: "src/foo.rb", line: 5 }),
        comment({ id: 2, path: "src/foo_legacy.rb", line: 7 }),
        comment({ id: 3, path: "src/unrelated.rb", line: 9 }),
      ],
      "src/foo.rb",
      "src/foo_legacy.rb",
    );
    const all = [...map.values()].flat().map((c) => c.id).sort();
    expect(all).toEqual([1, 2]);
  });

  it("groups multiple comments on the same anchor", () => {
    const map = groupPrCommentsByLine(
      [
        comment({ id: 1, side: "new", line: 89 }),
        comment({ id: 2, side: "new", line: 89 }),
      ],
      "src/foo.rb",
    );
    expect(map.get("new:89")?.map((c) => c.id)).toEqual([1, 2]);
  });
});

describe("getRowComments", () => {
  const map = groupPrCommentsByLine(
    [
      comment({ id: 1, side: "new", line: 89 }), // RIGHT-side at new line 89
      comment({ id: 2, side: "old", line: 89 }), // LEFT-side at old line 89
      comment({ id: 3, side: "old", line: 12 }), // LEFT-side at old line 12
    ],
    "src/foo.rb",
  );

  it("addition row picks up only the RIGHT-side comment", () => {
    // Addition: oldLineNumber=null, newLineNumber=89
    const result = getRowComments(map, null, 89);
    expect(result.map((c) => c.id)).toEqual([1]);
  });

  it("deletion row picks up only the LEFT-side comment", () => {
    // Deletion: oldLineNumber=89, newLineNumber=null
    const result = getRowComments(map, 89, null);
    expect(result.map((c) => c.id)).toEqual([2]);
  });

  it("context row picks up comments from both sides at their own line numbers", () => {
    // Context: oldLineNumber=12, newLineNumber=89 — both sides anchor here
    const result = getRowComments(map, 12, 89);
    expect(new Set(result.map((c) => c.id))).toEqual(new Set([1, 3]));
  });

  it("returns empty for rows with no line numbers", () => {
    expect(getRowComments(map, null, null)).toEqual([]);
  });

  it("does not double-render a single comment across collision-prone rows", () => {
    // Regression: previously a comment with line=89 (regardless of side) would
    // render on every row whose old- or newLineNumber was 89.
    const additionRow = getRowComments(map, null, 89); // new-side row
    const deletionRow = getRowComments(map, 89, null); // old-side row
    // Comment id 1 is RIGHT-side and must only appear on the addition row.
    expect(additionRow.find((c) => c.id === 1)).toBeDefined();
    expect(deletionRow.find((c) => c.id === 1)).toBeUndefined();
    // Comment id 2 is LEFT-side and must only appear on the deletion row.
    expect(deletionRow.find((c) => c.id === 2)).toBeDefined();
    expect(additionRow.find((c) => c.id === 2)).toBeUndefined();
  });
});

describe("splitIntoThreads", () => {
  it("keeps a single thread together, replies included", () => {
    const threads = splitIntoThreads([
      comment({ id: 1, threadId: "T1" }),
      comment({ id: 2, threadId: "T1", inReplyToId: 1 }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0].map((c) => c.id)).toEqual([1, 2]);
  });

  it("splits two threads sharing the same line", () => {
    const threads = splitIntoThreads([
      comment({ id: 1, threadId: "T1" }),
      comment({ id: 2, threadId: "T2" }),
      comment({ id: 3, threadId: "T2", inReplyToId: 2 }),
    ]);
    expect(threads).toHaveLength(2);
    expect(threads[0].map((c) => c.id)).toEqual([1]);
    expect(threads[1].map((c) => c.id)).toEqual([2, 3]);
  });

  it("falls back to the reply chain's root when threadId is missing", () => {
    const threads = splitIntoThreads([
      comment({ id: 1, threadId: null }),
      comment({ id: 2, threadId: null, inReplyToId: 1 }),
      comment({ id: 3, threadId: null }),
    ]);
    expect(threads).toHaveLength(2);
    expect(threads[0].map((c) => c.id)).toEqual([1, 2]);
    expect(threads[1].map((c) => c.id)).toEqual([3]);
  });
});

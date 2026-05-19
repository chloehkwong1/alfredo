import { describe, expect, it } from "vitest";
import type { DiffLine } from "../../types";
import { pairLinesForSplit } from "./splitPairing";

function ctx(content: string, oldLineNumber: number, newLineNumber: number): DiffLine {
  return { lineType: "context", content: ` ${content}`, oldLineNumber, newLineNumber };
}
function del(content: string, oldLineNumber: number): DiffLine {
  return { lineType: "deletion", content: `-${content}`, oldLineNumber, newLineNumber: null };
}
function add(content: string, newLineNumber: number): DiffLine {
  return { lineType: "addition", content: `+${content}`, oldLineNumber: null, newLineNumber };
}

describe("pairLinesForSplit", () => {
  it("tags context rows with the same originalLineIndex on both sides", () => {
    const rows = pairLinesForSplit([ctx("a", 10, 20)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].left?.originalLineIndex).toBe(0);
    expect(rows[0].right?.originalLineIndex).toBe(0);
  });

  it("tags a pure addition with the source index on the right only", () => {
    const rows = pairLinesForSplit([ctx("a", 10, 20), add("b", 21)]);
    expect(rows[1].left).toBeNull();
    expect(rows[1].right?.originalLineIndex).toBe(1);
  });

  it("tags a pure deletion (no following addition) with the source index on the left only", () => {
    const rows = pairLinesForSplit([del("a", 10), ctx("b", 11, 20)]);
    expect(rows[0].left?.originalLineIndex).toBe(0);
    expect(rows[0].right).toBeNull();
  });

  it("pairs a deletion with the following addition using their original indices", () => {
    // Indices: 0=del, 1=add
    const rows = pairLinesForSplit([del("a", 10), add("a'", 10)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].left?.originalLineIndex).toBe(0);
    expect(rows[0].right?.originalLineIndex).toBe(1);
  });

  it("preserves source indices across longer deletion/addition runs and uneven pairings", () => {
    // Indices: 0=del, 1=del, 2=add, 3=add, 4=add
    const rows = pairLinesForSplit([
      del("a", 10),
      del("b", 11),
      add("a'", 10),
      add("b'", 11),
      add("c", 12),
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0].left?.originalLineIndex).toBe(0);
    expect(rows[0].right?.originalLineIndex).toBe(2);
    expect(rows[1].left?.originalLineIndex).toBe(1);
    expect(rows[1].right?.originalLineIndex).toBe(3);
    expect(rows[2].left).toBeNull();
    expect(rows[2].right?.originalLineIndex).toBe(4);
  });
});

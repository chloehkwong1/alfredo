import { describe, it, expect } from "vitest";
import { diffToTexts } from "./decorations";
import type { DiffFile } from "../../types";

const file = (hunks: DiffFile["hunks"]): DiffFile => ({
  path: "x.ts",
  status: "modified",
  additions: 0,
  deletions: 0,
  hunks,
});

describe("diffToTexts", () => {
  it("returns empty strings for an empty diff", () => {
    expect(diffToTexts(file([]))).toEqual({ original: "", modified: "" });
  });

  it("reconstructs context lines into both sides", () => {
    const result = diffToTexts(file([{
      header: "@@ -1,2 +1,2 @@",
      oldStart: 1, newStart: 1,
      lines: [
        { lineType: "context", content: "a", oldLineNumber: 1, newLineNumber: 1 },
        { lineType: "context", content: "b", oldLineNumber: 2, newLineNumber: 2 },
      ],
    }]));
    expect(result.original).toBe("a\nb");
    expect(result.modified).toBe("a\nb");
  });

  it("splits additions/deletions to their respective sides", () => {
    const result = diffToTexts(file([{
      header: "@@ -1,2 +1,2 @@",
      oldStart: 1, newStart: 1,
      lines: [
        { lineType: "deletion", content: "old", oldLineNumber: 1, newLineNumber: null },
        { lineType: "addition", content: "new", oldLineNumber: null, newLineNumber: 1 },
        { lineType: "context", content: "shared", oldLineNumber: 2, newLineNumber: 2 },
      ],
    }]));
    expect(result.original).toBe("old\nshared");
    expect(result.modified).toBe("new\nshared");
  });

  it("pads with blank lines so line numbers align with the real file", () => {
    const result = diffToTexts(file([{
      header: "@@ -5,1 +5,1 @@",
      oldStart: 5, newStart: 5,
      lines: [
        { lineType: "context", content: "x", oldLineNumber: 5, newLineNumber: 5 },
      ],
    }]));
    expect(result.original.split("\n")).toEqual(["", "", "", "", "x"]);
    expect(result.modified.split("\n")).toEqual(["", "", "", "", "x"]);
  });
});

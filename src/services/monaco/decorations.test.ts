import { describe, it, expect } from "vitest";
import { diffToTexts } from "./decorations";
import type { DiffFile } from "../../types";

const file = (overrides: Partial<DiffFile>): DiffFile => ({
  path: "x.ts",
  status: "modified",
  additions: 0,
  deletions: 0,
  hunks: [],
  ...overrides,
});

describe("diffToTexts", () => {
  it("returns empty strings when content is absent", () => {
    expect(diffToTexts(file({}))).toEqual({ original: "", modified: "" });
  });

  it("passes through both sides when present", () => {
    const result = diffToTexts(
      file({ originalContent: "a\nb", modifiedContent: "a\nc" }),
    );
    expect(result).toEqual({ original: "a\nb", modified: "a\nc" });
  });

  it("treats added files as empty original", () => {
    const result = diffToTexts(
      file({ status: "added", originalContent: null, modifiedContent: "hello\n" }),
    );
    expect(result).toEqual({ original: "", modified: "hello\n" });
  });

  it("treats deleted files as empty modified", () => {
    const result = diffToTexts(
      file({ status: "deleted", originalContent: "bye\n", modifiedContent: null }),
    );
    expect(result).toEqual({ original: "bye\n", modified: "" });
  });

  it("returns empty strings on both sides for binary/oversized", () => {
    const result = diffToTexts(
      file({ originalContent: null, modifiedContent: null }),
    );
    expect(result).toEqual({ original: "", modified: "" });
  });
});

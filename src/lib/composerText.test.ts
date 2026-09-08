import { describe, expect, it } from "vitest";
import { buildSuggestionBlock, insertAtCursor } from "./composerText";

describe("insertAtCursor", () => {
  it("inserts at a collapsed cursor", () => {
    expect(insertAtCursor("hello world", 5, 5, " brave")).toEqual({
      next: "hello brave world",
      caret: 11,
    });
  });

  it("replaces a selection", () => {
    expect(insertAtCursor("hello world", 6, 11, "😀")).toEqual({
      next: "hello 😀",
      caret: 8, // 😀 is 2 UTF-16 code units — caret maths must use .length, not grapheme count
    });
  });

  it("appends to empty value", () => {
    expect(insertAtCursor("", 0, 0, "![gif](https://x.gif)")).toEqual({
      next: "![gif](https://x.gif)",
      caret: 21,
    });
  });
});

describe("buildSuggestionBlock", () => {
  it("wraps the line in a suggestion fence", () => {
    expect(buildSuggestionBlock("  const x = 1;")).toBe(
      "```suggestion\n  const x = 1;\n```\n"
    );
  });

  it("preserves an empty line", () => {
    expect(buildSuggestionBlock("")).toBe("```suggestion\n\n```\n");
  });
});

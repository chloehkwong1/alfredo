import { describe, expect, it } from "vitest";
import { buildSuggestionBlock, insertAtCursor, insertBlockAtCursor } from "./composerText";

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

describe("insertBlockAtCursor", () => {
  it("prefixes a newline when the caret is mid-line so the fence starts a line", () => {
    expect(insertBlockAtCursor("Fix this: ", 10, 10, "```suggestion\nfoo\n```\n")).toEqual({
      next: "Fix this: \n```suggestion\nfoo\n```\n",
      caret: 33,
    });
  });

  it("inserts as-is at the start of the value", () => {
    expect(insertBlockAtCursor("", 0, 0, "```suggestion\nfoo\n```\n")).toEqual({
      next: "```suggestion\nfoo\n```\n",
      caret: 22,
    });
  });

  it("inserts as-is immediately after a newline", () => {
    expect(insertBlockAtCursor("line one\n", 9, 9, "block\n")).toEqual({
      next: "line one\nblock\n",
      caret: 15,
    });
  });

  it("replaces a mid-line selection and still lands on a line boundary", () => {
    expect(insertBlockAtCursor("say XXX here", 4, 7, "block\n")).toEqual({
      next: "say \nblock\n here",
      caret: 11,
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

  it("strips a single trailing newline so Apply doesn't insert a blank line", () => {
    expect(buildSuggestionBlock("  const x = 1;\n")).toBe(
      "```suggestion\n  const x = 1;\n```\n"
    );
  });

  it("strips a single trailing CRLF", () => {
    expect(buildSuggestionBlock("foo\r\n")).toBe("```suggestion\nfoo\n```\n");
  });

  it("preserves meaningful trailing whitespace before the newline", () => {
    expect(buildSuggestionBlock("foo  \n")).toBe(
      "```suggestion\nfoo  \n```\n"
    );
  });

  it("lengthens the fence when the line contains a triple-backtick run", () => {
    expect(buildSuggestionBlock("```")).toBe("````suggestion\n```\n````\n");
  });

  it("lengthens the fence past the longest backtick run in the line", () => {
    expect(buildSuggestionBlock("see ````md above")).toBe(
      "`````suggestion\nsee ````md above\n`````\n"
    );
  });

  it("keeps the 3-backtick fence for short backtick runs", () => {
    expect(buildSuggestionBlock("use `foo` and ``bar``")).toBe(
      "```suggestion\nuse `foo` and ``bar``\n```\n"
    );
  });
});

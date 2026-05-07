import { describe, it, expect } from "vitest";
import { validateBranchName } from "./validateBranchName";

describe("validateBranchName", () => {
  it.each([
    "feat/my-feature",
    "fix/issue-40",
    "chloe/refactor",
    "release/1.2.3",
    "_internal",
    "v1.0",
    "feature",
  ])("accepts %s", (name) => {
    expect(validateBranchName(name)).toBeNull();
  });

  it("rejects empty", () => {
    expect(validateBranchName("")).toBe("Branch name is required");
  });

  it("rejects spaces (the issue #40 case)", () => {
    expect(validateBranchName("karo diagnostics")).toBe(
      "Branch name cannot contain spaces",
    );
  });

  it.each([
    ["foo~bar", "'~'"],
    ["foo^bar", "'^'"],
    ["foo:bar", "':'"],
    ["foo?bar", "'?'"],
    ["foo*bar", "'*'"],
    ["foo[bar", "'['"],
    ["foo\\bar", "'\\'"],
  ])("rejects %s", (name, frag) => {
    expect(validateBranchName(name)).toContain(frag);
  });

  it("rejects control characters", () => {
    expect(validateBranchName("foo\tbar")).toContain("control");
    expect(validateBranchName("foobar")).toContain("control");
  });

  it("rejects leading dash, slash, dot", () => {
    expect(validateBranchName("-foo")).toContain("'-'");
    expect(validateBranchName("/foo")).toContain("start with '/'");
    expect(validateBranchName(".foo")).toContain("segments cannot start with '.'");
  });

  it("rejects trailing slash, dot, .lock", () => {
    expect(validateBranchName("foo/")).toContain("end with '/'");
    expect(validateBranchName("foo.")).toContain("end with '.'");
    expect(validateBranchName("foo.lock")).toContain("end with '.lock'");
  });

  it("rejects '..' and '//' and '@{'", () => {
    expect(validateBranchName("foo..bar")).toContain("'..'");
    expect(validateBranchName("foo//bar")).toContain("consecutive slashes");
    expect(validateBranchName("foo@{1}")).toContain("'@{'");
  });

  it("rejects single '@'", () => {
    expect(validateBranchName("@")).toContain("'@'");
  });

  it("rejects non-final segments starting with '.' or ending with '.lock'", () => {
    expect(validateBranchName("foo/.bar")).toContain("segments cannot start with '.'");
    // Final-segment ".lock" trips the whole-name rule first; use a non-final
    // segment to exercise the per-segment rule.
    expect(validateBranchName("foo.lock/bar")).toContain("segments cannot end with '.lock'");
  });
});

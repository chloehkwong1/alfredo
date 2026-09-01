import { describe, it, expect } from "vitest";
import { resolveSettings, buildClaudeArgs, withResumeSession } from "./claudeSettingsResolver";

describe("resolveSettings extraFlags", () => {
  it("takes extraFlags from the global layer when repo has none", () => {
    const r = resolveSettings({ extraFlags: "--verbose-logs" }, undefined);
    expect(r.extraFlags).toBe("--verbose-logs");
  });

  it("lets the repo layer override the global extraFlags", () => {
    const r = resolveSettings({ extraFlags: "--global" }, { extraFlags: "--repo" });
    expect(r.extraFlags).toBe("--repo");
  });

  it("falls through to global when repo extraFlags is empty string", () => {
    const r = resolveSettings({ extraFlags: "--global" }, { extraFlags: "" });
    expect(r.extraFlags).toBe("--global");
  });

  it("falls through to global when repo extraFlags is whitespace-only", () => {
    const r = resolveSettings({ extraFlags: "--global" }, { extraFlags: "   " });
    expect(r.extraFlags).toBe("--global");
  });

  it("resolves to undefined when both repo and global extraFlags are blank", () => {
    const r = resolveSettings({ extraFlags: "" }, { extraFlags: "   " });
    expect(r.extraFlags).toBeUndefined();
  });
});

describe("buildClaudeArgs extraFlags", () => {
  it("appends tokenized extra flags after the structured flags", () => {
    const args = buildClaudeArgs({ model: "opus", extraFlags: "--mcp-config ./mcp.json" });
    expect(args).toEqual(["--model", "opus", "--mcp-config", "./mcp.json"]);
  });

  it("keeps a single-quoted value as one token", () => {
    const args = buildClaudeArgs({ extraFlags: "--add-dir '/tmp/my dir'" });
    expect(args).toEqual(["--add-dir", "/tmp/my dir"]);
  });

  it("silently ignores malformed extra flags (unbalanced quote)", () => {
    const args = buildClaudeArgs({ model: "opus", extraFlags: "--add-dir 'oops" });
    expect(args).toEqual(["--model", "opus"]);
  });
});

describe("withResumeSession", () => {
  it("appends --resume when no existing resume flag is present", () => {
    expect(withResumeSession(["--model", "opus"], "abc")).toEqual([
      "--model", "opus", "--resume", "abc",
    ]);
  });

  it("strips space-form --resume and its value, then appends own session", () => {
    expect(withResumeSession(["--resume", "old", "--model", "opus"], "abc")).toEqual([
      "--model", "opus", "--resume", "abc",
    ]);
  });

  it("strips equals-form --resume=<id>, then appends own session", () => {
    expect(withResumeSession(["--resume=old", "--model", "opus"], "abc")).toEqual([
      "--model", "opus", "--resume", "abc",
    ]);
  });

  it("strips --continue, then appends own session", () => {
    expect(withResumeSession(["--continue", "--model", "opus"], "abc")).toEqual([
      "--model", "opus", "--resume", "abc",
    ]);
  });

  it("strips --resume in the middle without eating the following flag", () => {
    expect(withResumeSession(["--add-dir", "/x", "--resume", "old", "--verbose"], "abc")).toEqual([
      "--add-dir", "/x", "--verbose", "--resume", "abc",
    ]);
  });
});

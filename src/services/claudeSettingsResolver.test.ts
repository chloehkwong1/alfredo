import { describe, it, expect } from "vitest";
import { resolveSettings, buildClaudeArgs, withResumeSession } from "./claudeSettingsResolver";
import type { ClaudeDefaults } from "../types";

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

describe("resolveSettings dangerouslySkipPermissions", () => {
  it("takes the global value when the repo layer is unset", () => {
    const r = resolveSettings({ dangerouslySkipPermissions: true }, undefined);
    expect(r.dangerouslySkipPermissions).toBe(true);
  });

  it("is global-only: a stale repo-layer value is ignored", () => {
    // Pre-0.23 per-repo configs could carry the key; it is no longer part of
    // ClaudeDefaults, so it must not leak through the resolver.
    const stale = { dangerouslySkipPermissions: true, extraFlags: "--x" } as unknown as ClaudeDefaults;
    const r = resolveSettings({ dangerouslySkipPermissions: null }, stale);
    expect(r.dangerouslySkipPermissions).toBeUndefined();
  });
});

describe("buildClaudeArgs", () => {
  it("emits nothing when no setting is on", () => {
    expect(buildClaudeArgs({})).toEqual([]);
  });

  it("emits --dangerously-skip-permissions when the toggle is on", () => {
    expect(buildClaudeArgs({ dangerouslySkipPermissions: true })).toEqual(["--dangerously-skip-permissions"]);
  });

  it("appends tokenized extra flags after the skip-permissions flag", () => {
    const args = buildClaudeArgs({ dangerouslySkipPermissions: true, extraFlags: "--mcp-config ./mcp.json" });
    expect(args).toEqual(["--dangerously-skip-permissions", "--mcp-config", "./mcp.json"]);
  });

  it("keeps a single-quoted value as one token", () => {
    const args = buildClaudeArgs({ extraFlags: "--add-dir '/tmp/my dir'" });
    expect(args).toEqual(["--add-dir", "/tmp/my dir"]);
  });

  it("silently ignores malformed extra flags (unbalanced quote)", () => {
    const args = buildClaudeArgs({ dangerouslySkipPermissions: true, extraFlags: "--add-dir 'oops" });
    expect(args).toEqual(["--dangerously-skip-permissions"]);
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

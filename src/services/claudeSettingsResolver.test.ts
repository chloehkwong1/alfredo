import { describe, it, expect } from "vitest";
import { resolveSettings, buildLaunchArgs, withResumeSession, BYPASS_FLAG } from "./claudeSettingsResolver";
import type { ClaudeDefaults } from "../types";

describe("resolveSettings extraFlags (claude)", () => {
  it("takes extraFlags from the global layer when repo has none", () => {
    const r = resolveSettings("claude", { extraFlags: "--verbose-logs" }, undefined);
    expect(r.extraFlags).toBe("--verbose-logs");
  });

  it("lets the repo layer override the global extraFlags", () => {
    const r = resolveSettings("claude", { extraFlags: "--global" }, { extraFlags: "--repo" });
    expect(r.extraFlags).toBe("--repo");
  });

  it("falls through to global when repo extraFlags is empty string", () => {
    const r = resolveSettings("claude", { extraFlags: "--global" }, { extraFlags: "" });
    expect(r.extraFlags).toBe("--global");
  });

  it("falls through to global when repo extraFlags is whitespace-only", () => {
    const r = resolveSettings("claude", { extraFlags: "--global" }, { extraFlags: "   " });
    expect(r.extraFlags).toBe("--global");
  });

  it("resolves to undefined when both repo and global extraFlags are blank", () => {
    const r = resolveSettings("claude", { extraFlags: "" }, { extraFlags: "   " });
    expect(r.extraFlags).toBeUndefined();
  });
});

describe("resolveSettings extraFlags (codex)", () => {
  it("reads the codex slot, not the claude slot, at both layers", () => {
    const r = resolveSettings(
      "codex",
      { extraFlags: "--claude-global", codexExtraFlags: "--codex-global" },
      { extraFlags: "--claude-repo", codexExtraFlags: "--codex-repo" },
    );
    expect(r.extraFlags).toBe("--codex-repo");
  });

  it("falls through to the global codex slot when the repo codex slot is blank", () => {
    const r = resolveSettings(
      "codex",
      { extraFlags: "--claude-global", codexExtraFlags: "--codex-global" },
      { extraFlags: "--claude-repo", codexExtraFlags: " " },
    );
    expect(r.extraFlags).toBe("--codex-global");
  });

  it("never borrows claude flags when codex has none", () => {
    const r = resolveSettings("codex", { extraFlags: "--claude-global" }, { extraFlags: "--claude-repo" });
    expect(r.extraFlags).toBeUndefined();
  });
});

describe("resolveSettings dangerouslySkipPermissions", () => {
  it("takes the global value when the repo layer is unset", () => {
    const r = resolveSettings("claude", { dangerouslySkipPermissions: true }, undefined);
    expect(r.dangerouslySkipPermissions).toBe(true);
  });

  it("never lets claude's toggle reach codex, whose flag also drops the sandbox", () => {
    const r = resolveSettings("codex", { dangerouslySkipPermissions: true }, undefined);
    expect(r.dangerouslySkipPermissions).toBeUndefined();
  });

  it("reads codex's own toggle for codex", () => {
    const r = resolveSettings("codex", { codexDangerouslySkipPermissions: true }, undefined);
    expect(r.dangerouslySkipPermissions).toBe(true);
  });

  it("never lets codex's toggle reach claude", () => {
    const r = resolveSettings("claude", { codexDangerouslySkipPermissions: true }, undefined);
    expect(r.dangerouslySkipPermissions).toBeUndefined();
  });

  it("is global-only: a stale repo-layer value is ignored", () => {
    const stale = { dangerouslySkipPermissions: true, extraFlags: "--x" } as unknown as ClaudeDefaults;
    const r = resolveSettings("claude", { dangerouslySkipPermissions: null }, stale);
    expect(r.dangerouslySkipPermissions).toBeUndefined();
  });
});

describe("buildLaunchArgs", () => {
  it("emits nothing when no setting is on", () => {
    expect(buildLaunchArgs("claude", {})).toEqual([]);
    expect(buildLaunchArgs("codex", {})).toEqual([]);
  });

  it("emits each provider's bypass flag when the toggle is on", () => {
    expect(buildLaunchArgs("claude", { dangerouslySkipPermissions: true })).toEqual(["--dangerously-skip-permissions"]);
    expect(buildLaunchArgs("codex", { dangerouslySkipPermissions: true })).toEqual(["--dangerously-bypass-approvals-and-sandbox"]);
    expect(BYPASS_FLAG.claude).toBe("--dangerously-skip-permissions");
    expect(BYPASS_FLAG.codex).toBe("--dangerously-bypass-approvals-and-sandbox");
  });

  it("appends tokenized extra flags after the bypass flag", () => {
    const args = buildLaunchArgs("claude", { dangerouslySkipPermissions: true, extraFlags: "--mcp-config ./mcp.json" });
    expect(args).toEqual(["--dangerously-skip-permissions", "--mcp-config", "./mcp.json"]);
  });

  it("emits the bypass flag once when the user also typed it into extra flags", () => {
    const args = buildLaunchArgs("codex", {
      dangerouslySkipPermissions: true,
      extraFlags: "--dangerously-bypass-approvals-and-sandbox --model o3",
    });
    expect(args).toEqual(["--dangerously-bypass-approvals-and-sandbox", "--model", "o3"]);
  });

  it("does not dedupe ordinary repeated tokens", () => {
    const args = buildLaunchArgs("claude", { extraFlags: "--add-dir a --add-dir b" });
    expect(args).toEqual(["--add-dir", "a", "--add-dir", "b"]);
  });

  it("keeps a single-quoted value as one token", () => {
    const args = buildLaunchArgs("claude", { extraFlags: "--add-dir '/tmp/my dir'" });
    expect(args).toEqual(["--add-dir", "/tmp/my dir"]);
  });

  it("silently ignores malformed extra flags (unbalanced quote)", () => {
    const args = buildLaunchArgs("claude", { dangerouslySkipPermissions: true, extraFlags: "--add-dir 'oops" });
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

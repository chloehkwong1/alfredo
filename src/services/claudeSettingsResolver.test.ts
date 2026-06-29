import { describe, it, expect } from "vitest";
import { resolveSettings, buildClaudeArgs } from "./claudeSettingsResolver";

describe("resolveSettings extraFlags", () => {
  it("takes extraFlags from the global layer when repo has none", () => {
    const r = resolveSettings({ extraFlags: "--verbose-logs" }, undefined, undefined);
    expect(r.extraFlags).toBe("--verbose-logs");
  });

  it("lets the repo layer override the global extraFlags", () => {
    const r = resolveSettings({ extraFlags: "--global" }, { extraFlags: "--repo" }, undefined);
    expect(r.extraFlags).toBe("--repo");
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

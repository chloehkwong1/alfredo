import { describe, expect, it } from "vitest";
import { parseLaunchFlags } from "./launchCommand";

describe("parseLaunchFlags", () => {
  it("splits plain flags on whitespace", () => {
    expect(parseLaunchFlags("--continue --chrome")).toEqual({
      ok: true,
      args: ["--continue", "--chrome"],
    });
  });

  it("preserves a double-quoted value as one token", () => {
    expect(parseLaunchFlags('--append-system-prompt "be terse"')).toEqual({
      ok: true,
      args: ["--append-system-prompt", "be terse"],
    });
  });

  it("returns the double-quote error on an unbalanced double quote", () => {
    expect(parseLaunchFlags('--append-system-prompt "be terse')).toEqual({
      ok: false,
      error: 'Unbalanced quote — close the " to launch.',
    });
  });

  it("returns the single-quote error on an unbalanced single quote", () => {
    expect(parseLaunchFlags("--settings 'foo")).toEqual({
      ok: false,
      error: "Unbalanced quote — close the ' to launch.",
    });
  });

  it("treats empty input as a valid bare launch", () => {
    expect(parseLaunchFlags("")).toEqual({ ok: true, args: [] });
  });

  it("treats whitespace-only input as a valid bare launch", () => {
    expect(parseLaunchFlags("   \t  ")).toEqual({ ok: true, args: [] });
  });
});

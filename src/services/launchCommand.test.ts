import { describe, expect, it } from "vitest";
import { formatPrefill, parseLaunchFlags } from "./launchCommand";

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

describe("formatPrefill", () => {
  it("round-trips plain flags through parseLaunchFlags", () => {
    const args = ["--model", "opus-4-8"];
    const result = parseLaunchFlags(formatPrefill(args));
    expect(result).toEqual({ ok: true, args });
  });

  it("keeps a --settings JSON token intact across a round-trip", () => {
    const args = ["--settings", '{"outputStyle":"Explanatory"}'];
    const prefill = formatPrefill(args);
    // The JSON token must be single-quoted so parseLaunchFlags treats it as
    // literal and does not strip its embedded double-quotes.
    expect(prefill).toBe(`--settings '{"outputStyle":"Explanatory"}'`);
    expect(parseLaunchFlags(prefill)).toEqual({ ok: true, args });
  });
});

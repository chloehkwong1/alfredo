import { describe, it, expect } from "vitest";
import { claimOnce, compareVersions, decideWhatsNew, newestVersion } from "./useWhatsNew";
import type { WhatsNewEntry } from "../types";

const entry = (version: string): WhatsNewEntry => ({
  version,
  date: "2026-01-01",
  body: `- something in ${version}`,
});

const ENTRIES = [entry("0.20.0"), entry("0.19.0"), entry("0.18.0")];

describe("compareVersions", () => {
  it("compares numerically, not as strings", () => {
    expect(compareVersions("0.19.10", "0.19.9")).toBeGreaterThan(0);
    expect(compareVersions("0.20.0", "0.19.0")).toBeGreaterThan(0);
    expect(compareVersions("0.19.0", "0.19.0")).toBe(0);
    expect(compareVersions("0.18.0", "0.19.0")).toBeLessThan(0);
  });

  it("treats unparseable segments as 0", () => {
    expect(compareVersions("garbage", "0.0.0")).toBe(0);
  });
});

describe("newestVersion", () => {
  it("returns the highest version regardless of array order", () => {
    expect(newestVersion([entry("0.18.0"), entry("0.20.0")])).toBe("0.20.0");
  });

  it("returns null for an empty list", () => {
    expect(newestVersion([])).toBeNull();
  });
});

describe("decideWhatsNew", () => {
  it("hides when there are no entries", () => {
    const d = decideWhatsNew({ entries: [], lastSeen: null, repoCount: 3 });
    expect(d).toEqual({ show: false, entries: [], seedVersion: null });
  });

  it("hides and seeds the marker on a fresh install", () => {
    const d = decideWhatsNew({ entries: ENTRIES, lastSeen: null, repoCount: 0 });
    expect(d.show).toBe(false);
    expect(d.seedVersion).toBe("0.20.0");
  });

  it("shows every entry to an existing user with no marker yet", () => {
    const d = decideWhatsNew({ entries: ENTRIES, lastSeen: null, repoCount: 2 });
    expect(d.show).toBe(true);
    expect(d.entries).toHaveLength(3);
    expect(d.seedVersion).toBeNull();
  });

  it("shows only the versions missed since the marker", () => {
    const d = decideWhatsNew({ entries: ENTRIES, lastSeen: "0.18.0", repoCount: 2 });
    expect(d.show).toBe(true);
    expect(d.entries.map((e) => e.version)).toEqual(["0.20.0", "0.19.0"]);
  });

  it("hides when the marker is already at the newest entry (beta update)", () => {
    const d = decideWhatsNew({ entries: ENTRIES, lastSeen: "0.20.0", repoCount: 2 });
    expect(d.show).toBe(false);
    expect(d.seedVersion).toBeNull();
  });

  it("hides when the marker is ahead of every entry (downgrade)", () => {
    const d = decideWhatsNew({ entries: ENTRIES, lastSeen: "0.21.0", repoCount: 2 });
    expect(d.show).toBe(false);
  });
});

describe("claimOnce", () => {
  // Regression coverage for React StrictMode's synchronous double-invoke of
  // mount effects (setup -> cleanup -> setup): the phantom first invocation
  // is always cancelled before its async work settles, but its promise can
  // still resolve either before or after the surviving second invocation's.
  // Exactly one of the two must ever win the claim, regardless of order.

  it("lets the surviving (non-cancelled) invocation claim even if the cancelled phantom settles first", () => {
    const ref = { current: false };
    expect(claimOnce(ref, true)).toBe(false); // phantom invocation settles first, cancelled
    expect(claimOnce(ref, false)).toBe(true); // surviving invocation settles second, claims
    expect(ref.current).toBe(true);
  });

  it("lets the surviving invocation claim even if it settles before the cancelled phantom", () => {
    const ref = { current: false };
    expect(claimOnce(ref, false)).toBe(true); // surviving invocation settles first, claims
    expect(claimOnce(ref, true)).toBe(false); // phantom invocation settles second, cancelled anyway
    expect(ref.current).toBe(true);
  });

  it("never lets a second invocation claim once the ref is already claimed", () => {
    const ref = { current: false };
    expect(claimOnce(ref, false)).toBe(true);
    expect(claimOnce(ref, false)).toBe(false);
  });

  it("does not claim when cancelled, leaving the ref open for a later invocation", () => {
    const ref = { current: false };
    expect(claimOnce(ref, true)).toBe(false);
    expect(ref.current).toBe(false);
  });
});

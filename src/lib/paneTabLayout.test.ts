import { describe, it, expect } from "vitest";
import { pinnedAgentTab, tabSwitchTarget, isSessionTab, partitionPaneTabs, displayCycleOrder, effectiveTabLabel, shouldSpill } from "./paneTabLayout";
import type { WorkspaceTab, TabType } from "../types";

function tab(id: string, type: TabType): WorkspaceTab {
  return { id, type, label: id } as WorkspaceTab;
}

describe("pinnedAgentTab", () => {
  it("prefers the active tab when it is an agent", () => {
    const tabs = [tab("a1", "claude"), tab("a2", "codex")];
    expect(pinnedAgentTab(tabs, "a2", undefined)?.id).toBe("a2");
  });

  it("falls back to the last-focused agent when active is not an agent", () => {
    const tabs = [tab("a1", "claude"), tab("d", "diff")];
    expect(pinnedAgentTab(tabs, "d", "a1")?.id).toBe("a1");
  });

  it("falls back to the first agent when no active/last-focused agent", () => {
    const tabs = [tab("d", "diff"), tab("a1", "claude")];
    expect(pinnedAgentTab(tabs, "d", undefined)?.id).toBe("a1");
  });

  it("returns undefined when there is no agent tab", () => {
    const tabs = [tab("d", "diff"), tab("n", "notes")];
    expect(pinnedAgentTab(tabs, "d", undefined)).toBeUndefined();
  });
});

describe("tabSwitchTarget", () => {
  it("from an agent -> the last-focused non-agent (else first non-agent)", () => {
    const tabs = [tab("a1", "claude"), tab("sh", "shell"), tab("d", "diff")];
    expect(tabSwitchTarget(tabs, "a1", undefined, "d")).toBe("d");      // remembered non-agent
    expect(tabSwitchTarget(tabs, "a1", undefined, undefined)).toBe("sh"); // else first non-agent
  });

  it("from a non-agent -> the active/last agent", () => {
    const tabs = [tab("a1", "claude"), tab("d", "diff")];
    expect(tabSwitchTarget(tabs, "d", "a1", undefined)).toBe("a1");
  });

  it("from a terminal -> the agent", () => {
    const tabs = [tab("sh", "shell"), tab("a1", "codex"), tab("d", "diff")];
    expect(tabSwitchTarget(tabs, "sh", undefined, undefined)).toBe("a1");
  });

  it("returns undefined from an agent when there is no non-agent", () => {
    const tabs = [tab("a1", "claude"), tab("a2", "codex")];
    expect(tabSwitchTarget(tabs, "a1", undefined, undefined)).toBeUndefined();
  });

  it("from an agent -> skips the pinned Notes anchor (which sorts first)", () => {
    // Notes is leftmost (it is pinned to the front of the pane).
    const tabs = [
      tab("n", "notes"),
      tab("a1", "claude"),
      tab("sh", "shell"),
      tab("d", "diff"),
    ];
    // No remembered tab -> first *working* tab, never Notes.
    expect(tabSwitchTarget(tabs, "a1", undefined, undefined)).toBe("sh");
    // A stale remembered Notes id is ignored -> falls back to first working tab.
    expect(tabSwitchTarget(tabs, "a1", undefined, "n")).toBe("sh");
    // A remembered diff is still honoured (diffs are valid targets).
    expect(tabSwitchTarget(tabs, "a1", undefined, "d")).toBe("d");
  });

  it("returns undefined from an agent when Notes is the only non-agent tab", () => {
    const tabs = [tab("n", "notes"), tab("a1", "claude")];
    expect(tabSwitchTarget(tabs, "a1", undefined, undefined)).toBeUndefined();
    expect(tabSwitchTarget(tabs, "a1", undefined, "n")).toBeUndefined();
  });
});

describe("partitionPaneTabs", () => {
  it("splits into notes (single), sessions (agent/terminal/server), and diffs — preserving order", () => {
    const tabs = [
      tab("n", "notes"),
      tab("a1", "claude"),
      tab("d1", "diff"),
      tab("sh", "shell"),
      tab("sv", "server"),
      tab("d2", "diff"),
    ];
    const { notes, agents, terminals, diffs } = partitionPaneTabs(tabs);
    expect(notes?.id).toBe("n");
    expect(agents.map((t) => t.id)).toEqual(["a1"]);
    expect(terminals.map((t) => t.id)).toEqual(["sh", "sv"]);
    expect(diffs.map((t) => t.id)).toEqual(["d1", "d2"]);
  });

  it("notes is undefined when absent; isSessionTab excludes diff and notes", () => {
    expect(partitionPaneTabs([tab("d", "diff")]).notes).toBeUndefined();
    expect(isSessionTab(tab("a1", "claude"))).toBe(true);
    expect(isSessionTab(tab("sv", "server"))).toBe(true);
    expect(isSessionTab(tab("d", "diff"))).toBe(false);
    expect(isSessionTab(tab("n", "notes"))).toBe(false);
  });
});

describe("displayCycleOrder", () => {
  it("orders agents, then terminals, then diffs; excludes notes; keeps tabIds order within groups", () => {
    const tabs = [
      tab("n", "notes"), tab("sh", "shell"), tab("a1", "claude"),
      tab("d1", "diff"), tab("a2", "codex"), tab("sv", "server"),
    ];
    const tabIds = ["n", "sh", "a1", "d1", "a2", "sv"];
    expect(displayCycleOrder(tabs, tabIds)).toEqual(["a1", "a2", "sh", "sv", "d1"]);
  });

  it("ignores tabIds with no matching tab", () => {
    const tabs = [tab("a1", "claude")];
    expect(displayCycleOrder(tabs, ["a1", "ghost"])).toEqual(["a1"]);
  });
});

describe("effectiveTabLabel", () => {
  it("customLabel beats dynamicLabel beats label", () => {
    expect(
      effectiveTabLabel({ customLabel: "api fix", dynamicLabel: "✱ doing stuff", label: "Claude" }),
    ).toBe("api fix");
    expect(effectiveTabLabel({ dynamicLabel: "✱ doing stuff", label: "Claude" })).toBe("✱ doing stuff");
    expect(effectiveTabLabel({ dynamicLabel: null, label: "Claude" })).toBe("Claude");
    expect(effectiveTabLabel({ label: "Terminal" })).toBe("Terminal");
  });
});

describe("shouldSpill", () => {
  it("not spilled: spills only below 140px per tab", () => {
    expect(shouldSpill(840, 6, false)).toBe(false); // exactly 140 — stays merged
    expect(shouldSpill(839, 6, false)).toBe(true);  // just under — spills
  });

  it("spilled: rejoins only at ≥170px per tab (hysteresis)", () => {
    expect(shouldSpill(1019, 6, true)).toBe(true);  // ~169.8 — stays spilled
    expect(shouldSpill(1020, 6, true)).toBe(false); // exactly 170 — rejoins
  });

  it("never spills with zero sessions", () => {
    expect(shouldSpill(0, 0, false)).toBe(false);
    expect(shouldSpill(0, 0, true)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { pinnedAgentTab, partitionFlatTabs, tabSwitchTarget } from "./paneTabLayout";
import { splitByWidth } from "./paneTabLayout";
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

describe("partitionFlatTabs", () => {
  it("pins agent then diff, rest preserves order and excludes pinned", () => {
    const tabs = [tab("a1", "claude"), tab("sh", "shell"), tab("d", "diff"), tab("n", "notes")];
    const { pinned, rest } = partitionFlatTabs(tabs, "a1", undefined);
    expect(pinned.map((t) => t.id)).toEqual(["a1", "d"]);
    expect(rest.map((t) => t.id)).toEqual(["sh", "n"]);
  });

  it("pins only diff when no agent present", () => {
    const tabs = [tab("d", "diff"), tab("sh", "shell")];
    const { pinned, rest } = partitionFlatTabs(tabs, "d", undefined);
    expect(pinned.map((t) => t.id)).toEqual(["d"]);
    expect(rest.map((t) => t.id)).toEqual(["sh"]);
  });

  it("pins only agent when no diff present", () => {
    const tabs = [tab("a1", "claude"), tab("sh", "shell")];
    const { pinned, rest } = partitionFlatTabs(tabs, "a1", undefined);
    expect(pinned.map((t) => t.id)).toEqual(["a1"]);
    expect(rest.map((t) => t.id)).toEqual(["sh"]);
  });

  it("returns empty pinned and full rest when neither present", () => {
    const tabs = [tab("sh", "shell"), tab("n", "notes")];
    const { pinned, rest } = partitionFlatTabs(tabs, "sh", undefined);
    expect(pinned).toEqual([]);
    expect(rest.map((t) => t.id)).toEqual(["sh", "n"]);
  });
});

describe("splitByWidth", () => {
  it("shows all when every tab fits", () => {
    const tabs = [tab("a", "shell"), tab("b", "notes")];
    const { visible, overflow } = splitByWidth(tabs, [100, 100], 500);
    expect(visible.map((t) => t.id)).toEqual(["a", "b"]);
    expect(overflow).toEqual([]);
  });

  it("overflows the tabs that do not fit, reserving room for the trigger", () => {
    const tabs = [tab("a", "shell"), tab("b", "notes"), tab("c", "shell")];
    // widths 100 each, container 250, trigger reserve 40 -> fits 2
    const { visible, overflow } = splitByWidth(tabs, [100, 100, 100], 250, 40);
    expect(visible.map((t) => t.id)).toEqual(["a", "b"]);
    expect(overflow.map((t) => t.id)).toEqual(["c"]);
  });

  it("keeps at least one visible even if it technically does not fit", () => {
    const tabs = [tab("a", "shell"), tab("b", "notes")];
    const { visible, overflow } = splitByWidth(tabs, [400, 400], 100, 40);
    expect(visible.map((t) => t.id)).toEqual(["a"]);
    expect(overflow.map((t) => t.id)).toEqual(["b"]);
  });

  it("no overflow trigger reserve when nothing overflows", () => {
    const tabs = [tab("a", "shell")];
    const { visible, overflow } = splitByWidth(tabs, [90], 100, 40);
    expect(visible.map((t) => t.id)).toEqual(["a"]);
    expect(overflow).toEqual([]);
  });
});

describe("tabSwitchTarget", () => {
  it("from an agent -> the diff tab", () => {
    const tabs = [tab("a1", "claude"), tab("d", "diff")];
    expect(tabSwitchTarget(tabs, "a1", undefined)).toBe("d");
  });

  it("from diff -> the active/last agent", () => {
    const tabs = [tab("a1", "claude"), tab("d", "diff")];
    expect(tabSwitchTarget(tabs, "d", "a1")).toBe("a1");
  });

  it("from a terminal -> the agent", () => {
    const tabs = [tab("sh", "shell"), tab("a1", "codex"), tab("d", "diff")];
    expect(tabSwitchTarget(tabs, "sh", undefined)).toBe("a1");
  });

  it("returns undefined from an agent when no diff exists", () => {
    const tabs = [tab("a1", "claude"), tab("sh", "shell")];
    expect(tabSwitchTarget(tabs, "a1", undefined)).toBeUndefined();
  });
});

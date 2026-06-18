import { describe, it, expect } from "vitest";
import { pinnedAgentTab, partitionFlatTabs } from "./paneTabLayout";
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

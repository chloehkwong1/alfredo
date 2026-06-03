import { describe, it, expect } from "vitest";
import {
  GROUP_ORDER,
  GROUP_LABELS,
  getGroupForTab,
  getTabsInGroup,
  getActiveGroup,
} from "./tabGroups";
import type { WorkspaceTab } from "../types";

function tab(id: string, type: WorkspaceTab["type"]): WorkspaceTab {
  return { id, type, label: id };
}

describe("tabGroups", () => {
  describe("getGroupForTab", () => {
    it("maps agent tab types to 'agents'", () => {
      expect(getGroupForTab(tab("a", "claude"))).toBe("agents");
      expect(getGroupForTab(tab("a", "codex"))).toBe("agents");
      expect(getGroupForTab(tab("a", "gemini"))).toBe("agents");
    });
    it("maps shell to 'terminals'", () => {
      expect(getGroupForTab(tab("a", "shell"))).toBe("terminals");
    });
    it("maps server to 'server'", () => {
      expect(getGroupForTab(tab("a", "server"))).toBe("server");
    });
    it("maps diff to 'files'", () => {
      expect(getGroupForTab(tab("a", "diff"))).toBe("files");
    });
    it("returns null for notes (pinned, not in a group)", () => {
      expect(getGroupForTab(tab("a", "notes"))).toBeNull();
    });
  });

  describe("getTabsInGroup", () => {
    it("returns only tabs whose type maps to the requested group", () => {
      const tabs: WorkspaceTab[] = [
        tab("n", "notes"),
        tab("c1", "claude"),
        tab("c2", "codex"),
        tab("s1", "shell"),
        tab("srv", "server"),
        tab("d", "diff"),
      ];
      expect(getTabsInGroup(tabs, "agents").map((t) => t.id)).toEqual(["c1", "c2"]);
      expect(getTabsInGroup(tabs, "terminals").map((t) => t.id)).toEqual(["s1"]);
      expect(getTabsInGroup(tabs, "server").map((t) => t.id)).toEqual(["srv"]);
      expect(getTabsInGroup(tabs, "files").map((t) => t.id)).toEqual(["d"]);
    });
    it("excludes notes from every group", () => {
      const tabs = [tab("n", "notes")];
      for (const g of GROUP_ORDER) {
        expect(getTabsInGroup(tabs, g)).toEqual([]);
      }
    });
  });

  describe("getActiveGroup", () => {
    it("returns the group of the tab whose id matches activeTabId", () => {
      const tabs: WorkspaceTab[] = [tab("c1", "claude"), tab("s1", "shell")];
      expect(getActiveGroup("c1", tabs)).toBe("agents");
      expect(getActiveGroup("s1", tabs)).toBe("terminals");
    });
    it("returns 'agents' as the fallback when the active tab is notes or missing", () => {
      const tabs: WorkspaceTab[] = [tab("n", "notes"), tab("c1", "claude")];
      expect(getActiveGroup("n", tabs)).toBe("agents");
      expect(getActiveGroup("missing", tabs)).toBe("agents");
    });
    it("returns 'agents' as the fallback when there are no non-notes tabs", () => {
      expect(getActiveGroup("n", [tab("n", "notes")])).toBe("agents");
    });
  });

  describe("constants", () => {
    it("GROUP_ORDER is exactly the four groups in render order", () => {
      expect(GROUP_ORDER).toEqual(["agents", "terminals", "server", "files"]);
    });
    it("GROUP_LABELS has a label for every group", () => {
      for (const g of GROUP_ORDER) {
        expect(typeof GROUP_LABELS[g]).toBe("string");
        expect(GROUP_LABELS[g].length).toBeGreaterThan(0);
      }
    });
  });
});

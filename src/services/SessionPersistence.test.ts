import { describe, it, expect } from "vitest";
import { applyResumeSidecar } from "./SessionPersistence";
import type { WorkspaceTab } from "../types";

describe("applyResumeSidecar", () => {
  it("overrides a tab's resumeSessionId with the fresher sidecar id", () => {
    const tabs: WorkspaceTab[] = [
      { id: "wt:claude:1", type: "claude", label: "Claude", resumeSessionId: "old-blob-id" },
    ];
    applyResumeSidecar(tabs, { "wt:claude:1": "fresh-sidecar-id" });
    expect(tabs[0].resumeSessionId).toBe("fresh-sidecar-id");
  });

  it("fills in a resumeSessionId the blob never had", () => {
    const tabs: WorkspaceTab[] = [
      { id: "wt:claude:1", type: "claude", label: "Claude" },
    ];
    applyResumeSidecar(tabs, { "wt:claude:1": "sidecar-only-id" });
    expect(tabs[0].resumeSessionId).toBe("sidecar-only-id");
  });

  it("leaves the blob id when the sidecar has no entry for that tab", () => {
    const tabs: WorkspaceTab[] = [
      { id: "wt:claude:1", type: "claude", label: "Claude", resumeSessionId: "blob-id" },
    ];
    applyResumeSidecar(tabs, {});
    expect(tabs[0].resumeSessionId).toBe("blob-id");
  });

  it("ignores sidecar entries for tabs that no longer exist", () => {
    const tabs: WorkspaceTab[] = [
      { id: "wt:claude:1", type: "claude", label: "Claude" },
    ];
    applyResumeSidecar(tabs, { "wt:claude:GONE": "stale" });
    expect(tabs[0].resumeSessionId).toBeUndefined();
  });
});

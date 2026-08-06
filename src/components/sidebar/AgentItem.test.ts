import { describe, it, expect } from "vitest";
import { computeEffectiveStatus } from "./AgentItem";
import { nativeStackChipLabel } from "./StackGlyph";
import { hiddenMembersNote } from "./StackMapPopover";
import type { PrStatus } from "../../types";

describe("computeEffectiveStatus", () => {
  it("returns busy when agent is busy and not stale", () => {
    expect(computeEffectiveStatus("busy", true, false, true)).toBe("busy");
  });

  it("returns stale when agent is busy and staleBusy is true", () => {
    expect(computeEffectiveStatus("busy", true, true, true)).toBe("stale");
  });

  it("returns done when agent is idle and not seen", () => {
    expect(computeEffectiveStatus("idle", true, false, false)).toBe("done");
  });

  it("returns idle when agent is idle and seen", () => {
    expect(computeEffectiveStatus("idle", true, false, true)).toBe("idle");
  });

  it("returns disconnected when channel dead and agent not notRunning", () => {
    expect(computeEffectiveStatus("busy", false, false, true)).toBe("disconnected");
  });

  it("returns notRunning when channel dead but agent is notRunning", () => {
    expect(computeEffectiveStatus("notRunning", false, false, true)).toBe("notRunning");
  });

  it("returns waitingForInput when agent is waiting", () => {
    expect(computeEffectiveStatus("waitingForInput", true, false, true)).toBe("waitingForInput");
  });

  it("returns disconnected for waitingForInput when channel dead", () => {
    expect(computeEffectiveStatus("waitingForInput", false, false, true)).toBe("disconnected");
  });

  it("returns stale over disconnected (channel alive + stale busy)", () => {
    expect(computeEffectiveStatus("busy", true, true, false)).toBe("stale");
  });

  it("returns settingUp during background setup while no agent is running", () => {
    expect(computeEffectiveStatus("notRunning", true, false, true, false, true)).toBe("settingUp");
  });

  it("surfaces waitingForInput over settingUp when an agent is live during setup", () => {
    expect(computeEffectiveStatus("waitingForInput", true, false, true, false, true)).toBe("waitingForInput");
  });

  it("surfaces a busy agent over settingUp during background setup", () => {
    expect(computeEffectiveStatus("busy", true, false, true, false, true)).toBe("busy");
  });
});

// NativeStackChip renders exactly when this label is non-null, and the label
// is its visible text — pinning the "chip for native members, absent
// otherwise" contract without a component render.
describe("nativeStackChipLabel", () => {
  const basePr: PrStatus = {
    number: 7,
    state: "open",
    title: "Add thing",
    url: "https://github.com/x/y/pull/7",
    draft: false,
    merged: false,
    branch: "feature-1",
  };

  it("returns position/size for a native GitHub Stack member", () => {
    const pr: PrStatus = {
      ...basePr,
      nativeStack: { id: "S1", number: 42, position: 2, size: 3, members: [] },
    };
    expect(nativeStackChipLabel(pr)).toBe("2/3");
  });

  it("returns null when the PR is not a native stack member", () => {
    expect(nativeStackChipLabel(basePr)).toBeNull();
    expect(nativeStackChipLabel({ ...basePr, nativeStack: null })).toBeNull();
  });

  it("returns null when there is no PR at all", () => {
    expect(nativeStackChipLabel(null)).toBeNull();
    expect(nativeStackChipLabel(undefined)).toBeNull();
  });
});

// The backend's native-stack query returns OPEN PRs only, so merged/closed
// members drop out of the roster while `size` still counts them. This note is
// what keeps the "Stack #N · {size} PRs" header honest against a shorter list.
describe("hiddenMembersNote", () => {
  it("returns null when every member is present", () => {
    expect(hiddenMembersNote(3, 3)).toBeNull();
  });

  it("counts a single missing member in the singular", () => {
    expect(hiddenMembersNote(3, 2)).toBe("1 merged or closed PR not shown");
  });

  it("counts multiple missing members in the plural", () => {
    expect(hiddenMembersNote(5, 2)).toBe("3 merged or closed PRs not shown");
  });

  it("stays null if the roster somehow exceeds the recorded size", () => {
    expect(hiddenMembersNote(2, 3)).toBeNull();
  });
});

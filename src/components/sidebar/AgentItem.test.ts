import { describe, it, expect } from "vitest";
import { computeEffectiveStatus } from "./AgentItem";
import { nativeStackChipLabel } from "./StackGlyph";
import { hiddenMembersNote, restackOutcomeMessage, stackSyncMessage, originCue } from "./StackMapPopover";
import type { RestackStackSummary } from "../../api";
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

// The toast after a manual restack must describe what the backend actually
// did — "Restacked ✓" on a real rebase only, never on a dirty-skip or no-op.
describe("restackOutcomeMessage", () => {
  it("celebrates only an actual rebase", () => {
    expect(restackOutcomeMessage("rebased", "feat/x")).toBe("Restacked feat/x ✓");
  });

  it("reports a no-op as already up to date", () => {
    expect(restackOutcomeMessage("alreadyUpToDate", "feat/x")).toBe("feat/x is already up to date");
  });

  it("says why a dirty tree paused the restack", () => {
    expect(restackOutcomeMessage("skippedDirty", "feat/x")).toBe(
      "Restack paused — uncommitted changes in feat/x",
    );
  });

  it("distinguishes an in-progress rebase from uncommitted changes", () => {
    expect(restackOutcomeMessage("skippedRebaseInProgress", "feat/x")).toBe(
      "Restack paused — conflict resolution in progress in feat/x",
    );
  });

  it("reports an unknown wire string verbatim instead of guessing a meaning", () => {
    expect(restackOutcomeMessage("refusedStaleBaseline" as never, "feat/x")).toBe(
      "Restack finished: refusedStaleBaseline",
    );
  });
});

// The whole-stack sync toast reads the backend summary — `restack_stack`
// resolves Ok even when members were dirty-skipped or there was nothing to
// sync, so "✓" is earned only when neither happened.
function makeSummary(over: Partial<RestackStackSummary>): RestackStackSummary {
  return { skippedDirty: [], rebaseInProgress: [], noStack: false, rootSkipReason: null, errors: [], ...over };
}

describe("stackSyncMessage", () => {
  it("celebrates a clean sync", () => {
    expect(stackSyncMessage(makeSummary({}), "Stack synced with main")).toBe(
      "Stack synced with main ✓",
    );
  });

  it("reports member failures WITH the caveats gathered before them, never a bare success", () => {
    const summary = makeSummary({
      skippedDirty: ["feat/a"],
      errors: ["feat/b: rebase exploded"],
    });
    expect(stackSyncMessage(summary, "Stack synced with main")).toBe(
      "Stack sync incomplete — feat/a paused (uncommitted changes); failed — feat/b: rebase exploded",
    );
  });

  it("names a single dirty-skipped branch", () => {
    expect(stackSyncMessage(makeSummary({ skippedDirty: ["feat/x"] }), "Stack synced with main")).toBe(
      "Stack synced with main — feat/x paused (uncommitted changes)",
    );
  });

  it("counts multiple dirty-skipped branches", () => {
    expect(
      stackSyncMessage(makeSummary({ skippedDirty: ["feat/x", "feat/y"] }), "Stack synced with main"),
    ).toBe("Stack synced with main — 2 branches paused (uncommitted changes)");
  });

  it("says so when there was nothing to sync", () => {
    expect(stackSyncMessage(makeSummary({ noStack: true }), "Stack synced with main")).toBe(
      "Nothing to sync — no stacked branches",
    );
  });

  // Regression coverage for fix H: a rebase-in-progress skip must not read as
  // "uncommitted changes" in the whole-stack toast either.
  it("distinguishes a rebase-in-progress branch from a dirty one", () => {
    expect(
      stackSyncMessage(makeSummary({ rebaseInProgress: ["feat/x"] }), "Stack synced with main"),
    ).toBe("Stack synced with main — feat/x paused (conflict resolution in progress)");
  });

  // Regression coverage for fix I: a root skip whose state is unknown (not the
  // benign "already synced" case) must not be silently folded into "✓".
  it("surfaces an unknown root-skip reason as a caveat instead of a bare ✓", () => {
    expect(
      stackSyncMessage(
        makeSummary({ rootSkipReason: "default branch has no remote-tracking ref" }),
        "Stack synced with main",
      ),
    ).toBe("Stack synced with main — root skipped: default branch has no remote-tracking ref");
  });
});

// Popover cue for local commits origin doesn't have. Counted when origin is a
// strict ancestor; uncounted "diverged from origin" when both ahead and
// behind — that shape has two causes (a local rewrite, or origin gaining a
// teammate's commits on a shared branch) we can't cheaply distinguish, so the
// label stays neutral instead of prescribing force-push; silent otherwise.
describe("originCue", () => {
  it("is null when in sync, unpublished, or only behind", () => {
    expect(originCue([0, 0])).toBeNull();
    expect(originCue(null)).toBeNull();
    expect(originCue(undefined)).toBeNull();
    expect(originCue([0, 4])).toBeNull();
  });

  it("counts commits to push on a fast-forwardable branch", () => {
    expect(originCue([2, 0])).toBe("2 to push");
  });

  it("flags a diverged branch neutrally, uncounted", () => {
    expect(originCue([8, 8])).toBe("diverged from origin");
  });
});

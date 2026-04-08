import { describe, it, expect } from "vitest";
import { computeEffectiveStatus, DONE_SETTLE_MS } from "./AgentItem";

describe("computeEffectiveStatus", () => {
  it("returns busy when agent is busy and not stale", () => {
    expect(computeEffectiveStatus("busy", true, false, true)).toBe("busy");
  });

  it("returns stale when agent is busy and staleBusy is true", () => {
    expect(computeEffectiveStatus("busy", true, true, true)).toBe("stale");
  });

  it("returns done when agent is idle, not seen, and settled", () => {
    const settledIdleSince = Date.now() - DONE_SETTLE_MS - 1000;
    expect(computeEffectiveStatus("idle", true, false, false, false, settledIdleSince)).toBe("done");
  });

  it("returns idle when agent is idle, not seen, but not yet settled", () => {
    const recentIdleSince = Date.now();
    expect(computeEffectiveStatus("idle", true, false, false, false, recentIdleSince)).toBe("idle");
  });

  it("returns done when agent is idle, not seen, and no idleSince (legacy)", () => {
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
});

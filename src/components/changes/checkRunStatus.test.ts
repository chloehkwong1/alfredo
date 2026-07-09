import { describe, it, expect } from "vitest";
import type { CheckRun } from "../../types";
import { isCheckFailing, isCheckPassing, isCheckPending } from "./checkRunStatus";

function checkRun(status: string, conclusion: string | null): CheckRun {
  return { id: 1, name: "ci", status, conclusion, htmlUrl: "", startedAt: null, completedAt: null };
}

describe("checkRunStatus", () => {
  it("treats only success/skipped/neutral as passing", () => {
    for (const c of ["success", "skipped", "neutral"]) {
      const run = checkRun("completed", c);
      expect(isCheckPassing(run)).toBe(true);
      expect(isCheckFailing(run)).toBe(false);
      expect(isCheckPending(run)).toBe(false);
    }
  });

  it("treats every other completed conclusion as failing (fail-safe)", () => {
    // cancelled is issue #52; some_new_conclusion guards against a conclusion
    // GitHub adds later slipping through as a silent pass.
    for (const c of ["failure", "timed_out", "action_required", "cancelled", "stale", "some_new_conclusion"]) {
      const run = checkRun("completed", c);
      expect(isCheckFailing(run)).toBe(true);
      expect(isCheckPassing(run)).toBe(false);
    }
  });

  it("treats not-yet-completed runs as pending, not failing", () => {
    const run = checkRun("in_progress", null);
    expect(isCheckPending(run)).toBe(true);
    expect(isCheckFailing(run)).toBe(false);
    expect(isCheckPassing(run)).toBe(false);
  });

  it("does not count a completed run with a null conclusion as failing", () => {
    expect(isCheckFailing(checkRun("completed", null))).toBe(false);
  });
});

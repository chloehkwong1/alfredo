import type { CheckRun } from "../../types";

// GitHub satisfies a required status check only when its conclusion is one of
// these. Mirrors the Rust rollup in github_sync.rs (`check_run_is_failing`) so
// the sidebar "N failing" chip and the PR panel agree. Any other completed
// conclusion — failure, timed_out, action_required, cancelled, stale, or one
// GitHub adds later — is treated as failing rather than a silent "pass".
const PASSING_CONCLUSIONS = new Set(["success", "skipped", "neutral"]);

export function isCheckFailing(run: CheckRun): boolean {
  return run.status === "completed" && run.conclusion !== null && !PASSING_CONCLUSIONS.has(run.conclusion);
}

export function isCheckPending(run: CheckRun): boolean {
  return run.status !== "completed";
}

export function isCheckPassing(run: CheckRun): boolean {
  return !isCheckPending(run) && !isCheckFailing(run);
}

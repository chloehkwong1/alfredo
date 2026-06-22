import { invoke } from "@tauri-apps/api/core";

/** Mirrors Rust `OpenIssueRequest` (serde camelCase). */
export interface OpenIssueRequest {
  workdir: string;
  branch: string;
  prompt: string;
  issueId: string | null;
  project: string | null;
  matchedRepoPath: string | null;
}

/** Drain the cold-start buffer (returns null when empty). */
export function takePendingOpenIssue(): Promise<OpenIssueRequest | null> {
  return invoke("take_pending_open_issue");
}

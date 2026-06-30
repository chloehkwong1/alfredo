import type { ClaudeDefaults, ClaudeOverrides, GlobalAppConfig } from "../types";
import { parseLaunchFlags } from "./launchCommand";

export interface ResolvedClaudeSettings {
  model?: string;
  effort?: string;
  permissionMode?: string;
  dangerouslySkipPermissions?: boolean;
  outputStyle?: string;
  verbose?: boolean;
  extraFlags?: string;
}

/**
 * Merge global app defaults → per-repo defaults → per-branch overrides.
 * Each layer overrides the previous; only defined fields are merged.
 */
export function resolveSettings(
  globalDefaults?: Pick<GlobalAppConfig, "model" | "effort" | "permissionMode" | "dangerouslySkipPermissions" | "outputStyle" | "verbose" | "extraFlags"> | null,
  repoDefaults?: ClaudeDefaults,
  overrides?: ClaudeOverrides,
): ResolvedClaudeSettings {
  // For free-form text fields, treat blank/whitespace-only as absent so a
  // hand-edited empty alfredo.json value doesn't silently shadow the global.
  const cleanFlags = (v?: string | null) => (v && v.trim() ? v : undefined);
  return {
    model: overrides?.model ?? repoDefaults?.model ?? globalDefaults?.model ?? undefined,
    effort: overrides?.effort ?? repoDefaults?.effort ?? globalDefaults?.effort ?? undefined,
    permissionMode: overrides?.permissionMode ?? repoDefaults?.permissionMode ?? globalDefaults?.permissionMode ?? undefined,
    dangerouslySkipPermissions: repoDefaults?.dangerouslySkipPermissions ?? globalDefaults?.dangerouslySkipPermissions ?? undefined,
    outputStyle: overrides?.outputStyle ?? repoDefaults?.outputStyle ?? globalDefaults?.outputStyle ?? undefined,
    verbose: repoDefaults?.verbose ?? globalDefaults?.verbose ?? undefined,
    extraFlags: cleanFlags(repoDefaults?.extraFlags) ?? cleanFlags(globalDefaults?.extraFlags),
  };
}

/**
 * Reconcile a restored tab's own session with any session-selection flag the
 * user put in extra flags: strip `--resume`/`--resume=<id>`/`--continue` (the
 * tab's own session must win on restore), then append `--resume <sessionId>`.
 *
 * Only call this on the restored-tab path (when `claudeSessionId` is set).
 * For non-restored tabs, leave extra flags untouched.
 */
export function withResumeSession(args: string[], sessionId: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--resume") { i++; continue; }       // skip flag AND its value token
    if (a.startsWith("--resume=")) continue;         // single-token equals form
    if (a === "--continue") continue;
    out.push(a);
  }
  out.push("--resume", sessionId);
  return out;
}

/**
 * Convert resolved settings to an array of CLI flags for claude.
 */
export function buildClaudeArgs(settings: ResolvedClaudeSettings): string[] {
  const args: string[] = [];

  if (settings.model) {
    args.push("--model", settings.model);
  }
  if (settings.effort) {
    args.push("--effort", settings.effort);
  }
  if (settings.permissionMode && settings.permissionMode !== "default") {
    if (settings.permissionMode === "bypassPermissions") {
      args.push("--dangerously-skip-permissions");
    } else {
      args.push("--permission-mode", settings.permissionMode);
    }
  }
  if (settings.outputStyle && settings.outputStyle !== "Default") {
    args.push("--settings", JSON.stringify({ outputStyle: settings.outputStyle }));
  }
  if (settings.verbose) {
    args.push("--verbose");
  }
  if (settings.extraFlags) {
    const parsed = parseLaunchFlags(settings.extraFlags);
    if (parsed.ok) args.push(...parsed.args);
  }

  return args;
}

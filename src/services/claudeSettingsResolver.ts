import type { ClaudeDefaults, ClaudeOverrides, GlobalAppConfig } from "../types";

export interface ResolvedClaudeSettings {
  model?: string;
  effort?: string;
  permissionMode?: string;
  dangerouslySkipPermissions?: boolean;
  outputStyle?: string;
  verbose?: boolean;
}

/**
 * Merge global app defaults → per-repo defaults → per-branch overrides.
 * Each layer overrides the previous; only defined fields are merged.
 */
export function resolveSettings(
  globalDefaults?: Pick<GlobalAppConfig, "model" | "effort" | "permissionMode" | "dangerouslySkipPermissions" | "outputStyle" | "verbose"> | null,
  repoDefaults?: ClaudeDefaults,
  overrides?: ClaudeOverrides,
): ResolvedClaudeSettings {
  return {
    model: overrides?.model ?? repoDefaults?.model ?? globalDefaults?.model ?? undefined,
    effort: overrides?.effort ?? repoDefaults?.effort ?? globalDefaults?.effort ?? undefined,
    permissionMode: overrides?.permissionMode ?? repoDefaults?.permissionMode ?? globalDefaults?.permissionMode ?? undefined,
    dangerouslySkipPermissions: repoDefaults?.dangerouslySkipPermissions ?? globalDefaults?.dangerouslySkipPermissions ?? undefined,
    outputStyle: overrides?.outputStyle ?? repoDefaults?.outputStyle ?? globalDefaults?.outputStyle ?? undefined,
    verbose: repoDefaults?.verbose ?? globalDefaults?.verbose ?? undefined,
  };
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

  return args;
}

import type { ClaudeDefaults, ClaudeOverrides } from "../types";

export interface ResolvedClaudeSettings {
  model?: string;
  effort?: string;
  permissionMode?: string;
  dangerouslySkipPermissions?: boolean;
  outputStyle?: string;
  verbose?: boolean;
}

/**
 * Merge global defaults with per-branch overrides.
 * Override fields take precedence; only defined fields are merged.
 */
export function resolveSettings(
  defaults?: ClaudeDefaults,
  overrides?: ClaudeOverrides,
): ResolvedClaudeSettings {
  return {
    model: overrides?.model ?? defaults?.model,
    effort: overrides?.effort ?? defaults?.effort,
    permissionMode: overrides?.permissionMode ?? defaults?.permissionMode,
    dangerouslySkipPermissions: defaults?.dangerouslySkipPermissions,
    outputStyle: overrides?.outputStyle ?? defaults?.outputStyle,
    verbose: defaults?.verbose,
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
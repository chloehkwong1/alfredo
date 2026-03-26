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
 * Note: outputStyle requires a temp settings file — call buildOutputStyleFileContent()
 * separately and pass the path via --settings. This function handles all other flags.
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
    args.push("--permission-mode", settings.permissionMode);
  }
  if (settings.dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions");
  }
  if (settings.verbose) {
    args.push("--verbose");
  }

  return args;
}

/**
 * If outputStyle is set and not "Default", returns the JSON content for a
 * temporary settings file. The caller is responsible for writing this to disk
 * and appending `--settings <path>` to the args array.
 *
 * Returns null if no settings file is needed.
 *
 * TODO: Not yet wired — needs Tauri command to write temp file.
 */
export function buildOutputStyleFileContent(
  settings: ResolvedClaudeSettings,
): string | null {
  if (!settings.outputStyle || settings.outputStyle === "Default") return null;
  return JSON.stringify({ outputStyle: settings.outputStyle }, null, 2);
}

/**
 * Extract the overridable subset of resolved settings for snapshot comparison.
 * Used in WorkspaceTab.claudeSettings to detect settings changes on restore.
 */
export function settingsSnapshot(
  settings: ResolvedClaudeSettings,
): { model?: string; effort?: string; permissionMode?: string; outputStyle?: string } {
  return {
    model: settings.model,
    effort: settings.effort,
    permissionMode: settings.permissionMode,
    outputStyle: settings.outputStyle,
  };
}

/**
 * Compare two settings snapshots and return a human-readable diff.
 * Returns null if they are identical.
 */
export function diffSettings(
  saved: { model?: string; effort?: string; permissionMode?: string; outputStyle?: string } | undefined,
  current: { model?: string; effort?: string; permissionMode?: string; outputStyle?: string },
): string | null {
  if (!saved) return null;

  const changes: string[] = [];
  if (saved.model !== current.model) {
    changes.push(`model: ${saved.model ?? "default"} → ${current.model ?? "default"}`);
  }
  if (saved.effort !== current.effort) {
    changes.push(`effort: ${saved.effort ?? "default"} → ${current.effort ?? "default"}`);
  }
  if (saved.permissionMode !== current.permissionMode) {
    changes.push(`permissions: ${saved.permissionMode ?? "default"} → ${current.permissionMode ?? "default"}`);
  }
  if (saved.outputStyle !== current.outputStyle) {
    changes.push(`output: ${saved.outputStyle ?? "default"} → ${current.outputStyle ?? "default"}`);
  }

  return changes.length > 0 ? changes.join(", ") : null;
}

import type { ClaudeDefaults, GlobalAppConfig } from "../types";
import { getAppConfig, getConfig } from "../api";
import { useToastStore } from "../stores/toastStore";
import { parseLaunchFlags } from "./launchCommand";

const SETTINGS_LOAD_ERROR_MSG = "Couldn't load Claude settings — launching with defaults.";

/**
 * Load global + repo config via allSettled, log (and optionally toast, deduped)
 * on any rejection, then build Claude launch args from whatever succeeded.
 * Never throws — on total failure returns args built from all-null config, so
 * callers can't silently drop their whole action on a transient config error.
 */
export async function loadLaunchArgs(
  repoPath: string,
  opts: { logTag: string; toastOnError?: boolean },
): Promise<string[]> {
  const [appRes, cfgRes] = await Promise.allSettled([getAppConfig(), getConfig(repoPath)]);
  if (appRes.status === "rejected" || cfgRes.status === "rejected") {
    console.error(
      `[${opts.logTag}] settings resolution failed for ${repoPath}; launching with defaults:`,
      [appRes, cfgRes]
        .filter((r) => r.status === "rejected")
        .map((r) => (r as PromiseRejectedResult).reason),
    );
    if (opts.toastOnError) {
      const { toasts, show } = useToastStore.getState();
      if (!toasts.some((t) => t.message === SETTINGS_LOAD_ERROR_MSG)) {
        show({ message: SETTINGS_LOAD_ERROR_MSG });
      }
    }
  }
  const appCfg = appRes.status === "fulfilled" ? appRes.value : null;
  const config = cfgRes.status === "fulfilled" ? cfgRes.value : null;
  return buildClaudeArgs(resolveSettings(appCfg, config?.claudeDefaults));
}

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
 * Merge global app defaults → per-repo defaults.
 * Each layer overrides the previous; only defined fields are merged.
 */
export function resolveSettings(
  globalDefaults?: Pick<GlobalAppConfig, "model" | "effort" | "permissionMode" | "dangerouslySkipPermissions" | "outputStyle" | "verbose" | "extraFlags"> | null,
  repoDefaults?: ClaudeDefaults,
): ResolvedClaudeSettings {
  // For free-form text fields, treat blank/whitespace-only as absent so a
  // hand-edited empty alfredo.json value doesn't silently shadow the global.
  const cleanFlags = (v?: string | null) => (v && v.trim() ? v : undefined);
  return {
    model: repoDefaults?.model ?? globalDefaults?.model ?? undefined,
    effort: repoDefaults?.effort ?? globalDefaults?.effort ?? undefined,
    permissionMode: repoDefaults?.permissionMode ?? globalDefaults?.permissionMode ?? undefined,
    dangerouslySkipPermissions: repoDefaults?.dangerouslySkipPermissions ?? globalDefaults?.dangerouslySkipPermissions ?? undefined,
    outputStyle: repoDefaults?.outputStyle ?? globalDefaults?.outputStyle ?? undefined,
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

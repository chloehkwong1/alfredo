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

/**
 * Everything Alfredo still injects into a `claude` launch. Model, effort,
 * permission mode and output style are deliberately NOT here — Claude owns
 * those in its own config, so new Claude knobs never need an Alfredo release.
 */
export type ClaudeLaunchSettings = Pick<GlobalAppConfig, "dangerouslySkipPermissions" | "extraFlags">;

/**
 * Merge global app defaults → per-repo defaults. Skip-permissions is global
 * only (the repo layer has no UI for it, so an invisible override would be
 * a trap); extra flags let a repo replace the global value.
 */
export function resolveSettings(
  globalDefaults?: ClaudeLaunchSettings | null,
  repoDefaults?: ClaudeDefaults,
): ClaudeLaunchSettings {
  // For free-form text fields, treat blank/whitespace-only as absent so a
  // hand-edited empty value doesn't silently shadow the global.
  const cleanFlags = (v?: string | null) => (v && v.trim() ? v : undefined);
  return {
    dangerouslySkipPermissions: globalDefaults?.dangerouslySkipPermissions ?? undefined,
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
export function buildClaudeArgs(settings: ClaudeLaunchSettings): string[] {
  const args: string[] = [];

  if (settings.dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions");
  }
  if (settings.extraFlags) {
    const parsed = parseLaunchFlags(settings.extraFlags);
    if (parsed.ok) args.push(...parsed.args);
  }

  return args;
}

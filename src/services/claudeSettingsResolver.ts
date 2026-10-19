import type { ClaudeDefaults, GlobalAppConfig } from "../types";
import { getAppConfig, getConfig } from "../api";
import { useToastStore } from "../stores/toastStore";
import { parseLaunchFlags } from "./launchCommand";

const SETTINGS_LOAD_ERROR_MSG = "Couldn't load agent settings — launching with defaults.";

/** Providers whose launch argv Alfredo assembles. Gemini launches bare. */
export type LaunchProvider = "claude" | "codex";

/** The "no permission checks" flag, spelled per provider. */
export const BYPASS_FLAG: Record<LaunchProvider, string> = {
  claude: "--dangerously-skip-permissions",
  codex: "--dangerously-bypass-approvals-and-sandbox",
};

/**
 * Load global + repo config via allSettled, log (and optionally toast, deduped)
 * on any rejection, then build launch args from whatever succeeded.
 * Never throws — on total failure returns args built from all-null config, so
 * callers can't silently drop their whole action on a transient config error.
 */
export async function loadLaunchArgs(
  repoPath: string,
  provider: LaunchProvider,
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
  return buildLaunchArgs(provider, resolveSettings(provider, appCfg, config?.claudeDefaults));
}

/**
 * Everything Alfredo still injects into an agent launch, already narrowed to
 * one provider's slot. Model, effort, permission mode and output style are
 * deliberately NOT here — each agent owns those in its own config.
 */
export type LaunchSettings = {
  dangerouslySkipPermissions?: boolean | null;
  extraFlags?: string | null;
};

type GlobalLaunchDefaults = Pick<
  GlobalAppConfig,
  "dangerouslySkipPermissions" | "codexDangerouslySkipPermissions" | "extraFlags" | "codexExtraFlags"
>;

/**
 * Merge global app defaults → per-repo defaults for one provider.
 * Skip-permissions is global only (the repo layer has no UI for it, so an
 * invisible override would be a trap) but per provider: Codex's flag drops
 * its sandbox as well as its approvals, so opting in for Claude must never
 * imply it. Extra flags are per provider too, and a repo may replace the
 * global value.
 */
export function resolveSettings(
  provider: LaunchProvider,
  globalDefaults?: GlobalLaunchDefaults | null,
  repoDefaults?: ClaudeDefaults,
): LaunchSettings {
  // For free-form text fields, treat blank/whitespace-only as absent so a
  // hand-edited empty value doesn't silently shadow the global.
  const cleanFlags = (v?: string | null) => (v && v.trim() ? v : undefined);
  const repoFlags = provider === "codex" ? repoDefaults?.codexExtraFlags : repoDefaults?.extraFlags;
  const globalFlags = provider === "codex" ? globalDefaults?.codexExtraFlags : globalDefaults?.extraFlags;
  const bypass = provider === "codex"
    ? globalDefaults?.codexDangerouslySkipPermissions
    : globalDefaults?.dangerouslySkipPermissions;
  return {
    dangerouslySkipPermissions: bypass ?? undefined,
    extraFlags: cleanFlags(repoFlags) ?? cleanFlags(globalFlags),
  };
}

/**
 * Reconcile a restored tab's own session with any session-selection flag the
 * user put in extra flags: strip `--resume`/`--resume=<id>`/`--continue` (the
 * tab's own session must win on restore), then append `--resume <sessionId>`.
 *
 * Claude only. Only call this on the restored-tab path (when
 * `claudeSessionId` is set). For non-restored tabs, leave extra flags untouched.
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
 * Convert resolved settings to an argv array for the provider's binary. The
 * bypass flag is emitted at most once even if the user also typed it into
 * extra flags; every other token passes through verbatim.
 */
export function buildLaunchArgs(provider: LaunchProvider, settings: LaunchSettings): string[] {
  const bypass = BYPASS_FLAG[provider];
  const args: string[] = [];

  if (settings.dangerouslySkipPermissions) {
    args.push(bypass);
  }
  if (settings.extraFlags) {
    const parsed = parseLaunchFlags(settings.extraFlags);
    if (parsed.ok) {
      for (const token of parsed.args) {
        if (token === bypass && args.includes(bypass)) continue;
        args.push(token);
      }
    }
  }

  return args;
}

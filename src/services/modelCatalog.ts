import { useEffect, useState } from "react";

export type ModelOption = { value: string; label: string };
export type EffortOption = { value: string; label: string };
export type PermissionModeOption = { value: string; label: string; hint?: string };

const FALLBACK_CLAUDE_MODELS: ModelOption[] = [
  { value: "claude-fable-5", label: "Fable 5 (1M context)" },
  { value: "claude-opus-4-8", label: "Opus 4.8 (1M context)" },
  { value: "claude-opus-4-7", label: "Opus 4.7 (1M context)" },
  { value: "claude-opus-4-6", label: "Opus 4.6 (1M context)" },
  { value: "claude-sonnet-5", label: "Sonnet 5 (1M context)" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6 (1M context)" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5 (200K context)" },
];

const FALLBACK_EFFORT: EffortOption[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "XHigh" },
  { value: "max", label: "Max" },
];

const FALLBACK_PERMISSION_MODES: PermissionModeOption[] = [
  { value: "default", label: "Default", hint: "Asks before edits and commands" },
  { value: "acceptEdits", label: "Accept Edits", hint: "Auto-accepts file edits, asks before commands" },
  { value: "plan", label: "Plan", hint: "Read-only exploration, no edits or commands" },
  { value: "auto", label: "Auto", hint: "AI decides which permissions to grant — may still ask" },
  { value: "dontAsk", label: "Don't Ask", hint: "Runs all tools without asking — use with caution" },
  { value: "bypassPermissions", label: "Bypass Permissions", hint: "No checks at all — sandboxed environments only" },
];

const MANIFEST_URL =
  "https://api.github.com/repos/chloehkwong1/alfredo/contents/models.json?ref=main";
// Bumped from v1 to v2 when effort + permissionModes were added — old caches
// lacked these keys and would silently fall back.
const CACHE_KEY = "alfredo:model-catalog:v2";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type Manifest = {
  claude?: ModelOption[];
  effort?: EffortOption[];
  permissionModes?: PermissionModeOption[];
};
type CacheEntry = { fetchedAt: number; manifest: Manifest };

function readCache(): Manifest | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed.manifest;
  } catch {
    return null;
  }
}

function writeCache(manifest: Manifest) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ fetchedAt: Date.now(), manifest }),
    );
  } catch {
    // localStorage quota or disabled — non-fatal
  }
}

async function fetchManifest(): Promise<Manifest | null> {
  try {
    const res = await fetch(MANIFEST_URL, {
      headers: { Accept: "application/vnd.github.raw+json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Manifest;
    if (!Array.isArray(json.claude)) return null;
    return json;
  } catch {
    return null;
  }
}

// Shared single-flight fetch so the three hooks don't trigger three network calls.
let inflight: Promise<Manifest | null> | null = null;
function loadManifestOnce(): Promise<Manifest | null> {
  if (!inflight) inflight = fetchManifest();
  return inflight;
}

function useManifestField<T>(
  pick: (m: Manifest) => T[] | undefined,
  fallback: T[],
): T[] {
  const [value, setValue] = useState<T[]>(() => {
    const cached = readCache();
    const fromCache = cached ? pick(cached) : undefined;
    return fromCache && fromCache.length > 0 ? fromCache : fallback;
  });

  useEffect(() => {
    let cancelled = false;
    loadManifestOnce().then((manifest) => {
      if (cancelled || !manifest) return;
      const next = pick(manifest);
      if (next && next.length > 0) setValue(next);
      writeCache(manifest);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return value;
}

export function useClaudeModels(): ModelOption[] {
  return useManifestField((m) => m.claude, FALLBACK_CLAUDE_MODELS);
}

export function useEffortOptions(): EffortOption[] {
  return useManifestField((m) => m.effort, FALLBACK_EFFORT);
}

export function usePermissionModes(): PermissionModeOption[] {
  return useManifestField((m) => m.permissionModes, FALLBACK_PERMISSION_MODES);
}

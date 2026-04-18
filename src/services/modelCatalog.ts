import { useEffect, useState } from "react";

export type ModelOption = { value: string; label: string };

const FALLBACK_CLAUDE_MODELS: ModelOption[] = [
  { value: "claude-opus-4-6", label: "Opus 4.6" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6 (200K context)" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5 (200K context)" },
];

const MANIFEST_URL =
  "https://api.github.com/repos/chloehkwong1/alfredo/contents/models.json?ref=main";
const CACHE_KEY = "alfredo:model-catalog";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type Manifest = { claude?: ModelOption[] };
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

export function useClaudeModels(): ModelOption[] {
  const [models, setModels] = useState<ModelOption[]>(
    () => readCache()?.claude ?? FALLBACK_CLAUDE_MODELS,
  );

  useEffect(() => {
    let cancelled = false;
    fetchManifest().then((manifest) => {
      if (cancelled || !manifest?.claude) return;
      setModels(manifest.claude);
      writeCache(manifest);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return models;
}

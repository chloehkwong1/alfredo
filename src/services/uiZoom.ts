import { getCurrentWebview } from "@tauri-apps/api/webview";

const STORAGE_KEY = "alfredo:ui-zoom";
const DEFAULT_ZOOM = 1.0;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;
const STEP = 0.1;

export function loadUiZoom(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return DEFAULT_ZOOM;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < MIN_ZOOM || n > MAX_ZOOM) return DEFAULT_ZOOM;
    return n;
  } catch {
    return DEFAULT_ZOOM;
  }
}

function saveUiZoom(level: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(level));
  } catch {
    // Storage may be unavailable in private browsing — non-fatal.
  }
}

async function applyZoom(level: number): Promise<void> {
  await getCurrentWebview().setZoom(level);
}

function clamp(level: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, level));
}

function roundStep(level: number): number {
  // Avoid floating-point drift across many keypresses.
  return Math.round(level * 10) / 10;
}

export async function setUiZoom(level: number): Promise<number> {
  const next = roundStep(clamp(level));
  saveUiZoom(next);
  await applyZoom(next);
  return next;
}

export async function zoomIn(): Promise<number> {
  return setUiZoom(loadUiZoom() + STEP);
}

export async function zoomOut(): Promise<number> {
  return setUiZoom(loadUiZoom() - STEP);
}

export async function zoomReset(): Promise<number> {
  return setUiZoom(DEFAULT_ZOOM);
}

export async function applyPersistedZoom(): Promise<void> {
  await applyZoom(loadUiZoom());
}

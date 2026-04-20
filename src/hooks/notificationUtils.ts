import {
  isPermissionGranted,
  requestPermission,
  sendNotification as tauriNotify,
} from "@tauri-apps/plugin-notification";
import { playSound } from "../api";

// Canonical list of sound ids. Source of truth for the settings dropdown.
// When adding a new sound:
//   1. Add its definition to scripts/render-sounds.mjs
//   2. Run `npm run render-sounds`
//   3. Add the id here
export const SOUND_IDS = [
  "none",
  "coin", "zelda", "levelup", "pinball",
  "r2d2", "quack", "submarine",
  "train", "seatbelt", "shipbell",
  "cashregister", "typewriter", "sparkle",
] as const;

export type SoundId = typeof SOUND_IDS[number];

export async function playSoundById(soundId: string): Promise<void> {
  if (soundId === "none" || !soundId) return;
  try {
    await playSound(soundId);
  } catch (e) {
    console.warn("[notifications] playSound failed:", e);
  }
}

// ── Native notification helper (Tauri plugin) ──────────────────

let permissionChecked = false;
let permitted = false;

async function ensurePermission(): Promise<boolean> {
  if (permissionChecked) return permitted;
  permitted = await isPermissionGranted();
  if (!permitted) {
    const result = await requestPermission();
    permitted = result === "granted";
  }
  // Only cache when granted. If denied/unresolved (e.g. window wasn't focused
  // when the dialog would have appeared), leave permissionChecked=false so the
  // next notification attempt retries rather than silently failing forever.
  if (permitted) permissionChecked = true;
  return permitted;
}

export async function sendNotification(message: string) {
  if (await ensurePermission()) {
    tauriNotify({ title: "Alfredo", body: message });
  }
}
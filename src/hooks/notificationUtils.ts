import {
  notificationPermissionStatus,
  playSound,
  requestNotificationPermission,
  sendAppNotification,
} from "../api";

// Canonical list of sound ids. Source of truth for the settings dropdown.
// Most ids map to a static recording at `src-tauri/sounds/{id}.wav`.
// `coin` is the only synthesized sound — re-render it with `npm run render-sounds`
// after editing `scripts/render-sounds.mjs`.
export const SOUND_IDS = [
  "none",
  "coin", "alfie", "bigben", "mail", "pacman",
  "oof", "honk", "ahooga", "boing", "microwave",
  "shutter", "seatbelt", "powerup", "blip", "levelup",
  "doorbell", "fwump", "quack",
] as const;

export type SoundId = typeof SOUND_IDS[number];

export async function playSoundById(soundId: string): Promise<void> {
  if (soundId === "none" || !soundId) return;
  try {
    await playSound(soundId);
  } catch (e) {
    // Best-effort: audio failure must not break the notification flow.
    console.warn("[notifications] playSound failed:", e);
  }
}

// ── Native notification helper (UNUserNotificationCenter on macOS) ──────────

let permissionChecked = false;
let permitted = false;

async function ensurePermission(): Promise<boolean> {
  if (permissionChecked) return permitted;
  const status = await notificationPermissionStatus();
  if (status === "granted") {
    permitted = true;
  } else {
    permitted = await requestNotificationPermission();
  }
  // Only cache when granted. If denied/unresolved (e.g. window wasn't focused
  // when the dialog would have appeared), leave permissionChecked=false so the
  // next notification attempt retries rather than silently failing forever.
  if (permitted) permissionChecked = true;
  return permitted;
}

export async function sendNotification(message: string, soundId?: string) {
  if (await ensurePermission()) {
    void sendAppNotification("Alfredo", message, soundId);
  }
}

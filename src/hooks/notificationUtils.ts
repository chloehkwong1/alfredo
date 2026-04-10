import {
  isPermissionGranted,
  requestPermission,
  sendNotification as tauriNotify,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";

// ── Sound generation via Web Audio API ─────────────────────────

type SoundNote = {
  frequency: number;
  duration: number;
  type?: OscillatorType;     // default: "sine"
  endFrequency?: number;     // for frequency sweeps
  gain?: number;             // override default 0.3
  delay?: number;            // gap after previous note (default: 0.04)
};

const SOUNDS: Record<string, SoundNote[]> = {
  none:        [],
  // ── Retro / Gaming ──
  coin:        [
    { frequency: 988, duration: 0.08, type: "square", gain: 0.2 },
    { frequency: 1319, duration: 0.3, type: "square", gain: 0.2 },
  ],
  zelda:       [
    { frequency: 523, duration: 0.12, type: "triangle" },
    { frequency: 659, duration: 0.12, type: "triangle" },
    { frequency: 784, duration: 0.12, type: "triangle" },
    { frequency: 1047, duration: 0.4, type: "triangle" },
  ],
  levelup:     [
    { frequency: 440, duration: 0.1, type: "square", gain: 0.18 },
    { frequency: 554, duration: 0.1, type: "square", gain: 0.18, delay: 0.0 },
    { frequency: 659, duration: 0.1, type: "square", gain: 0.18, delay: 0.0 },
    { frequency: 880, duration: 0.12, type: "square", gain: 0.2, delay: 0.0 },
    { frequency: 1108, duration: 0.12, type: "square", gain: 0.2, delay: 0.0 },
    { frequency: 1319, duration: 0.35, type: "square", gain: 0.22, delay: 0.0 },
  ],
  pinball:     [
    { frequency: 1200, duration: 0.03, type: "square", gain: 0.25 },
    { frequency: 1800, duration: 0.03, type: "square", gain: 0.2, delay: 0.0 },
    { frequency: 2400, duration: 0.05, type: "square", gain: 0.18, delay: 0.0 },
    { frequency: 1400, duration: 0.08, type: "square", gain: 0.15, delay: 0.06 },
    { frequency: 1800, duration: 0.12, type: "square", gain: 0.12, delay: 0.0 },
  ],
  // ── Character ──
  r2d2:        [
    { frequency: 800, duration: 0.06, endFrequency: 2400 },
    { frequency: 2400, duration: 0.06, endFrequency: 1200, delay: 0.02 },
    { frequency: 1200, duration: 0.06, endFrequency: 1800, delay: 0.02 },
    { frequency: 1800, duration: 0.08, endFrequency: 600, delay: 0.02 },
  ],
  quack:       [
    { frequency: 600, duration: 0.06, type: "sawtooth", endFrequency: 200, gain: 0.2 },
    { frequency: 180, duration: 0.04, type: "sawtooth", gain: 0.08, delay: 0.0 },
    { frequency: 550, duration: 0.06, type: "sawtooth", endFrequency: 180, gain: 0.18, delay: 0.12 },
    { frequency: 160, duration: 0.04, type: "sawtooth", gain: 0.06, delay: 0.0 },
  ],
  submarine:   [
    { frequency: 1200, duration: 0.15, gain: 0.25 },
    { frequency: 1200, duration: 0.4, gain: 0.15, delay: 0.3 },
  ],
  // ── Transport ──
  train:       [
    { frequency: 330, duration: 0.3, type: "sawtooth", endFrequency: 370, gain: 0.15 },
    { frequency: 370, duration: 0.15, type: "sawtooth", endFrequency: 330, gain: 0.12, delay: 0.08 },
    { frequency: 340, duration: 0.5, type: "sawtooth", endFrequency: 380, gain: 0.18, delay: 0.1 },
  ],
  seatbelt:    [
    { frequency: 932, duration: 0.18, gain: 0.2 },
    { frequency: 1245, duration: 0.35, gain: 0.22, delay: 0.02 },
  ],
  shipbell:    [
    { frequency: 2200, duration: 0.12, type: "triangle", gain: 0.2 },
    { frequency: 2200, duration: 0.12, type: "triangle", gain: 0.18, delay: 0.08 },
    { frequency: 2200, duration: 0.12, type: "triangle", gain: 0.15, delay: 0.25 },
    { frequency: 2200, duration: 0.12, type: "triangle", gain: 0.12, delay: 0.08 },
  ],
  // ── Objects ──
  cashregister:[
    { frequency: 200, duration: 0.02, type: "square", gain: 0.2 },
    { frequency: 1400, duration: 0.04, type: "triangle", gain: 0.22, delay: 0.0 },
    { frequency: 2800, duration: 0.08, type: "triangle", gain: 0.18, delay: 0.0 },
    { frequency: 2800, duration: 0.25, type: "triangle", gain: 0.12, delay: 0.02 },
  ],
  typewriter:  [
    { frequency: 1800, duration: 0.01, type: "square", gain: 0.15 },
    { frequency: 300, duration: 0.04, type: "square", endFrequency: 100, gain: 0.12, delay: 0.0 },
    { frequency: 2400, duration: 0.15, type: "triangle", gain: 0.2, delay: 0.06 },
  ],
  sparkle:     [
    { frequency: 1568, duration: 0.06, gain: 0.2 },
    { frequency: 1760, duration: 0.06, gain: 0.2, delay: 0.02 },
    { frequency: 1976, duration: 0.06, gain: 0.2, delay: 0.02 },
    { frequency: 2093, duration: 0.06, gain: 0.2, delay: 0.02 },
    { frequency: 2349, duration: 0.2, gain: 0.2, delay: 0.02 },
  ],
};

/**
 * Create a fresh AudioContext for each sound.
 *
 * WKWebView's AudioContext can enter a "zombie" state — `state` reads
 * "running" but no audio output is produced — after macOS sleep/wake,
 * background transitions, or audio device changes. Reusing a cached
 * instance is unreliable, so we create a new context every time.
 * The sounds are < 1 second, so the overhead is negligible.
 */
async function createAudioContext(): Promise<AudioContext> {
  const ctx = new AudioContext();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  return ctx;
}

async function playNotes(notes: SoundNote[]) {
  if (notes.length === 0) return;
  const ctx = await createAudioContext();
  let offset = ctx.currentTime;
  for (const note of notes) {
    if (note.frequency === 0 || note.duration === 0) continue;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.type = note.type ?? "sine";
    osc.frequency.setValueAtTime(note.frequency, offset);
    if (note.endFrequency) {
      osc.frequency.exponentialRampToValueAtTime(note.endFrequency, offset + note.duration);
    }
    const vol = note.gain ?? 0.3;
    gainNode.gain.setValueAtTime(vol, offset);
    gainNode.gain.exponentialRampToValueAtTime(0.001, offset + note.duration);
    osc.start(offset);
    osc.stop(offset + note.duration);
    offset += note.duration + (note.delay ?? 0.04);
  }
  // Close the context after all notes finish to release system audio resources.
  const totalMs = (offset - ctx.currentTime + 0.1) * 1000;
  setTimeout(() => ctx.close().catch(() => {}), totalMs);
}

export async function playSoundById(soundId: string) {
  const notes = SOUNDS[soundId];
  if (notes) await playNotes(notes);
}

export { SOUNDS };

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

// ── Dock bounce (macOS attention request) ────────────────────

export function requestDockBounce() {
  getCurrentWindow()
    .requestUserAttention(1) // Critical — bounces dock icon until focused
    .catch(e => console.warn('[notifications] Failed to request dock bounce:', e));
}

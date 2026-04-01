import { useEffect, useRef, useState } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification as tauriNotify,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { getAppConfig } from "../api";
import type { AgentState, NotificationConfig } from "../types";

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

let audioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

export function playTone(frequency: number, duration: number, type: OscillatorType = "sine") {
  if (frequency === 0 || duration === 0) return;
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = type;
  osc.frequency.value = frequency;
  gain.gain.value = 0.3;
  osc.start(ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.stop(ctx.currentTime + duration);
}

function playNotes(notes: SoundNote[]) {
  if (notes.length === 0) return;
  const ctx = getAudioContext();
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
}

export function playSoundById(soundId: string) {
  const notes = SOUNDS[soundId];
  if (notes) playNotes(notes);
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
  permissionChecked = true;
  return permitted;
}

async function sendNotification(message: string) {
  if (await ensurePermission()) {
    tauriNotify({ title: "Alfredo", body: message });
  }
}

// ── Dock bounce (macOS attention request) ────────────────────

function requestDockBounce() {
  getCurrentWindow()
    .requestUserAttention(1) // Critical — bounces dock icon until focused
    .catch(e => console.warn('[useNotifications] Failed to request dock bounce:', e));
}

// ── Default config ─────────────────────────────────────────────

const DEFAULT_CONFIG: NotificationConfig = {
  enabled: false,
  sound: "coin",
  notifyOnWaiting: true,
  notifyOnIdle: true,
};

// ── Delayed idle notifications ──────────────────────────────
// Agents flicker busy→idle→busy during long operations. Delay idle
// notifications and cancel if the agent goes back to busy.

const IDLE_DELAY_MS = 3_000;

// ── Hook ───────────────────────────────────────────────────────

export function useNotifications() {
  const prevStatesRef = useRef<Record<string, AgentState>>({});
  const pendingTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const configRef = useRef<NotificationConfig>(DEFAULT_CONFIG);

  // Load notification config once on mount, then refresh periodically.
  useEffect(() => {
    let cancelled = false;
    function fetchConfig() {
      getAppConfig()
        .then((appConfig) => {
          if (!cancelled) {
            configRef.current = appConfig.notifications ?? DEFAULT_CONFIG;
          }
        })
        .catch((e) => console.warn('[notifications] Failed to fetch config:', e));
    }
    fetchConfig();
    const interval = setInterval(fetchConfig, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Build a stable snapshot of agentStatus per worktree. Only update the ref
  // when statuses actually change, so the effect doesn't fire on every
  // updateWorktree call (channelAlive, staleBusy from the 500ms poll).
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const agentStatusesRef = useRef<Record<string, AgentState>>({});
  const [agentStatuses, setAgentStatuses] = useState<Record<string, AgentState>>({});

  useEffect(() => {
    const next: Record<string, AgentState> = {};
    for (const wt of worktrees) {
      next[wt.id] = wt.agentStatus;
    }
    const prev = agentStatusesRef.current;
    const keys = Object.keys(next);
    const changed = keys.length !== Object.keys(prev).length
      || keys.some((k) => next[k] !== prev[k]);
    if (changed) {
      agentStatusesRef.current = next;
      setAgentStatuses(next);
    }
  }, [worktrees]);

  useEffect(() => {
    const prevStates = prevStatesRef.current;
    const pendingTimers = pendingTimersRef.current;

    // Find actual transitions (skip notRunning → anything, that's just session init)
    const transitions: { id: string; from: AgentState; to: AgentState }[] = [];
    for (const [id, status] of Object.entries(agentStatuses)) {
      const prev = prevStates[id];
      if (prev && prev !== status && prev !== "notRunning") {
        transitions.push({ id, from: prev, to: status });
      }
    }

    // Cancel pending idle timers for worktrees that went back to busy
    for (const { id, to } of transitions) {
      if (to === "busy" && pendingTimers[id]) {
        clearTimeout(pendingTimers[id]);
        delete pendingTimers[id];
      }
    }

    // Clean up timers for removed worktrees
    for (const id of Object.keys(pendingTimers)) {
      if (!(id in agentStatuses)) {
        clearTimeout(pendingTimers[id]);
        delete pendingTimers[id];
      }
    }

    // Update tracked states
    prevStatesRef.current = { ...agentStatuses };

    if (transitions.length === 0) return;

    const config = configRef.current;
    if (!config.enabled) return;

    const currentWorktrees = useWorkspaceStore.getState().worktrees;

    for (const { id, to } of transitions) {
      const wt = currentWorktrees.find((w) => w.id === id);
      if (!wt) continue;

      if (to === "waitingForInput" && config.notifyOnWaiting) {
        // Cancel any pending idle timer — waiting supersedes idle
        if (pendingTimers[id]) {
          clearTimeout(pendingTimers[id]);
          delete pendingTimers[id];
        }
        sendNotification(`${wt.branch} needs your input`);
        playSoundById(config.sound);
        requestDockBounce();
      } else if (to === "idle" && config.notifyOnIdle) {
        // Delay to absorb busy→idle→busy flicker
        if (pendingTimers[id]) {
          clearTimeout(pendingTimers[id]);
          delete pendingTimers[id];
        }
        const branch = wt.branch;
        pendingTimers[id] = setTimeout(() => {
          delete pendingTimers[id];
          // Re-check config (user may have disabled) and current state
          const latestConfig = configRef.current;
          if (!latestConfig.enabled || !latestConfig.notifyOnIdle) return;
          const state = useWorkspaceStore.getState();
          const current = state.worktrees.find((w) => w.id === id);
          if (current?.agentStatus === "idle" && !state.seenWorktrees.has(id)) {
            sendNotification(`${branch} finished`);
            playSoundById(latestConfig.sound);
            requestDockBounce();
          }
        }, IDLE_DELAY_MS);
      }
    }
  }, [agentStatuses]);

  // Clean up all pending timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of Object.values(pendingTimersRef.current)) {
        clearTimeout(timer);
      }
      pendingTimersRef.current = {};
    };
  }, []);
}

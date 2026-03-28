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

type SoundNote = { frequency: number; duration: number };

const SOUNDS: Record<string, SoundNote[]> = {
  chime:     [{ frequency: 880, duration: 0.25 }, { frequency: 1108, duration: 0.35 }],
  pop:       [{ frequency: 440, duration: 0.12 }, { frequency: 554, duration: 0.18 }],
  ding:      [{ frequency: 1047, duration: 0.2 }, { frequency: 1318, duration: 0.3 }],
  ping:      [{ frequency: 1320, duration: 0.15 }, { frequency: 1568, duration: 0.2 }],
  woodblock: [{ frequency: 330, duration: 0.08 }, { frequency: 440, duration: 0.12 }],
  none:      [],
};

let audioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

export function playTone(frequency: number, duration: number) {
  if (frequency === 0 || duration === 0) return;
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
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
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = note.frequency;
    gain.gain.setValueAtTime(0.3, offset);
    osc.start(offset);
    gain.gain.exponentialRampToValueAtTime(0.001, offset + note.duration);
    osc.stop(offset + note.duration);
    offset += note.duration + 0.04; // small gap between notes
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
  sound: "chime",
  notifyOnWaiting: true,
  notifyOnIdle: true,
  notifyOnError: false,
};

// ── Delayed idle notifications ──────────────────────────────
// Agents flicker busy→idle→busy during long operations. Delay idle
// notifications and cancel if the agent goes back to busy.

const IDLE_DELAY_MS = 3_000;

// ── Hook ───────────────────────────────────────────────────────

export function useNotifications() {
  const prevStatesRef = useRef<Record<string, AgentState>>({});
  const pendingTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const initialRenderRef = useRef(true);

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
    // Skip initial render to avoid notifying on load
    if (initialRenderRef.current) {
      prevStatesRef.current = { ...agentStatuses };
      initialRenderRef.current = false;
      return;
    }

    const prevStates = prevStatesRef.current;
    const pendingTimers = pendingTimersRef.current;

    // Find actual transitions
    const transitions: { id: string; from: AgentState; to: AgentState }[] = [];
    for (const [id, status] of Object.entries(agentStatuses)) {
      const prev = prevStates[id];
      if (prev && prev !== status) {
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

    getAppConfig()
      .then((appConfig) => {
        const config = appConfig.notifications ?? DEFAULT_CONFIG;
        if (!config.enabled) return;

        const worktrees = useWorkspaceStore.getState().worktrees;

        for (const { id, to } of transitions) {
          const wt = worktrees.find((w) => w.id === id);
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
              // Re-check current state — only notify if still idle
              const current = useWorkspaceStore.getState().worktrees.find((w) => w.id === id);
              if (current?.agentStatus === "idle") {
                sendNotification(`${branch} finished`);
                playSoundById(config.sound);
                requestDockBounce();
              }
            }, IDLE_DELAY_MS);
          }
        }
      })
      .catch(() => {
        // Backend not available — skip notification
      });
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

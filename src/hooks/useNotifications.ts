import { useEffect, useRef } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification as tauriNotify,
} from "@tauri-apps/plugin-notification";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { getAppConfig } from "../api";
import type { AgentState, NotificationConfig } from "../types";

// ── Sound generation via Web Audio API ─────────────────────────

const SOUNDS: Record<string, { frequency: number; duration: number }> = {
  chime: { frequency: 880, duration: 0.3 },
  pop: { frequency: 440, duration: 0.15 },
  ding: { frequency: 1047, duration: 0.2 },
  ping: { frequency: 1320, duration: 0.15 },
  woodblock: { frequency: 330, duration: 0.1 },
  none: { frequency: 0, duration: 0 },
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
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.stop(ctx.currentTime + duration);
}

export function playSoundById(soundId: string) {
  const sound = SOUNDS[soundId];
  if (sound) playTone(sound.frequency, sound.duration);
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

// ── Default config ─────────────────────────────────────────────

const DEFAULT_CONFIG: NotificationConfig = {
  enabled: false,
  sound: "chime",
  notifyOnWaiting: true,
  notifyOnIdle: true,
  notifyOnError: false,
};

// ── Hook ───────────────────────────────────────────────────────

export function useNotifications() {
  const prevStatesRef = useRef<Record<string, AgentState>>({});
  const initialRenderRef = useRef(true);

  // Watch worktree agent status changes
  const worktrees = useWorkspaceStore((s) => s.worktrees);

  useEffect(() => {
    // Skip initial render to avoid notifying on load
    if (initialRenderRef.current) {
      const states: Record<string, AgentState> = {};
      for (const wt of worktrees) {
        states[wt.id] = wt.agentStatus;
      }
      prevStatesRef.current = states;
      initialRenderRef.current = false;
      return;
    }

    // Check for any state transitions before fetching config
    const prevStates = prevStatesRef.current;
    const hasTransition = worktrees.some(
      (wt) => prevStates[wt.id] && prevStates[wt.id] !== wt.agentStatus,
    );

    // Always update tracked states
    const nextStates: Record<string, AgentState> = {};
    for (const wt of worktrees) {
      nextStates[wt.id] = wt.agentStatus;
    }
    prevStatesRef.current = nextStates;

    if (!hasTransition) return;

    // Fetch fresh config so settings changes take effect immediately
    getAppConfig()
      .then((appConfig) => {
        const config = appConfig.notifications ?? DEFAULT_CONFIG;
        if (!config.enabled) return;

        for (const wt of worktrees) {
          const prev = prevStates[wt.id];
          if (!prev || prev === wt.agentStatus) continue;

          if (wt.agentStatus === "waitingForInput" && config.notifyOnWaiting) {
            sendNotification(`${wt.branch} needs your input`);
            playSoundById(config.sound);
          } else if (wt.agentStatus === "idle" && config.notifyOnIdle) {
            sendNotification(`${wt.branch} finished`);
            playSoundById(config.sound);
          } else if ((wt.agentStatus as string) === "error" && config.notifyOnError) {
            sendNotification(`${wt.branch} encountered an error`);
            playSoundById(config.sound);
          }
        }
      })
      .catch(() => {
        // Backend not available — skip notification
      });
  }, [worktrees]);
}

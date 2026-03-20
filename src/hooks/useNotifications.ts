import { useEffect, useRef } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { getConfig } from "../api";
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

// ── Browser notification helper ────────────────────────────────

function sendNotification(message: string) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    new Notification("Alfredo", { body: message });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission();
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
  const configRef = useRef<NotificationConfig>(DEFAULT_CONFIG);
  const prevStatesRef = useRef<Record<string, AgentState>>({});
  const initialRenderRef = useRef(true);

  // Load notification config once on mount
  useEffect(() => {
    getConfig(".")
      .then((appConfig) => {
        if (appConfig.notifications) {
          configRef.current = appConfig.notifications;
        }
      })
      .catch(() => {
        // Backend not available — keep defaults
      });
  }, []);

  // Watch worktree agent status changes
  const worktrees = useWorkspaceStore((s) => s.worktrees);

  useEffect(() => {
    // Skip initial render to avoid notifying on load
    if (initialRenderRef.current) {
      // Seed previous states from current worktrees
      const states: Record<string, AgentState> = {};
      for (const wt of worktrees) {
        states[wt.id] = wt.agentStatus;
      }
      prevStatesRef.current = states;
      initialRenderRef.current = false;
      return;
    }

    const config = configRef.current;
    if (!config.enabled) {
      // Still track states so we don't fire stale transitions when re-enabled
      const states: Record<string, AgentState> = {};
      for (const wt of worktrees) {
        states[wt.id] = wt.agentStatus;
      }
      prevStatesRef.current = states;
      return;
    }

    const prevStates = prevStatesRef.current;
    const nextStates: Record<string, AgentState> = {};

    for (const wt of worktrees) {
      nextStates[wt.id] = wt.agentStatus;
      const prev = prevStates[wt.id];

      // Only notify on transitions (prev exists and changed)
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

    prevStatesRef.current = nextStates;
  }, [worktrees]);
}

import type { NotifyReason } from "../types";
import { sendNotification, playSoundById, requestDockBounce } from "../hooks/notificationUtils";
import { createPtyChannel, getAppConfig } from "../api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSessionStatusStore } from "../stores/sessionStatusStore";
import type { ManagedSession } from "./sessionTypes";
import { stripClearScrollback } from "./terminalFactory";

// ── Constants ────────────────────────────────────────────────

/** Maps frontend tab mode names to Rust AgentType enum variants. */
export const AGENT_TYPE_MAP: Record<string, string> = {
  claude: "claudeCode",
  codex: "codex",
  gemini: "geminiCli",
};

// ── Reconciler tuning ─────────────────────────────────────────

/** How often the global reconciler walks all sessions. */
export const RECONCILE_INTERVAL_MS = 500;

/** busy → idle: require no hook event for at least this long. */
export const STALE_HOOK_MS = 60_000;
/** busy → idle: require no PTY output for at least this long. */
export const STALE_OUTPUT_IDLE_MS = 10_000;
/** busy → idle (force): if hooks are silent this long, force idle regardless
 *  of output. Claude Code's TUI can produce output bytes (status bar redraws,
 *  cursor repositioning) while idle, keeping lastOutputAt fresh and preventing
 *  the output-based reconciler from triggering. */
export const STALE_HOOK_FORCE_MS = 60_000;
/** Debounce window for idle(turnEnd) transitions.
 *  Claude Code fires Stop (turnEnd) between every turn — including sub-agent
 *  completions. Defer the entire state+notification transition so a following
 *  busy(promptStart) can cancel it within this window. */
export const IDLE_DEBOUNCE_MS = 300;
/** Grace period after turnEnd during which bare-busy hooks (no phase) are
 *  suppressed. Claude Code fires idle(turnEnd) → idle → busy(none) as its
 *  internal state settles after a turn, but the bare busy is not real work.
 *  A legitimate new turn would arrive as busy with a phase (e.g. toolStart). */
export const TURN_END_GRACE_MS = 1000;

// ── Helpers ───────────────────────────────────────────────────

/**
 * Tracks the source of the last agent-state transition per worktree.
 * Used to surface diagnostic info when debug mode is on.
 */
export const stateSourceMap = new Map<string, string>();

/**
 * Fire an OS notification for a hook event.
 * Reads config each time so changes take effect immediately.
 */
export async function fireHookNotification(
  branch: string,
  notify: NotifyReason,
) {
  if (notify === "none") return;

  const appConfig = await getAppConfig();
  const config = appConfig.notifications;
  if (!config?.enabled) return;

  if (notify === "input" && !config.notifyOnWaiting) return;
  if ((notify === "finished" || notify === "error") && !config.notifyOnIdle) return;

  const dbg = appConfig.debugMode ? " [hook]" : "";
  const message =
    notify === "finished" ? `${branch} finished${dbg}` :
    notify === "error"    ? `${branch} stopped (error)${dbg}` :
                            `${branch} needs your input${dbg}`;

  sendNotification(message);
  playSoundById(config.sound);
  requestDockBounce();
}

/**
 * Fire a debug-only notification (only when debugMode is on).
 * Used by the reconciler to report stuck-state rescues.
 */
export async function fireDebugNotification(message: string) {
  try {
    const appConfig = await getAppConfig();
    if (!appConfig?.debugMode) return;
    const config = appConfig.notifications;
    if (!config?.enabled) return;
    sendNotification(`[debug] ${message}`);
  } catch {
    // Best-effort — don't break the reconciler if config is unavailable
  }
}

export function shouldAcceptDetectorState(hooksActive: boolean, lastHookAt: number): boolean {
  // Hooks are the sole source of truth once active. Every state is covered:
  //   idle            → Stop, Notification(idle_prompt)
  //   busy            → PreToolUse, PostToolUse, UserPromptSubmit
  //   waitingForInput → Notification(permission_prompt, elicitation_dialog),
  //                     PermissionRequest, PostToolUseFailure(interrupt)
  //   notRunning      → PTY reader thread sends NotRunning on EOF/exit
  //
  // Esc-during-thinking fires no hook → status stays busy until the next
  // hook (e.g. the user's next prompt). Accepted tradeoff: the detector's
  // rescue caused more false-positives than it fixed.
  //
  // The detector remains authoritative for agents without hook support
  // (Codex, Aider, Gemini CLI).
  //
  // Safety net: if hooks have been silent for 60s+, re-enable the detector
  // as a fallback. This prevents permanent stuck state when hooks stop
  // arriving (e.g. settings.local.json overwritten, channel lost).
  if (!hooksActive) return true;
  if (lastHookAt > 0 && Date.now() - lastHookAt > STALE_HOOK_MS) return true;
  return false;
}

/** Callbacks needed by createSessionChannel to write to the SessionManager. */
export interface SessionWriter {
  scheduleWrite(session: ManagedSession, bytes: Uint8Array): void;
  appendToBuffer(session: ManagedSession, bytes: Uint8Array): void;
}

/**
 * Create a Tauri channel wired to pump PTY events into a ManagedSession
 * and the workspace store. Shared by getOrSpawn and spawnForExisting
 * so the callback logic lives in exactly one place.
 */
export function createSessionChannel(
  writer: SessionWriter,
  session: ManagedSession,
  worktreeId: string,
  sessionKey: string,
): ReturnType<typeof createPtyChannel> {
  console.debug(`[chan-created] sessionKey=${sessionKey} worktreeId=${worktreeId} sessionId=${session.sessionId || "(pre-spawn)"}`);
  return createPtyChannel((event) => {
    switch (event.event) {
      case "output": {
        // If the user explicitly sent /clear, allow the next ESC[3J through so
        // xterm clears its own scrollback natively. Otherwise strip it to prevent
        // TUI re-renders from wiping the scrollback on every frame.
        let bytes: Uint8Array;
        if (session.allowNextClearScrollback) {
          bytes = new Uint8Array(event.data);
          // Consume the flag as soon as we find ESC[3J in this chunk.
          // Any additional ESC[3J sequences in the same chunk also pass through
          // unstripped, which is fine — Claude Code emits at most one per frame.
          const ESC3J = [0x1b, 0x5b, 0x33, 0x4a];
          for (let i = 0; i <= bytes.length - 4; i++) {
            if (bytes[i] === ESC3J[0] && bytes[i+1] === ESC3J[1] && bytes[i+2] === ESC3J[2] && bytes[i+3] === ESC3J[3]) {
              session.allowNextClearScrollback = false;
              break;
            }
          }
        } else {
          bytes = stripClearScrollback(new Uint8Array(event.data));
        }
        const wasFirst = session.lastOutputAt === 0;
        session.lastOutputAt = Date.now();
        if (wasFirst && session.onFirstOutput) {
          session.onFirstOutput();
          session.onFirstOutput = undefined;
        }
        writer.scheduleWrite(session, bytes);
        writer.appendToBuffer(session, bytes);
        break;
      }
      case "heartbeat": {
        session.lastHeartbeat = Date.now();
        break;
      }
      case "hookAgentState": {
        const { state, notify, phase } = event.data;
        const hookDesc = `${state}${phase !== "none" ? `(${phase})` : ""}`;
        // Update lastHookAt unconditionally (proves hook channel is alive for
        // the reconciler), but defer lastHookDesc until after the suppression
        // check so reconciler debug logs show the last *accepted* hook.
        session.lastHookAt = Date.now();
        session.hooksActive = true;

        // Suppress spurious bare-busy hooks that fire immediately after turnEnd.
        // Claude Code's internal state settles with idle(turnEnd) → idle → busy(none),
        // but the bare busy is not real work. Real new work arrives with a phase.
        if (
          state === "busy"
          && phase === "none"
          && session.turnEndAt > 0
          && Date.now() - session.turnEndAt < TURN_END_GRACE_MS
        ) {
          console.debug(`[status:${worktreeId}] bare busy SUPPRESSED (${Date.now() - session.turnEndAt}ms after turnEnd)`);
          break;
        }

        // SubagentStop can arrive after the parent's Stop has already fired
        // (async cleanup of a Task subagent). A straggler busy(subagentEnd)
        // on an already-idle session must NOT wake it back to busy — the
        // parent turn is done.
        //
        // The `break` here is load-bearing: it deliberately skips the
        // `turnEndAt` reset (preserving the bare-busy suppression window
        // for real stragglers) and the `pendingIdleTimer` cancel (which
        // only fires for non-idle states anyway, but future refactors
        // could move that assumption).
        if (
          state === "busy"
          && phase === "subagentEnd"
          && session.agentState !== "busy"
        ) {
          console.debug(`[status:${worktreeId}] straggler subagentEnd IGNORED (session is ${session.agentState})`);
          break;
        }

        session.lastHookDesc = hookDesc;

        if (phase === "turnEnd") {
          session.turnEndAt = Date.now();
        } else if (state === "busy" && phase !== "none") {
          // Real work arrived — close the bare-busy suppression window.
          session.turnEndAt = 0;
        }

        // Cancel any pending debounced idle — a new non-idle hook supersedes it.
        // Don't cancel on idle→idle transitions: turnEnd fires notify=finished,
        // then a bare idle follows — cancelling would swallow the notification.
        if (session.pendingIdleTimer !== null && state !== "idle") {
          clearTimeout(session.pendingIdleTimer);
          session.pendingIdleTimer = null;
        }

        if (state === "notRunning" && session.sessionId) {
          session.ptyExited = true;
        }

        // Debounce idle from turnEnd: Claude Code fires Stop (turnEnd) between
        // every turn — including between sub-agent completions when the parent
        // immediately starts another turn. Defer the entire state+notification
        // transition so busy(promptStart) can cancel it within the window.
        if (state === "idle" && phase === "turnEnd") {
          console.debug(`[status:${worktreeId}] hook → idle(turnEnd) DEBOUNCING ${IDLE_DEBOUNCE_MS}ms${notify !== "none" ? ` notify=${notify}` : ""}`);
          session.pendingIdleTimer = setTimeout(() => {
            session.pendingIdleTimer = null;
            session.agentState = "idle";
            stateSourceMap.set(worktreeId, "hook");
            useSessionStatusStore.getState().setSessionStatus(sessionKey, "idle");
            // each session fires its own notifications; phantoms are prevented
            // at the Rust registry level (reader-exit unregister).
            if (notify !== "none") {
              const wt = useWorkspaceStore.getState().worktrees.find((w) => w.id === worktreeId);
              if (wt) {
                fireHookNotification(wt.branch, notify);
              }
            }
          }, IDLE_DEBOUNCE_MS);
          break;
        }

        console.debug(`[status:${worktreeId}] hook → ${state}${phase !== "none" ? `(${phase})` : ""}${notify !== "none" ? ` notify=${notify}` : ""} sessionKey=${sessionKey} sessionId=${session.sessionId}`);
        session.agentState = state;
        stateSourceMap.set(worktreeId, "hook");
        useSessionStatusStore.getState().setSessionStatus(sessionKey, state);

        // Fire notification for non-turnEnd hooks (e.g. PermissionRequest).
        // turnEnd notifications are handled inside the debounce above.
        // each session fires its own notifications; phantoms are prevented
        // at the Rust registry level (reader-exit unregister).
        if (notify !== "none") {
          const wt = useWorkspaceStore.getState().worktrees.find((w) => w.id === worktreeId);
          if (wt) {
            fireHookNotification(wt.branch, notify);
          }
        }
        break;
      }
      case "agentState": {
        if (!shouldAcceptDetectorState(session.hooksActive, session.lastHookAt)) {
          console.debug(`[status:${worktreeId}] detector "${event.data}" REJECTED (hooks active)`);
          break;
        }
        const fallback = session.hooksActive;
        if (fallback) {
          console.debug(`[status:${worktreeId}] detector → ${event.data} (fallback: hooks silent ${Date.now() - session.lastHookAt}ms)`);
        } else {
          console.debug(`[status:${worktreeId}] detector → ${event.data}`);
        }
        session.agentState = event.data;
        stateSourceMap.set(worktreeId, "detector");
        useSessionStatusStore.getState().setSessionStatus(sessionKey, event.data);
        break;
      }
    }
  });
}

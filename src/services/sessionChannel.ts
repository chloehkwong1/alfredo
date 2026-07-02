import type { NotifyReason, Worktree } from "../types";
import { sendNotification } from "../hooks/notificationUtils";
import { worktreeDisplayLabel } from "../lib/worktreeDisplayLabel";
import { createPtyChannel, getAppConfig } from "../api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSessionStatusStore } from "../stores/sessionStatusStore";
import { useTabStore } from "../stores/tabStore";
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
/** Stranded-subagent self-heal threshold. subagentDepth is normally cleared by
 *  subagentEnd or the next promptStart, but a dropped SubagentStop hook (curl
 *  timeout) would strand it > 0 forever — and since the rescue paths are gated
 *  on no-work-in-flight, the session would be stuck "Running N agents…" with no
 *  recovery. If BOTH channels are silent this long, treat the count as lost.
 *  Far longer than STALE_HOOK_FORCE_MS so a genuinely long-running background
 *  agent (which streams output and keeps lastOutputAt fresh) is never healed. */
export const STALE_SUBAGENT_FORCE_MS = 300_000;
/** Stranded-monitor self-heal threshold. monitorPending is normally cleared by
 *  the agent's resume (promptStart) or notRunning. If a monitor times out or is
 *  cancelled and never wakes the agent, the flag would strand true forever and —
 *  since the rescue paths are gated on no-work-in-flight, the session would be
 *  stuck "Monitoring…". If BOTH channels are silent this long, treat it as lost.
 *  Longer than the observed 300s monitor timeout so a genuinely waiting monitor
 *  is never healed early. */
export const STALE_MONITOR_FORCE_MS = 360_000;
/** Debounce window for idle(turnEnd) transitions.
 *  Claude Code fires Stop (turnEnd) between every turn — including sub-agent
 *  completions. Defer the entire state+notification transition so a following
 *  busy(promptStart) can cancel it within this window. */
export const IDLE_DEBOUNCE_MS = 300;
/** Recency window: if a subagent hook (`subagentStart`/`subagentEnd`) arrived
 *  within this long, treat the session as still in a background-agent harvest
 *  loop and use the longer idle(turnEnd) debounce below. Comfortably above the
 *  observed ~5–15s gap between a park (turnEnd) and the agent's next resume, so
 *  the long window stays engaged across consecutive harvest cycles. */
export const SUBAGENT_ACTIVITY_RECENCY_MS = 60_000;
/** idle(turnEnd) debounce while subagent activity is recent. Claude Code does
 *  NOT reliably fire SubagentStart for background/Workflow agents (only
 *  SubagentStop), so subagentDepth under-counts, the depth>0 guard sits at 0
 *  while agents are still running, and every "park between results" Stop leaks a
 *  "finished" notification. This longer window lets the agent's next resume —
 *  busy(promptStart)/busy(toolStart), which cancel the pending timer — suppress
 *  the spurious notification; it only fires when the agent goes quiet for real.
 *  The cost is the genuine final notification landing ~this late during a
 *  background task (fine for multi-minute fan-outs); an active user never sees
 *  the delay because their next action cancels the timer. */
export const IDLE_DEBOUNCE_SUBAGENT_MS = 15_000;
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
 * Dedupe window for notifications keyed by (worktreeId, notify). Multiple tabs
 * on the same worktree each fire their own hook → one Stop becomes N banners
 * without this. Keep the window short — legitimate back-to-back turns on the
 * same worktree should still notify.
 */
const NOTIFY_DEDUPE_MS = 1500;
const lastNotifyAt = new Map<string, number>();

/**
 * Fire an OS notification for a hook event.
 * Reads config each time so changes take effect immediately.
 */
export async function fireHookNotification(
  worktree: Pick<Worktree, "path" | "branch" | "name">,
  notify: NotifyReason,
  worktreeId?: string,
) {
  if (notify === "none") return;

  if (worktreeId) {
    const key = `${worktreeId}:${notify}`;
    const now = Date.now();
    const prev = lastNotifyAt.get(key) ?? 0;
    if (now - prev < NOTIFY_DEDUPE_MS) {
      console.debug(`[notify] DEDUPED ${key} (${now - prev}ms since last)`);
      return;
    }
    lastNotifyAt.set(key, now);
  }

  const appConfig = await getAppConfig();
  const config = appConfig?.notifications;
  if (!config?.enabled) return;

  if (notify === "input" && !config.notifyOnWaiting) return;
  if ((notify === "finished" || notify === "error") && !config.notifyOnIdle) return;

  // Resolve the display name the same way the sidebar does, so a rename (which
  // writes worktreeLabels[path]) reaches the notification too. Reading raw
  // wt.branch here is what surfaced "HEAD needs your input" after a rebase.
  const branch = worktreeDisplayLabel(worktree, appConfig?.worktreeLabels?.[worktree.path]);
  const dbg = appConfig?.debugMode ? " [hook]" : "";
  const message =
    notify === "finished" ? `${branch} finished${dbg}` :
    notify === "error"    ? `${branch} stopped (error)${dbg}` :
                            `${branch} needs your input${dbg}`;

  sendNotification(message, config.sound);
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
    sendNotification(`[debug] ${message}`, config.sound);
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
 * Given the current depth, the incoming hook state, and the hook phase,
 * return the new depth. Pure function — safe to unit test.
 *
 *   promptStart / toolStart  → +1
 *   toolEnd                   → max(0, d - 1)
 *   turnEnd                   → 0 (hard reset — a turn ended, all work done)
 *   notRunning (any phase)    → 0 (PTY exited)
 *   subagentEnd               → unchanged (Task tool's toolEnd will decrement)
 *   anything else             → unchanged
 *
 * subagentEnd is intentionally NOT symmetric with toolEnd: Claude's Task
 * tool wraps subagent execution, firing PreToolUse(toolStart, +1) on entry
 * and PostToolUse(toolEnd, -1) on exit. SubagentStop fires in between and
 * is informational — decrementing here would double-count. Edge case: if
 * SubagentStop fires without a subsequent PostToolUse (e.g. Claude Code
 * crashes mid-subagent), depth is stuck > 0 until turnEnd or notRunning
 * resets it. That's the desired failure mode — better stuck-busy than
 * false-idle — and the force-path reconciler will eventually rescue once
 * the turn ends or the PTY exits.
 */
export function applyHookToDepth(
  depth: number,
  state: import("../types").AgentState,
  phase: import("../types").HookPhase,
): number {
  if (state === "notRunning") return 0;
  switch (phase) {
    case "promptStart":
    case "toolStart":
    case "monitorStart":
      return depth + 1;
    case "toolEnd":
    case "questionEnd":
      // questionEnd is AskUserQuestion/ExitPlanMode's own PostToolUse — it
      // balances the +1 from their PreToolUse (waitingForInput?phase=toolStart).
      return Math.max(0, depth - 1);
    case "turnEnd":
      return 0;
    case "subagentStart":
    case "subagentEnd":
    case "none":
    default:
      return depth;
  }
}

/**
 * Background-subagent counter. Tracks how many Task/background subagents the
 * main agent has in flight, independent of workDepth (tools).
 *
 *   subagentStart            → +1
 *   subagentEnd              → max(0, d - 1)
 *   promptStart              → 0 (new user turn — any prior subagents are done)
 *   notRunning (any phase)   → 0 (PTY exited)
 *   anything else            → unchanged
 *
 * Crucially NOT reset on turnEnd: Claude Code fires Stop (turnEnd) the moment
 * the main agent dispatches background agents and yields, while the subagents
 * keep running. The count must survive that Stop so the idle transition can be
 * suppressed (see the hook handler). promptStart is the self-heal boundary — a
 * fresh user turn means a dropped subagentEnd can't strand the counter forever.
 * Pure function — safe to unit test.
 */
export function applySubagentDepth(
  depth: number,
  state: import("../types").AgentState,
  phase: import("../types").HookPhase,
): number {
  if (state === "notRunning") return 0;
  switch (phase) {
    case "subagentStart":
      return depth + 1;
    case "subagentEnd":
      return Math.max(0, depth - 1);
    case "promptStart":
      return 0;
    default:
      return depth;
  }
}

/**
 * Monitor-pending flag. The Claude Code `Monitor` tool registers a background
 * watch and returns immediately — there is NO hook when the monitor later
 * completes, so this cannot be a balanced counter. It is a sticky flag:
 *
 *   monitorStart  → true   (Monitor tool's PreToolUse)
 *   promptStart   → false  (agent resumed / fresh turn — the self-heal boundary)
 *   notRunning    → false  (PTY exited)
 *   anything else → unchanged
 *
 * Crucially NOT reset on `turnEnd`: Claude Code fires Stop the moment the agent
 * parks on the monitor, and the flag must survive that Stop so the idle
 * transition can be suppressed (see the hook handler). Mirrors applySubagentDepth.
 * Pure function — safe to unit test.
 */
export function applyMonitorPending(
  pending: boolean,
  state: import("../types").AgentState,
  phase: import("../types").HookPhase,
): boolean {
  if (state === "notRunning") return false;
  switch (phase) {
    case "monitorStart":
      return true;
    case "promptStart":
      return false;
    default:
      return pending;
  }
}

/**
 * Awaiting-answer flag. AskUserQuestion (and ExitPlanMode) park the agent on a
 * TUI prompt; their PreToolUse posts `waitingForInput?phase=toolStart`. While
 * parked, concurrent background subagents keep firing busy hooks under the
 * same session id and would clobber the displayed waitingForInput (live trace
 * 2026-07-02, session 88e70a3c). Sticky flag semantics:
 *
 *   waitingForInput(toolStart) → true   (the question/plan-approval parks)
 *   questionEnd                → false  (its own PostToolUse — parent-only,
 *                                        subagents cannot ask the user)
 *   notRunning                 → false  (PTY exited)
 *   anything else              → unchanged
 *
 * Deliberately NOT cleared on `turnEnd` (a straggler Stop fires while parked —
 * trace 13:20:22) and NOT on `promptStart` (task-notifications are delivered
 * as user turns and fire UserPromptSubmit while the question is still parked —
 * trace 13:20:44; the hook's stdin carries no prompt text, so auto-injected
 * turns are indistinguishable at the hook layer). The user-side self-heal is
 * the local Enter/Esc keystroke clear in usePty — the only way to answer or
 * cancel the prompt, and something an auto-injected turn cannot fake.
 * Notification-sourced waitingForInput (permission prompts, phase=none) does
 * NOT set the flag: it has no parent-only resolution marker, so pinning it
 * could stick. Pure function — safe to unit test.
 */
export function applyAwaitingAnswer(
  awaiting: boolean,
  state: import("../types").AgentState,
  phase: import("../types").HookPhase,
): boolean {
  if (state === "notRunning") return false;
  if (state === "waitingForInput" && phase === "toolStart") return true;
  if (phase === "questionEnd") return false;
  return awaiting;
}

/**
 * Structural proof that work is in flight: a foreground tool (workDepth) or a
 * background/Task subagent (subagentDepth). While this holds, the reconciler
 * refuses to stale-rescue and the detector fallback refuses to flip the session
 * idle — both would otherwise false-idle a session that is genuinely working.
 * Single definition so every gate reads the same predicate.
 */
export function hasWorkInFlight(
  session: Pick<ManagedSession, "workDepth" | "subagentDepth" | "monitorPending">,
): boolean {
  return session.workDepth > 0 || session.subagentDepth > 0 || session.monitorPending;
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
      case "title": {
        useTabStore.getState().setTabTitle(worktreeId, sessionKey, event.data ?? null);
        break;
      }
      case "process": {
        useTabStore.getState().setTabProcess(worktreeId, sessionKey, event.data ?? null);
        break;
      }
      case "cwd": {
        useTabStore.getState().setTabCwd(worktreeId, sessionKey, event.data ?? null);
        break;
      }
      case "hookAgentState": {
        const { state, notify, phase } = event.data;
        const hookDesc = `${state}${phase !== "none" ? `(${phase})` : ""}`;
        // Diagnostic: log hook arrival with delta since last turnEnd. Helps
        // identify stragglers (e.g. busy(toolEnd) arriving seconds after
        // turnEnd) that flip an idle session back to busy.
        const sinceTurnEnd = session.turnEndAt > 0 ? Date.now() - session.turnEndAt : -1;
        console.debug(
          `[hook-arrive:${worktreeId}] ${hookDesc} notify=${notify} sinceTurnEnd=${sinceTurnEnd}ms agentState=${session.agentState} sessionKey=${sessionKey}`
        );
        // Update lastHookAt unconditionally (proves hook channel is alive for
        // the reconciler), but defer lastHookDesc until after the suppression
        // check so reconciler debug logs show the last *accepted* hook.
        session.lastHookAt = Date.now();
        session.hooksActive = true;
        // Hook channel is alive again — clear any stale-hook notification dedupe
        // so a future channel death triggers a fresh notification.
        session.staleHookNotifiedAt = 0;
        // Invariant: depth is updated BEFORE any suppression `break` — depth
        // reflects hook reality, not display reality. This is only safe while
        // every depth-mutating phase is != "none": bare busy(none) is depth-
        // neutral, so the bare-busy suppression below can't strand the counter.
        // If a future phase ever mutates depth at phase="none", move this
        // line after the suppression check.
        session.workDepth = applyHookToDepth(session.workDepth, state, phase);
        // Background-subagent counter, tracked separately from workDepth and on
        // the same "before any suppression break" line — every subagent phase is
        // != "none" so this never strands the counter.
        session.subagentDepth = applySubagentDepth(session.subagentDepth, state, phase);
        // Monitor-pending flag, updated on the same pre-suppression line — set on
        // monitorStart, cleared on promptStart/notRunning, deliberately survives
        // turnEnd (the parking Stop) so the idle transition can be suppressed.
        session.monitorPending = applyMonitorPending(session.monitorPending, state, phase);
        // Awaiting-answer flag, same pre-suppression line. Set when
        // AskUserQuestion/ExitPlanMode park the agent, cleared by their own
        // PostToolUse (questionEnd) — MUST update before the questionEnd hook
        // reaches the busy display gate below so the resume becomes visible.
        session.awaitingAnswer = applyAwaitingAnswer(session.awaitingAnswer, state, phase);
        // Record subagent activity (start OR end) before any suppression break.
        // SubagentStop is reliable where SubagentStart is not, so subagentEnd is
        // the load-bearing signal here: it proves the session was recently doing
        // background work even when no matching subagentStart ever incremented
        // the counter. Drives the adaptive idle(turnEnd) debounce below.
        if (phase === "subagentStart" || phase === "subagentEnd") {
          session.lastSubagentActivityAt = Date.now();
        }

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

        // Stop fired while background subagents are running OR a monitor is
        // pending. In both cases the agent parked itself and will resume — keep
        // the session busy and swallow the "finished" notification (this break
        // is BEFORE the notification-firing debounce below). subagentDepth is
        // cleared by subagentEnd/promptStart; monitorPending by promptStart.
        // awaitingAnswer joins the suppression: a straggler Stop fires while the
        // agent is parked on a question (live trace 2026-07-02 13:20:22) — the
        // turn is not finished for the user, so neither the idle display nor the
        // "finished" notification may land while the question is unanswered.
        if (state === "idle" && phase === "turnEnd" && (session.subagentDepth > 0 || session.monitorPending || session.awaitingAnswer)) {
          console.debug(`[status:${worktreeId}] idle(turnEnd) SUPPRESSED — subagentDepth=${session.subagentDepth} monitorPending=${session.monitorPending} awaitingAnswer=${session.awaitingAnswer}`);
          if (session.pendingIdleTimer !== null) {
            clearTimeout(session.pendingIdleTimer);
            session.pendingIdleTimer = null;
          }
          break;
        }

        // Busy display gate: while parked on AskUserQuestion/ExitPlanMode, busy
        // hooks come from concurrent background subagents (and auto-injected
        // task-notification turns), not from the parent — counters above stay
        // accurate, but the displayed state must remain waitingForInput. A
        // questionEnd never reaches this gate: applyAwaitingAnswer already
        // cleared the flag on the pre-suppression line.
        if (session.awaitingAnswer && state === "busy") {
          console.debug(`[status:${worktreeId}] busy(${phase}) display-SUPPRESSED — awaitingAnswer`);
          break;
        }

        session.lastHookDesc = hookDesc;

        if (phase === "turnEnd") {
          session.turnEndAt = Date.now();
        } else if (state === "busy" && phase !== "none") {
          // Real work arrived — close the bare-busy suppression window.
          session.turnEndAt = 0;
        }

        // Cancel any pending debounced idle — but only on genuine forward
        // progress (the agent resumed real work or now needs the user). A
        // "completion straggler" — busy(toolEnd) from a late PostToolUse /
        // PermissionDenied, busy(subagentEnd) from a late SubagentStop, or a
        // bare busy(none) settle — is NOT forward progress: arriving within the
        // (now longer) debounce window after the real final turnEnd it would
        // otherwise cancel the timer and permanently swallow the "finished"
        // notification. Don't cancel on idle→idle either: turnEnd fires
        // notify=finished, then a bare idle follows — cancelling would swallow it.
        const isCompletionStraggler =
          state === "busy" && (phase === "toolEnd" || phase === "subagentEnd" || phase === "none");
        if (session.pendingIdleTimer !== null && state !== "idle" && !isCompletionStraggler) {
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
          // Single-timer invariant: a second idle(turnEnd) reaches here without
          // hitting the forward-progress cancel above (state is "idle"), so clear
          // any timer a prior turnEnd left pending before scheduling a new one.
          // Otherwise the old timer is orphaned but still fires → double idle
          // transition and a duplicate "finished" notification.
          if (session.pendingIdleTimer !== null) {
            clearTimeout(session.pendingIdleTimer);
            session.pendingIdleTimer = null;
          }
          // Adaptive window: while subagent activity is recent, the agent is
          // likely parked between background-agent results and will resume in
          // seconds. subagentDepth under-counts (SubagentStart is unreliable),
          // so we can't rely on the depth>0 hard-suppress alone — use the long
          // window and let the resume cancel the timer. Normal turns (no recent
          // subagent activity) keep the snappy 300ms window.
          const recentSubagentActivity =
            session.lastSubagentActivityAt > 0
            && Date.now() - session.lastSubagentActivityAt < SUBAGENT_ACTIVITY_RECENCY_MS;
          const debounceMs = recentSubagentActivity ? IDLE_DEBOUNCE_SUBAGENT_MS : IDLE_DEBOUNCE_MS;
          console.debug(`[status:${worktreeId}] hook → idle(turnEnd) DEBOUNCING ${debounceMs}ms${recentSubagentActivity ? " (subagent-recent)" : ""}${notify !== "none" ? ` notify=${notify}` : ""}`);
          session.pendingIdleTimer = setTimeout(() => {
            session.pendingIdleTimer = null;
            session.agentState = "idle";
            session.hookDerivedState = "idle";
            stateSourceMap.set(worktreeId, "hook");
            useSessionStatusStore.getState().setSessionStatus(sessionKey, "idle");
            // each session fires its own notifications; phantoms are prevented
            // at the Rust registry level (reader-exit unregister).
            if (notify !== "none") {
              const wt = useWorkspaceStore.getState().worktrees.find((w) => w.id === worktreeId);
              if (wt) {
                fireHookNotification(wt, notify, worktreeId);
              }
            }
          }, debounceMs);
          break;
        }

        console.debug(`[status:${worktreeId}] hook → ${state}${phase !== "none" ? `(${phase})` : ""}${notify !== "none" ? ` notify=${notify}` : ""} depth=${session.workDepth} sessionKey=${sessionKey} sessionId=${session.sessionId}`);
        session.agentState = state;
        session.hookDerivedState = state;
        stateSourceMap.set(worktreeId, "hook");
        useSessionStatusStore.getState().setSessionStatus(sessionKey, state);

        // Fire notification for non-turnEnd hooks (e.g. PermissionRequest).
        // turnEnd notifications are handled inside the debounce above.
        // each session fires its own notifications; phantoms are prevented
        // at the Rust registry level (reader-exit unregister).
        if (notify !== "none") {
          const wt = useWorkspaceStore.getState().worktrees.find((w) => w.id === worktreeId);
          if (wt) {
            fireHookNotification(wt, notify, worktreeId);
          }
        }
        break;
      }
      case "agentState": {
        if (!shouldAcceptDetectorState(session.hooksActive, session.lastHookAt)) {
          console.debug(`[status:${worktreeId}] detector "${event.data}" REJECTED (hooks active)`);
          break;
        }
        // Mute detector while hooks have definitively declared idle. The 60s
        // stale-hook fallback above otherwise re-engages the detector, which
        // misreads Claude Code's TUI redraws as "busy" — triggering the
        // reconciler's force-idle rescue 500ms later in a flicker loop. Only
        // the idle→busy false-flip is the problem; when the last hook was
        // busy or waitingForInput, the fallback is still the right escape
        // hatch for a dead hook channel.
        if (session.hookDerivedState === "idle") {
          console.debug(`[status:${worktreeId}] detector "${event.data}" REJECTED (last hook-derived state = idle)`);
          break;
        }
        // Symmetric mute for the busy-with-open-work case. During a long LLM
        // stream after the last tool call (e.g. `/read-plan` printing a huge
        // plan), no hooks fire for minutes; after STALE_HOOK_MS the detector
        // unmutes and misreads Claude Code's `❯` prompt redraws as idle, then
        // the next text chunk as busy → sidebar flickers busy/idle/done at a
        // few-second cadence. hasWorkInFlight means hooks structurally proved
        // work is still open — a foreground tool (workDepth) OR a background
        // subagent (subagentDepth). The latter is the common case here: real
        // background agents fire no parent tool-hooks, so a >60s run goes
        // hook-silent, the detector unmutes, and without the subagentDepth
        // arm it would false-flip the session to idle mid-run. The reconciler
        // already trusts this same predicate (sessionManager rescue gates).
        if (session.hookDerivedState === "busy" && hasWorkInFlight(session)) {
          console.debug(`[status:${worktreeId}] detector "${event.data}" REJECTED (hook=busy, workDepth=${session.workDepth}, subagentDepth=${session.subagentDepth})`);
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

import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";
import type { WebglAddon } from "@xterm/addon-webgl";
import type { AgentState } from "../types";

/** Maximum bytes retained in the circular output buffer for replay on re-attach. */
export const OUTPUT_BUFFER_CAPACITY = 50_000;

export interface ManagedSession {
  sessionId: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  /** True once the WebGL renderer has been loaded (or failed). */
  webglLoaded: boolean;
  /** Reference to the active WebGL addon, if loaded. Null when WebGL is
   *  unavailable or after onContextLoss has disposed it. Retained so user
   *  recovery actions (⌘⇧K) can call clearTextureAtlas() to recover from
   *  rare atlas/cell-buffer desyncs that survive scroll + refresh. */
  webglAddon: WebglAddon | null;
  agentState: AgentState;
  /** True once at least one hook event has been received. When true,
   *  ALL detector-sourced state updates are ignored — hooks are the
   *  sole source of truth for agent state. */
  hooksActive: boolean;
  /** Circular buffer of recent output bytes for replay when re-attaching a UI. */
  outputBuffer: Uint8Array;
  /** Current write position in the circular buffer. */
  outputBufferPos: number;
  /** Total bytes written (used to determine if buffer has wrapped). */
  outputBufferTotal: number;
  /** Timestamp of the last heartbeat received from the PTY channel. */
  lastHeartbeat: number;
  /** True once the PTY process has exited (reader thread sent NotRunning).
   *  Used to prevent refreshHeartbeats from reviving dead sessions on wake. */
  ptyExited: boolean;
  /** Timestamp of the last PTY output received. Used to detect stale busy state. */
  lastOutputAt: number;
  /** Pending output chunks awaiting drain into xterm. Drained via xterm's
   *  write() callback so we apply back-pressure: only one write is in flight
   *  at a time, and the next write is issued when xterm reports the previous
   *  one as parsed. Prevents unbounded growth of xterm's internal WriteBuffer
   *  when PTY output exceeds parse+render throughput (e.g. `rails console`). */
  pendingOutput: Uint8Array[];
  /** True while an xterm.write() call is awaiting its parsed-callback. While
   *  set, new output is queued on pendingOutput instead of handed to xterm. */
  writeInFlight: boolean;
  /** Set by closeSession before terminal.dispose() so the write-drain callback
   *  bails out instead of calling write() on a disposed terminal. */
  disposed: boolean;
  /** Whether this session was restored from saved scrollback (for auto-resume). */
  restoredFromScrollback: boolean;
  /** True once a startup command has been written to this session's PTY.
   *  Prevents StrictMode double-fire from executing the command twice. */
  startupCommandSent: boolean;
  /** When true, the next ESC[3J in PTY output is passed through to xterm instead
   *  of being stripped. Set when the user explicitly sends /clear. */
  allowNextClearScrollback: boolean;
  /** Timestamp of the most recent hook event received from Rust. Used by the
   *  global reconciler to distinguish "hook channel silent" from "hook channel
   *  flowing but state is stuck". Zero until the first hook event arrives. */
  lastHookAt: number;
  /** Description of the most recent hook event, for debug diagnostics.
   *  Stored so the reconciler can report what the last hook was when
   *  it rescues a stuck busy state. */
  lastHookDesc: string;
  /** The most recent agent state declared by a hook event (i.e. a state
   *  transition actually applied by the hook handler — suppressed hooks
   *  don't count). Null until the first hook-driven transition. Used to
   *  mute detector events when hooks have definitively declared idle,
   *  preventing the detector/reconciler race that flickers the status
   *  badge and spams `[debug] stuck busy rescued` notifications. */
  hookDerivedState: AgentState | null;
  /** Debounce timer for idle transitions from Stop/StopFailure hooks.
   *  Subagent Stop hooks fire idle before the parent's PostToolUse fires busy,
   *  causing a false idle flash. We hold the idle for a short window and discard
   *  it if a non-idle hook arrives in time. */
  pendingIdleTimer: ReturnType<typeof setTimeout> | null;
  /** Timestamp of the last turnEnd hook. Used to suppress spurious bare-busy
   *  hooks that Claude Code fires immediately after a turn ends (internal state
   *  settling, not real work). Zero until the first turnEnd. */
  turnEndAt: number;
  /** Turns/tools currently in flight. Incremented on `promptStart` and
   *  `toolStart`; decremented on `toolEnd` (clamped ≥0); hard-reset on
   *  `turnEnd` and `notRunning`. While > 0 the reconciler is forbidden
   *  from flipping busy → idle, regardless of hook or output silence. */
  workDepth: number;
  /** Background/Task subagents currently in flight. Incremented on
   *  `subagentStart`, decremented on `subagentEnd` (clamped ≥0), reset to 0 on
   *  `promptStart` (new user turn — any prior subagents are done) and
   *  `notRunning`. Deliberately NOT reset on `turnEnd`: the main agent fires
   *  Stop the moment it dispatches background agents and yields, so the count
   *  must survive that Stop. While > 0, the idle transition is suppressed (the
   *  session is parked waiting on subagents) and the reconciler is forbidden
   *  from stale-rescuing — same role workDepth plays for foreground tools. */
  subagentDepth: number;
  /** Timestamp of the last subagent hook (`subagentStart` or `subagentEnd`).
   *  Claude Code does NOT reliably fire SubagentStart for background/Workflow
   *  agents (only SubagentStop), so subagentDepth under-counts and the depth>0
   *  idle-suppression leaks "finished" notifications on every harvest cycle.
   *  When this is recent, the idle(turnEnd) debounce uses a longer window so the
   *  agent's next resume can cancel a spurious notification. Zero until the
   *  first subagent hook. */
  lastSubagentActivityAt: number;
  /** Optional callback fired once when the first output byte arrives. */
  onFirstOutput?: () => void;
  /** Diagnostic: consecutive drainPending dispatches since the queue last
   *  emptied. High values suggest the drain loop is starving the event loop. */
  pasteDiagDrainChain: number;
  /** Diagnostic: timestamp of the last [paste-diag] log line, used for rate
   *  limiting so a sustained stall logs at most once per second per session. */
  pasteDiagLastLogAt: number;
  /** Timestamp at which the reconciler last surfaced a "hook channel silent"
   *  notification for this session. Reset to 0 when a fresh hook arrives.
   *  Used to dedupe the debug notification — the reconciler runs every 500ms
   *  and the stale-hook condition stays true for the entire duration. */
  staleHookNotifiedAt: number;
}

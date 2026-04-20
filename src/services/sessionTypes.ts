import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";
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
  /** Pending output chunks awaiting the next animation frame flush. */
  pendingOutput: Uint8Array[];
  /** Whether a requestAnimationFrame flush is already scheduled. */
  writeScheduled: boolean;
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
  /** Optional callback fired once when the first output byte arrives. */
  onFirstOutput?: () => void;
}

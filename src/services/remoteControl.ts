import { writePty } from "../api";
import { useRemoteControlStore } from "../stores/remoteControlStore";
import { sessionManager } from "./sessionManager";

const SESSION_URL_RE = /https:\/\/claude\.ai\/code\/[^\s\x1b]+/;

/** Active polling intervals per worktreeId — cleared on re-toggle or disable. */
const activePolls = new Map<string, ReturnType<typeof setInterval>>();

function clearPoll(worktreeId: string) {
  const existing = activePolls.get(worktreeId);
  if (existing) {
    clearInterval(existing);
    activePolls.delete(worktreeId);
  }
}

async function toggleRemoteControl(
  worktreeId: string,
  sessionKey: string,
): Promise<void> {
  const store = useRemoteControlStore.getState();
  const session = sessionManager.getSession(sessionKey);
  if (!session || !session.sessionId) return;

  if (store.isActive(worktreeId)) {
    clearPoll(worktreeId);
    store.disable(worktreeId);
    return;
  }

  // Clear any stale poll from a previous attempt
  clearPoll(worktreeId);

  session.waitingForInput = false;
  const bytes = Array.from(new TextEncoder().encode("/remote-control\r"));
  await writePty(session.sessionId, bytes);

  const startTime = Date.now();
  const pollInterval = setInterval(() => {
    const current = sessionManager.getSession(sessionKey);
    if (!current) {
      clearPoll(worktreeId);
      return;
    }

    const buf = current.outputBuffer;
    const total = current.outputBufferTotal;
    const pos = current.outputBufferPos;
    const capacity = buf.length;

    let recentBytes: Uint8Array;
    if (total <= capacity) {
      recentBytes = buf.slice(0, pos);
    } else {
      recentBytes = new Uint8Array(capacity);
      recentBytes.set(buf.slice(pos), 0);
      recentBytes.set(buf.slice(0, pos), capacity - pos);
    }

    const recentText = new TextDecoder().decode(recentBytes);
    const match = recentText.match(SESSION_URL_RE);
    if (match) {
      store.enable(worktreeId, match[0]);
      clearPoll(worktreeId);
      return;
    }

    if (Date.now() - startTime > 10_000) {
      clearPoll(worktreeId);
      console.warn("[RemoteControl] Timed out waiting for session URL");
    }
  }, 500);

  activePolls.set(worktreeId, pollInterval);
}

export { toggleRemoteControl };

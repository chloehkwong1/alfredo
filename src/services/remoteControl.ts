import { writePty } from "../api";
import { useRemoteControlStore } from "../stores/remoteControlStore";
import { sessionManager } from "./sessionManager";

const SESSION_URL_RE = /https:\/\/claude\.ai\/code\/[^\s\x1b]+/;

async function toggleRemoteControl(
  worktreeId: string,
  sessionKey: string,
): Promise<void> {
  const store = useRemoteControlStore.getState();
  const session = sessionManager.getSession(sessionKey);
  if (!session || !session.sessionId) return;

  if (store.isActive(worktreeId)) {
    store.disable(worktreeId);
    return;
  }

  const bytes = Array.from(new TextEncoder().encode("/remote-control\n"));
  await writePty(session.sessionId, bytes);

  const startTime = Date.now();
  const pollInterval = setInterval(() => {
    const current = sessionManager.getSession(sessionKey);
    if (!current) {
      clearInterval(pollInterval);
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
      clearInterval(pollInterval);
      return;
    }

    if (Date.now() - startTime > 10_000) {
      clearInterval(pollInterval);
      console.warn("[RemoteControl] Timed out waiting for session URL");
    }
  }, 500);
}

export { toggleRemoteControl };

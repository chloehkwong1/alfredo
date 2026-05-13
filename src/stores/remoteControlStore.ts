import { create } from "zustand";

interface RemoteControlSession {
  sessionUrl: string;
  /** Whether a remote device is actively connected (future use). */
  connected: boolean;
}

interface RemoteControlState {
  /** Map of sessionKey (Claude tab id) → active remote-control session. */
  sessions: Record<string, RemoteControlSession>;
  /** Set a session as RC-active with the parsed session URL. */
  enable: (sessionKey: string, sessionUrl: string) => void;
  /** Remove RC state for a session. */
  disable: (sessionKey: string) => void;
  /** Check if a session has RC enabled. */
  isActive: (sessionKey: string) => boolean;
}

const useRemoteControlStore = create<RemoteControlState>((set, get) => ({
  sessions: {},
  enable: (sessionKey, sessionUrl) =>
    set((s) => ({
      sessions: { ...s.sessions, [sessionKey]: { sessionUrl, connected: false } },
    })),
  disable: (sessionKey) =>
    set((s) => {
      const { [sessionKey]: _, ...rest } = s.sessions;
      return { sessions: rest };
    }),
  isActive: (sessionKey) => sessionKey in get().sessions,
}));

export { useRemoteControlStore };
export type { RemoteControlSession, RemoteControlState };

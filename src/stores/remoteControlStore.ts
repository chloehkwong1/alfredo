import { create } from "zustand";

interface RemoteControlSession {
  sessionUrl: string;
  /** Whether a remote device is actively connected (future use). */
  connected: boolean;
}

interface RemoteControlState {
  /** Map of worktreeId → active remote-control session. */
  sessions: Record<string, RemoteControlSession>;
  /** Set a worktree as RC-active with the parsed session URL. */
  enable: (worktreeId: string, sessionUrl: string) => void;
  /** Remove RC state for a worktree. */
  disable: (worktreeId: string) => void;
  /** Check if a worktree has RC enabled. */
  isActive: (worktreeId: string) => boolean;
}

const useRemoteControlStore = create<RemoteControlState>((set, get) => ({
  sessions: {},
  enable: (worktreeId, sessionUrl) =>
    set((s) => ({
      sessions: { ...s.sessions, [worktreeId]: { sessionUrl, connected: false } },
    })),
  disable: (worktreeId) =>
    set((s) => {
      const { [worktreeId]: _, ...rest } = s.sessions;
      return { sessions: rest };
    }),
  isActive: (worktreeId) => worktreeId in get().sessions,
}));

export { useRemoteControlStore };
export type { RemoteControlSession, RemoteControlState };

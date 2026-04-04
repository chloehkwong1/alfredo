import { create } from "zustand";
import { detectAvailableAgents } from "../api";

interface AgentStoreState {
  availableAgents: string[];
  loaded: boolean;
  refresh: () => Promise<void>;
}

export const useAgentStore = create<AgentStoreState>((set) => ({
  availableAgents: [],
  loaded: false,
  refresh: async () => {
    try {
      const agents = await detectAvailableAgents();
      set({ availableAgents: agents, loaded: true });
    } catch (e) {
      console.error("[AgentStore] failed to detect agents:", e);
      set({ availableAgents: ["claudeCode"], loaded: true });
    }
  },
}));

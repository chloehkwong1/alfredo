import { create } from "zustand";
import type { FileViewMode } from "../types";

const STORAGE_KEY = "alfredo.fileViewModes";

function loadFromStorage(): Record<string, FileViewMode> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, FileViewMode> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === "diff" || value === "rendered") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function saveToStorage(modes: Record<string, FileViewMode>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(modes));
  } catch {
    // localStorage may be unavailable / full — silently skip persistence.
  }
}

interface FileViewModeState {
  modes: Record<string, FileViewMode>;
  setMode: (filePath: string, mode: FileViewMode) => void;
}

const useFileViewModeStore = create<FileViewModeState>((set) => ({
  modes: loadFromStorage(),
  setMode: (filePath, mode) =>
    set((s) => {
      const next = { ...s.modes, [filePath]: mode };
      saveToStorage(next);
      return { modes: next };
    }),
}));

export { useFileViewModeStore };
export type { FileViewModeState };

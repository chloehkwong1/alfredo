export interface TerminalPreferences {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  cursorStyle: "block" | "underline" | "bar";
  cursorBlink: boolean;
}

const STORAGE_KEY = "alfredo:terminalPreferences";

export const TERMINAL_DEFAULTS: TerminalPreferences = {
  fontFamily: "JetBrains Mono",
  fontSize: 13,
  lineHeight: 1.2,
  letterSpacing: 0,
  cursorStyle: "block",
  cursorBlink: true,
};

export function loadTerminalPreferences(): TerminalPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...TERMINAL_DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return TERMINAL_DEFAULTS;
}

export function saveTerminalPreferences(prefs: TerminalPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  window.dispatchEvent(new CustomEvent("terminal-preferences-changed", { detail: prefs }));
}

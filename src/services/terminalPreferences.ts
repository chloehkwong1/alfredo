import type { ITheme } from "@xterm/xterm";

export type TerminalColorScheme = "alfredo" | "ghostty";

export const TERMINAL_COLOR_SCHEMES: ReadonlyArray<{
  id: TerminalColorScheme;
  name: string;
  description: string;
  theme: ITheme;
}> = [
  {
    id: "alfredo",
    name: "Alfredo",
    description: "The original xterm palette",
    theme: {
      foreground: "#ffffff",
      background: "#000000",
      cursor: "#ffffff",
      cursorAccent: "#000000",
      selectionBackground: "rgba(255, 255, 255, 0.3)",
      black: "#2e3436",
      red: "#cc0000",
      green: "#4e9a06",
      yellow: "#c4a000",
      blue: "#3465a4",
      magenta: "#75507b",
      cyan: "#06989a",
      white: "#d3d7cf",
      brightBlack: "#555753",
      brightRed: "#ef2929",
      brightGreen: "#8ae234",
      brightYellow: "#fce94f",
      brightBlue: "#729fcf",
      brightMagenta: "#ad7fa8",
      brightCyan: "#34e2e2",
      brightWhite: "#eeeeec",
    },
  },
  {
    id: "ghostty",
    name: "Ghostty",
    description: "Ghostty's default dark palette",
    theme: {
      foreground: "#ffffff",
      background: "#282c34",
      cursor: "#ffffff",
      cursorAccent: "#282c34",
      selectionBackground: "rgba(255, 255, 255, 0.3)",
      black: "#1d1f21",
      red: "#cc6666",
      green: "#b5bd68",
      yellow: "#f0c674",
      blue: "#81a2be",
      magenta: "#b294bb",
      cyan: "#8abeb7",
      white: "#c5c8c6",
      brightBlack: "#666666",
      brightRed: "#d54e53",
      brightGreen: "#b9ca4a",
      brightYellow: "#e7c547",
      brightBlue: "#7aa6da",
      brightMagenta: "#c397d8",
      brightCyan: "#70c0b1",
      brightWhite: "#eaeaea",
    },
  },
] as const;

export function resolveTerminalTheme(scheme: TerminalColorScheme): ITheme {
  return TERMINAL_COLOR_SCHEMES.find((candidate) => candidate.id === scheme)?.theme
    ?? TERMINAL_COLOR_SCHEMES[0].theme;
}

export interface TerminalPreferences {
  colorScheme: TerminalColorScheme;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  cursorStyle: "block" | "underline" | "bar";
  cursorBlink: boolean;
}

const STORAGE_KEY = "alfredo:terminalPreferences";

export const TERMINAL_DEFAULTS: TerminalPreferences = {
  colorScheme: "alfredo",
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

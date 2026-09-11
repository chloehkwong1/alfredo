import { beforeEach, describe, expect, it } from "vitest";
import {
  TERMINAL_DEFAULTS,
  loadTerminalPreferences,
  resolveTerminalTheme,
} from "./terminalPreferences";

describe("terminal colour schemes", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("preserves the original palette as the default", () => {
    expect(resolveTerminalTheme("alfredo")).toMatchObject({
      background: "#000000",
      foreground: "#ffffff",
      red: "#cc0000",
      brightBlue: "#729fcf",
    });
  });

  it("maps Ghostty's default dark palette", () => {
    expect(resolveTerminalTheme("ghostty")).toMatchObject({
      background: "#282c34",
      foreground: "#ffffff",
      red: "#cc6666",
      brightBlue: "#7aa6da",
    });
  });

  it("adds the default scheme to preferences saved before themes existed", () => {
    localStorage.setItem("alfredo:terminalPreferences", JSON.stringify({ fontSize: 16 }));

    expect(loadTerminalPreferences()).toEqual({
      ...TERMINAL_DEFAULTS,
      fontSize: 16,
    });
  });
});

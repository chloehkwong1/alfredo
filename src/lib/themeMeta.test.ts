import { describe, it, expect, afterEach } from "vitest";
import { LIGHT_THEMES, isLightTheme, readCurrentThemeMode } from "./themeMeta";

describe("themeMeta", () => {
  afterEach(() => document.documentElement.removeAttribute("data-theme"));

  it("registers exactly the three light themes", () => {
    expect([...LIGHT_THEMES].sort()).toEqual([
      "catppuccin-latte", "everforest-light", "light",
    ]);
  });

  it("isLightTheme is true only for registered light themes", () => {
    expect(isLightTheme("light")).toBe(true);
    expect(isLightTheme("catppuccin-latte")).toBe(true);
    expect(isLightTheme("everforest-light")).toBe(true);
    expect(isLightTheme("warm-dark")).toBe(false);
    expect(isLightTheme("catppuccin")).toBe(false);
    expect(isLightTheme(null)).toBe(false);
    expect(isLightTheme(undefined)).toBe(false);
  });

  it("readCurrentThemeMode reads the data-theme attribute", () => {
    expect(readCurrentThemeMode()).toBe("dark"); // no attribute = warm-dark
    document.documentElement.setAttribute("data-theme", "everforest-light");
    expect(readCurrentThemeMode()).toBe("light");
    document.documentElement.setAttribute("data-theme", "gruvbox");
    expect(readCurrentThemeMode()).toBe("dark");
  });
});

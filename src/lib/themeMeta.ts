/**
 * Single source of truth for which theme ids render on light surfaces.
 * Keep in sync with the theme blocks in src/styles/themes.css and the
 * dot-glow selector list in src/styles/globals.css.
 */
export const LIGHT_THEMES: ReadonlySet<string> = new Set([
  "light",
  "catppuccin-latte",
  "everforest-light",
]);

export function isLightTheme(theme: string | null | undefined): boolean {
  return theme != null && LIGHT_THEMES.has(theme);
}

/** Resolve the live mode from the DOM (no attribute = warm-dark = dark). */
export function readCurrentThemeMode(): "light" | "dark" {
  if (typeof document === "undefined") return "dark";
  return isLightTheme(document.documentElement.getAttribute("data-theme"))
    ? "light"
    : "dark";
}

import FontFaceObserver from "fontfaceobserver";

// Must be preloaded before any xterm terminal mounts, otherwise WebGL atlases
// get baked against the fallback font and render garbled glyphs until the
// atlas is rebuilt (GH#19). `document.fonts.load` is not sufficient — it
// resolves on file decode, not canvas-rasterization readiness.
// FontFaceObserver verifies readiness by measuring canvas text metrics
// against the fallback.
// Keep in sync with the @font-face blocks in src/styles/globals.css.
const BUNDLED_FAMILIES = ["JetBrains Mono", "Fira Code", "Cascadia Code"];

const PRELOAD_TIMEOUT_MS = 3000;

export async function preloadTerminalFonts(): Promise<void> {
  const loads = BUNDLED_FAMILIES.flatMap((family) => [
    new FontFaceObserver(family).load(null, PRELOAD_TIMEOUT_MS),
    new FontFaceObserver(family, { weight: 700 }).load(null, PRELOAD_TIMEOUT_MS),
  ]);
  await Promise.allSettled(loads);
}

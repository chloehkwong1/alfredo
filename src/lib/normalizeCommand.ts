/**
 * Tidy a command being typed into a script field without changing what it
 * runs: collapse runs of spaces/tabs, strip indentation after line breaks,
 * and trim the edges — but KEEP newlines. They're the statement separator;
 * the old `\s+ → " "` version turned the now-legitimate multi-line script
 * `npm install\ncd src-tauri && cargo fetch` into a single line that asks npm
 * for packages named "cd" and "src-tauri" (the corruption 8001bb57 fixed
 * backend-side) on every keystroke in the settings dialog.
 */
export function normalizeCommand(s: string): string {
  return s
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/^\s+|\s+$/g, "");
}

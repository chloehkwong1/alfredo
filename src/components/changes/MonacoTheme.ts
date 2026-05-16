import type { editor } from "monaco-editor";

export const ALFREDO_DARK_THEME: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#0b0d10",
    "editor.foreground": "#e5e7eb",
    "editorLineNumber.foreground": "#52525b",
    "editorLineNumber.activeForeground": "#a1a1aa",
    "diffEditor.insertedTextBackground": "#16653433",
    "diffEditor.removedTextBackground": "#7f1d1d33",
    "diffEditor.insertedLineBackground": "#16653422",
    "diffEditor.removedLineBackground": "#7f1d1d22",
  },
};

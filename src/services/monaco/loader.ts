import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";

import { ALFREDO_DARK_THEME } from "../../components/changes/MonacoTheme";

type MonacoNamespace = typeof import("monaco-editor");

let monacoPromise: Promise<MonacoNamespace> | null = null;

declare global {
  interface Window {
    MonacoEnvironment?: { getWorker(_moduleId: string, label: string): Worker };
  }
}

export function loadMonaco(): Promise<MonacoNamespace> {
  if (monacoPromise) return monacoPromise;

  window.MonacoEnvironment = {
    getWorker(_moduleId, label) {
      switch (label) {
        case "typescript":
        case "javascript":
          return new TsWorker();
        case "json":
          return new JsonWorker();
        case "css":
        case "scss":
        case "less":
          return new CssWorker();
        case "html":
        case "handlebars":
        case "razor":
          return new HtmlWorker();
        default:
          return new EditorWorker();
      }
    },
  };

  monacoPromise = import("monaco-editor").then((monaco) => {
    monaco.editor.defineTheme("alfredo-dark", ALFREDO_DARK_THEME);
    monaco.editor.setTheme("alfredo-dark");
    return monaco;
  });

  return monacoPromise;
}

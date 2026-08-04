// monaco 0.56's exports map ("./*" → "./esm/vs/*.js") replaces the old
// esm/vs/... deep paths; the workers themselves still self-start on message.
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import CssWorker from "monaco-editor/language/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker.js?worker";

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

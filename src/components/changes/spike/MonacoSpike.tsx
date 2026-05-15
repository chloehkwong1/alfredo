import { useRef, useState } from "react";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { editor as monacoEditor } from "monaco-editor";
import { sampleOriginal, sampleModified, sampleAnnotations } from "./sampleDiff";

type Props = { onClose: () => void };

export function MonacoSpike({ onClose }: Props) {
  const editorRef = useRef<Parameters<DiffOnMount>[0] | null>(null);
  const [sideBySide, setSideBySide] = useState(true);
  const [hideUnchanged, setHideUnchanged] = useState(true);

  const onMount: DiffOnMount = (editor) => {
    editorRef.current = editor;
    const modified = editor.getModifiedEditor();

    for (const anno of sampleAnnotations) {
      const dom = document.createElement("div");
      dom.className = "monaco-spike-annotation";
      dom.style.cssText =
        "background:#1f2937;color:#f3f4f6;padding:8px 12px;border-radius:6px;" +
        "border:1px solid #374151;font-size:12px;line-height:1.4;max-width:480px;" +
        "box-shadow:0 4px 12px rgba(0,0,0,0.4);margin:4px 0;font-family:system-ui,sans-serif;";
      dom.textContent = anno.body;

      modified.addContentWidget({
        getId: () => `spike-anno-${anno.id}`,
        getDomNode: () => dom,
        getPosition: () => ({
          position: { lineNumber: anno.lineNumber, column: 1 },
          preference: [monacoEditor.ContentWidgetPositionPreference.BELOW],
        }),
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card">
        <span className="text-sm font-medium">Monaco spike</span>
        <button
          type="button"
          onClick={() => setSideBySide((s) => !s)}
          className="text-xs px-2 py-1 rounded border border-border hover:bg-muted"
        >
          {sideBySide ? "Switch to inline" : "Switch to side-by-side"}
        </button>
        <button
          type="button"
          onClick={() => setHideUnchanged((h) => !h)}
          className="text-xs px-2 py-1 rounded border border-border hover:bg-muted"
        >
          {hideUnchanged ? "Show unchanged regions" : "Hide unchanged regions"}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-2 py-1 rounded border border-border hover:bg-muted"
        >
          Close
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <DiffEditor
          height="100%"
          language="typescript"
          original={sampleOriginal}
          modified={sampleModified}
          theme="vs-dark"
          onMount={onMount}
          options={{
            readOnly: true,
            originalEditable: false,
            renderSideBySide: sideBySide,
            hideUnchangedRegions: {
              enabled: hideUnchanged,
              minimumLineCount: 3,
              contextLineCount: 3,
              revealLineCount: 20,
            },
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            automaticLayout: true,
          }}
          loading={<div className="p-4 text-sm">Loading Monaco…</div>}
        />
      </div>
    </div>
  );
}

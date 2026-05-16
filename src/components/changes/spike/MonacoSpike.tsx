import { useEffect, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import { loadMonaco } from "../../../services/monaco/loader";
import { sampleOriginal, sampleModified, sampleAnnotations } from "./sampleDiff";

type Props = { onClose: () => void };

export function MonacoSpike({ onClose }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const [sideBySide, setSideBySide] = useState(true);
  const [hideUnchanged, setHideUnchanged] = useState(true);

  useEffect(() => {
    let disposed = false;
    let zoneIds: string[] = [];

    loadMonaco().then((monaco) => {
      if (disposed || !hostRef.current) return;

      const originalModel = monaco.editor.createModel(sampleOriginal, "typescript");
      const modifiedModel = monaco.editor.createModel(sampleModified, "typescript");

      const editorInstance = monaco.editor.createDiffEditor(hostRef.current, {
        readOnly: true,
        originalEditable: false,
        renderSideBySide: sideBySide,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        hideUnchangedRegions: {
          enabled: hideUnchanged,
          minimumLineCount: 3,
          contextLineCount: 3,
          revealLineCount: 20,
        },
      });
      editorInstance.setModel({ original: originalModel, modified: modifiedModel });
      diffEditorRef.current = editorInstance;

      const modified = editorInstance.getModifiedEditor();
      modified.changeViewZones((accessor) => {
        for (const anno of sampleAnnotations) {
          const dom = document.createElement("div");
          dom.className = "monaco-spike-annotation";
          dom.style.cssText =
            "background:#1f2937;color:#f3f4f6;padding:10px 16px;" +
            "border-left:3px solid #6366f1;font-size:12px;line-height:1.5;" +
            "white-space:normal;word-break:normal;overflow-wrap:break-word;" +
            "font-family:system-ui,sans-serif;box-sizing:border-box;";
          dom.textContent = anno.body;
          zoneIds.push(
            accessor.addZone({
              afterLineNumber: anno.lineNumber,
              heightInLines: 3,
              domNode: dom,
            })
          );
        }
      });
    });

    return () => {
      disposed = true;
      const ed = diffEditorRef.current;
      if (!ed) return;
      const modified = ed.getModifiedEditor();
      modified.changeViewZones((accessor) => zoneIds.forEach((id) => accessor.removeZone(id)));
      ed.getModel()?.original.dispose();
      ed.getModel()?.modified.dispose();
      ed.dispose();
      diffEditorRef.current = null;
    };
  }, []);

  useEffect(() => {
    diffEditorRef.current?.updateOptions({ renderSideBySide: sideBySide });
  }, [sideBySide]);

  useEffect(() => {
    diffEditorRef.current?.updateOptions({
      hideUnchangedRegions: {
        enabled: hideUnchanged,
        minimumLineCount: 3,
        contextLineCount: 3,
        revealLineCount: 20,
      },
    });
  }, [hideUnchanged]);

  return (
    <div className="fixed inset-0 z-50 bg-bg-primary flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border-default bg-bg-bar">
        <span className="text-sm font-medium text-text-primary">Monaco spike</span>
        <button type="button" onClick={() => setSideBySide((s) => !s)}
          className="text-xs px-2 py-1 rounded border border-border-default text-text-secondary hover:text-text-primary hover:bg-bg-hover">
          {sideBySide ? "Switch to inline" : "Switch to side-by-side"}
        </button>
        <button type="button" onClick={() => setHideUnchanged((h) => !h)}
          className="text-xs px-2 py-1 rounded border border-border-default text-text-secondary hover:text-text-primary hover:bg-bg-hover">
          {hideUnchanged ? "Show unchanged regions" : "Hide unchanged regions"}
        </button>
        <div className="flex-1" />
        <button type="button" onClick={onClose}
          className="text-xs px-2 py-1 rounded border border-border-default text-text-secondary hover:text-text-primary hover:bg-bg-hover">
          Close
        </button>
      </div>
      <div ref={hostRef} className="flex-1 min-h-0" />
    </div>
  );
}

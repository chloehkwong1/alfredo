import { useEffect, useRef } from "react";
import type { editor } from "monaco-editor";
import type { DiffFile } from "../../types";
import { loadMonaco } from "../../services/monaco/loader";
import { diffToTexts } from "../../services/monaco/decorations";
import { pathToLanguageId } from "../../services/monaco/languages";

// NOTE: After Phase 2 migrates DiffViewMode to "inline" | "side-by-side" | "file",
// this can be tightened to `Extract<DiffViewMode, "inline" | "side-by-side">`.
// Until then, the current store union is `"unified" | "split"` so a local literal
// keeps Phase 1 self-contained and tsc-clean.
export type MonacoDiffMode = "inline" | "side-by-side";

export interface MonacoDiffBodyProps {
  file: DiffFile;
  viewMode: MonacoDiffMode;
}

export function MonacoDiffBody({ file, viewMode }: MonacoDiffBodyProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);

  // Mount the editor exactly once.
  useEffect(() => {
    let disposed = false;
    loadMonaco().then((monaco) => {
      if (disposed || !hostRef.current) return;
      const { original, modified } = diffToTexts(file);
      const language = pathToLanguageId(file.path);
      const originalModel = monaco.editor.createModel(original, language);
      const modifiedModel = monaco.editor.createModel(modified, language);

      const instance = monaco.editor.createDiffEditor(hostRef.current, {
        readOnly: true,
        originalEditable: false,
        renderSideBySide: viewMode === "side-by-side",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        hideUnchangedRegions: {
          enabled: true,
          minimumLineCount: 3,
          contextLineCount: 3,
          revealLineCount: 20,
        },
        showFoldingControls: "always",
      });
      instance.setModel({ original: originalModel, modified: modifiedModel });
      editorRef.current = instance;
    });

    return () => {
      disposed = true;
      const inst = editorRef.current;
      if (!inst) return;
      inst.getModel()?.original.dispose();
      inst.getModel()?.modified.dispose();
      inst.dispose();
      editorRef.current = null;
    };
  }, [file.path]);

  // Re-render when file content changes (e.g. after a new commit).
  useEffect(() => {
    const inst = editorRef.current;
    if (!inst) return;
    const { original, modified } = diffToTexts(file);
    inst.getModel()?.original.setValue(original);
    inst.getModel()?.modified.setValue(modified);
  }, [file]);

  // Toggle view mode without remounting.
  useEffect(() => {
    editorRef.current?.updateOptions({ renderSideBySide: viewMode === "side-by-side" });
  }, [viewMode]);

  return <div ref={hostRef} className="w-full h-[600px]" />;
}

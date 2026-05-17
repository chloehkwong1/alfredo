import { useEffect, useRef } from "react";
import type { editor } from "monaco-editor";
import type { DiffFile, DiffViewMode } from "../../types";
import { loadMonaco } from "../../services/monaco/loader";
import { diffToTexts } from "../../services/monaco/decorations";
import { pathToLanguageId } from "../../services/monaco/languages";

export type MonacoDiffMode = Extract<DiffViewMode, "inline" | "side-by-side">;

export interface MonacoDiffBodyProps {
  file: DiffFile;
  viewMode: MonacoDiffMode;
}

function hasRenderableContent(file: DiffFile): boolean {
  // Added → originalContent legitimately null; deleted → modifiedContent null.
  // Only fall back when the side we'd actually show is missing.
  if (file.status === "added") return file.modifiedContent != null;
  if (file.status === "deleted") return file.originalContent != null;
  return file.originalContent != null || file.modifiedContent != null;
}

function debugEnabled(): boolean {
  return typeof window !== "undefined"
    && window.localStorage.getItem("alfredo:monaco-debug") === "1";
}

/**
 * Per-editor instrumentation: logs content size, visible ranges, line count,
 * and view-zone count whenever they change. Enable with
 * `localStorage.setItem("alfredo:monaco-debug","1")` and reload.
 */
function attachProbe(
  path: string,
  side: "original" | "modified",
  ed: editor.ICodeEditor,
): { dispose(): void }[] {
  const tag = `[monaco:${path}:${side}]`;
  const t0 = performance.now();
  const stamp = () => `${(performance.now() - t0).toFixed(0)}ms`;
  const snapshot = (event: string) => {
    const model = ed.getModel();
    const lineCount = model ? model.getLineCount() : 0;
    const contentHeight = ed.getContentHeight();
    const layoutHeight = ed.getLayoutInfo().height;
    const visible = ed.getVisibleRanges().map((r) => `${r.startLineNumber}-${r.endLineNumber}`).join(",");
    // eslint-disable-next-line no-console
    console.log(
      `${tag} ${stamp()} ${event} lines=${lineCount} contentH=${contentHeight} layoutH=${layoutHeight} visible=[${visible}]`,
    );
  };
  snapshot("mount");
  const disposables = [
    ed.onDidContentSizeChange((e) => snapshot(`contentSizeChange (Δh=${e.contentHeightChanged ? "y" : "n"})`)),
    ed.onDidLayoutChange(() => snapshot("layoutChange")),
    ed.onDidScrollChange((e) => snapshot(`scrollChange top=${e.scrollTop}`)),
    ed.onDidChangeHiddenAreas?.(() => snapshot("hiddenAreasChange")) ?? { dispose() {} },
  ];
  return disposables;
}

export function MonacoDiffBody({ file, viewMode }: MonacoDiffBodyProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const renderable = hasRenderableContent(file);

  // Mount the editor exactly once.
  useEffect(() => {
    if (!renderable) return;
    let disposed = false;
    const disposables: { dispose(): void }[] = [];
    loadMonaco().then((monaco) => {
      if (disposed || !hostRef.current) return;
      const host = hostRef.current;
      const { original, modified } = diffToTexts(file);
      const language = pathToLanguageId(file.path);
      const originalModel = monaco.editor.createModel(original, language);
      const modifiedModel = monaco.editor.createModel(modified, language);

      const instance = monaco.editor.createDiffEditor(host, {
        readOnly: true,
        originalEditable: false,
        renderSideBySide: viewMode === "side-by-side",
        renderIndicators: false,
        renderMarginRevertIcon: false,
        diffAlgorithm: "advanced",
        // Wrapping breaks hideUnchangedRegions in side-by-side (wrapped lines
        // mis-align across panes, so Monaco can't safely collapse runs of
        // unchanged code). Wrap only when rendering inline.
        diffWordWrap: viewMode === "side-by-side" ? "off" : "inherit",
        lineNumbers: "on",
        glyphMargin: false,
        folding: true,
        lineDecorationsWidth: 12,
        renderLineHighlight: "none",
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: false, indentation: true },
        wordWrap: "on",
        fontSize: 13,
        lineHeight: 20,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        // Disable Monaco's internal vertical scroll so the host page handles it.
        // Host height is sized to content below, so there is nothing to scroll
        // inside the editor — but Monaco still captures wheel events by default.
        scrollbar: {
          vertical: "hidden",
          alwaysConsumeMouseWheel: false,
          handleMouseWheel: false,
        },
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

      const updateHeight = () => {
        const oh = instance.getOriginalEditor().getContentHeight();
        const mh = instance.getModifiedEditor().getContentHeight();
        host.style.height = `${Math.max(oh, mh)}px`;
      };
      disposables.push(instance.getOriginalEditor().onDidContentSizeChange(updateHeight));
      disposables.push(instance.getModifiedEditor().onDidContentSizeChange(updateHeight));
      updateHeight();

      if (debugEnabled()) {
        disposables.push(...attachProbe(file.path, "original", instance.getOriginalEditor()));
        disposables.push(...attachProbe(file.path, "modified", instance.getModifiedEditor()));
        // eslint-disable-next-line no-console
        console.log(`[monaco:${file.path}] ready — viewMode=${viewMode}`);
      }
    });

    return () => {
      disposed = true;
      disposables.forEach((d) => d.dispose());
      const inst = editorRef.current;
      if (!inst) return;
      inst.getModel()?.original.dispose();
      inst.getModel()?.modified.dispose();
      inst.dispose();
      editorRef.current = null;
    };
  }, [file.path, renderable]);

  // Re-render when file content changes (e.g. after a new commit).
  useEffect(() => {
    const inst = editorRef.current;
    if (!inst) return;
    const { original, modified } = diffToTexts(file);
    inst.getModel()?.original.setValue(original);
    inst.getModel()?.modified.setValue(modified);
  }, [file]);

  // Toggle view mode without remounting. diffWordWrap flips with it for the
  // same alignment reason as the initial mount config.
  useEffect(() => {
    editorRef.current?.updateOptions({
      renderSideBySide: viewMode === "side-by-side",
      diffWordWrap: viewMode === "side-by-side" ? "off" : "inherit",
    });
  }, [viewMode]);

  if (!renderable) {
    return (
      <div className="px-4 py-3 text-sm text-text-secondary">
        Content not available — file is binary or exceeds 1 MB.
      </div>
    );
  }

  return <div ref={hostRef} className="w-full" />;
}

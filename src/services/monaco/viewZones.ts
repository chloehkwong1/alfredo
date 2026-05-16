import type { editor } from "monaco-editor";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";

/**
 * One zone the controller should reconcile. `key` is the stable identity;
 * `render` is called on every sync so callers can close over fresh props.
 */
export interface ViewZoneRequest {
  key: string;
  afterLineNumber: number;
  /** Height hint in editor line-heights. Monaco doesn't auto-grow; use a
   *  ResizeObserver + `accessor.layoutZone(...)` if zone height is dynamic. */
  heightInLines: number;
  render: () => ReactNode;
}

interface Entry {
  zoneId: string;
  dom: HTMLDivElement;
  root: Root;
  heightInLines: number;
  afterLineNumber: number;
}

/**
 * Reconciles a set of React-backed Monaco view zones against one editor.
 *
 * Caller pattern:
 * ```ts
 * const controller = new ReactViewZoneController(editor);
 * controller.sync(requests);            // add / update / remove in one shot
 * // ...later
 * controller.dispose();                 // tears down all zones + React roots
 * ```
 *
 * Each zone owns its own React root so zones can be reordered or removed
 * without disturbing their neighbours.
 */
export class ReactViewZoneController {
  private entries = new Map<string, Entry>();

  constructor(private readonly editor: editor.ICodeEditor) {}

  sync(requests: ViewZoneRequest[]): void {
    const wanted = new Set(requests.map((r) => r.key));

    this.editor.changeViewZones((accessor) => {
      for (const [key, entry] of this.entries) {
        if (!wanted.has(key)) {
          accessor.removeZone(entry.zoneId);
          entry.root.unmount();
          entry.dom.remove();
          this.entries.delete(key);
        }
      }

      for (const req of requests) {
        const existing = this.entries.get(req.key);
        if (existing) {
          existing.root.render(req.render());
          const heightChanged = existing.heightInLines !== req.heightInLines;
          const lineChanged = existing.afterLineNumber !== req.afterLineNumber;
          if (heightChanged || lineChanged) {
            // Monaco doesn't expose in-place resize / move, so we re-add.
            accessor.removeZone(existing.zoneId);
            const zoneId = accessor.addZone({
              afterLineNumber: req.afterLineNumber,
              heightInLines: req.heightInLines,
              domNode: existing.dom,
            });
            this.entries.set(req.key, {
              ...existing,
              zoneId,
              heightInLines: req.heightInLines,
              afterLineNumber: req.afterLineNumber,
            });
          }
        } else {
          const dom = document.createElement("div");
          dom.className = "alfredo-monaco-zone";
          const root = createRoot(dom);
          root.render(req.render());
          const zoneId = accessor.addZone({
            afterLineNumber: req.afterLineNumber,
            heightInLines: req.heightInLines,
            domNode: dom,
          });
          this.entries.set(req.key, {
            zoneId,
            dom,
            root,
            heightInLines: req.heightInLines,
            afterLineNumber: req.afterLineNumber,
          });
        }
      }
    });
  }

  dispose(): void {
    this.editor.changeViewZones((accessor) => {
      for (const entry of this.entries.values()) {
        accessor.removeZone(entry.zoneId);
        entry.root.unmount();
        entry.dom.remove();
      }
    });
    this.entries.clear();
  }
}

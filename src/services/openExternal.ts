import { openPath } from "@tauri-apps/plugin-opener";
import { getAppConfig, openInEditor, openInTerminal } from "../api";

export async function openPathInEditor(path: string, line?: number, col?: number): Promise<void> {
  const cfg = await getAppConfig();
  try {
    await openInEditor(path, cfg.preferredEditor, cfg.customEditorPath ?? undefined, line, col);
  } catch (e) {
    // Editor launch can fail for reasons the user can't see from a dead
    // click: the CLI shim isn't on PATH (VS Code without "install 'code'
    // command"), the editor is vim (terminal-only, backend refuses), or a
    // custom path is unset. Fall back to the OS default app — the behavior
    // every one of these links had before the editor routing existed.
    console.warn(`[openExternal] editor open failed (${cfg.preferredEditor}), falling back to OS default:`, e);
    await openPath(path);
  }
}

export async function openPathInTerminal(path: string): Promise<void> {
  const cfg = await getAppConfig();
  await openInTerminal(path, cfg.preferredTerminal, cfg.customTerminalPath ?? undefined);
}

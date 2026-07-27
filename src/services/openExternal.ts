import { getAppConfig, openInEditor, openInTerminal } from "../api";

export async function openPathInEditor(path: string, line?: number, col?: number): Promise<void> {
  const cfg = await getAppConfig();
  await openInEditor(path, cfg.preferredEditor, cfg.customEditorPath ?? undefined, line, col);
}

export async function openPathInTerminal(path: string): Promise<void> {
  const cfg = await getAppConfig();
  await openInTerminal(path, cfg.preferredTerminal, cfg.customTerminalPath ?? undefined);
}

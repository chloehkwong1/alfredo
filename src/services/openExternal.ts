import { getAppConfig, openInEditor, openInTerminal } from "../api";

export async function openPathInEditor(path: string): Promise<void> {
  const cfg = await getAppConfig();
  await openInEditor(path, cfg.preferredEditor, cfg.customEditorPath ?? undefined);
}

export async function openPathInTerminal(path: string): Promise<void> {
  const cfg = await getAppConfig();
  await openInTerminal(path, cfg.preferredTerminal, cfg.customTerminalPath ?? undefined);
}

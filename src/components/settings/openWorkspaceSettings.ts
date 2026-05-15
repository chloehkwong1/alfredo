export const OPEN_WORKSPACE_SETTINGS_EVENT = "alfredo:open-workspace-settings";

export function openWorkspaceSettings(repoPath?: string) {
  window.dispatchEvent(
    new CustomEvent(OPEN_WORKSPACE_SETTINGS_EVENT, {
      detail: repoPath ? { repoPath } : {},
    }),
  );
}

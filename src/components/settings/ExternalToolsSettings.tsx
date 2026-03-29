import type { GlobalAppConfig } from "../../types";

const EDITOR_OPTIONS = [
  { value: "vscode", label: "VS Code" },
  { value: "cursor", label: "Cursor" },
  { value: "zed", label: "Zed" },
  { value: "vim", label: "Vim / Neovim" },
  { value: "custom", label: "Custom..." },
];

const TERMINAL_OPTIONS = [
  { value: "iterm", label: "iTerm2" },
  { value: "terminal", label: "Terminal.app" },
  { value: "warp", label: "Warp" },
  { value: "ghostty", label: "Ghostty" },
  { value: "custom", label: "Custom..." },
];

interface ExternalToolsSettingsProps {
  config: GlobalAppConfig;
  onChange: (patch: Partial<GlobalAppConfig>) => void;
}

function ExternalToolsSettings({ config, onChange }: ExternalToolsSettingsProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-1">External Tools</h3>
        <p className="text-xs text-text-tertiary mb-4">
          Choose which editor and terminal to open worktrees in.
        </p>
      </div>

      {/* Editor */}
      <div className="space-y-2">
        <label className="text-sm text-text-secondary" htmlFor="editor-select">
          Editor
        </label>
        <select
          id="editor-select"
          value={config.preferredEditor ?? "vscode"}
          onChange={(e) => onChange({ preferredEditor: e.target.value })}
          className="w-full rounded-md border border-border-default bg-bg-secondary px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
        >
          {EDITOR_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {config.preferredEditor === "custom" && (
          <input
            type="text"
            placeholder="e.g. /usr/local/bin/subl"
            value={config.customEditorPath ?? ""}
            onChange={(e) => onChange({ customEditorPath: e.target.value || null })}
            className="w-full rounded-md border border-border-default bg-bg-secondary px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent-primary"
          />
        )}
      </div>

      {/* Terminal */}
      <div className="space-y-2">
        <label className="text-sm text-text-secondary" htmlFor="terminal-select">
          Terminal
        </label>
        <select
          id="terminal-select"
          value={config.preferredTerminal ?? "iterm"}
          onChange={(e) => onChange({ preferredTerminal: e.target.value })}
          className="w-full rounded-md border border-border-default bg-bg-secondary px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
        >
          {TERMINAL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {config.preferredTerminal === "custom" && (
          <input
            type="text"
            placeholder="e.g. /Applications/Alacritty.app"
            value={config.customTerminalPath ?? ""}
            onChange={(e) => onChange({ customTerminalPath: e.target.value || null })}
            className="w-full rounded-md border border-border-default bg-bg-secondary px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent-primary"
          />
        )}
      </div>
    </div>
  );
}

export { ExternalToolsSettings };

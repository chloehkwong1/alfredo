import type { ClaudeDefaults } from "../../types";

const MODEL_OPTIONS = [
  { value: "claude-opus-4-6", label: "Opus 4.6 (1M context)" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6 (200K context)" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5 (200K context)" },
];

const EFFORT_OPTIONS = ["low", "medium", "high", "max"] as const;

const PERMISSION_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "accept-edits", label: "Accept Edits" },
  { value: "plan", label: "Plan" },
  { value: "auto", label: "Auto" },
];

const OUTPUT_OPTIONS = ["Default", "Explanatory", "Learning"] as const;

interface AgentSettingsProps {
  settings: ClaudeDefaults;
  onChange: (settings: ClaudeDefaults) => void;
}

function AgentSettings({ settings, onChange }: AgentSettingsProps) {
  const update = (patch: Partial<ClaudeDefaults>) =>
    onChange({ ...settings, ...patch });

  return (
    <div className="space-y-6">
      <p className="text-xs text-text-tertiary">
        Default settings for all new sessions — Override per worktree using the
        gear icon in the status bar.
      </p>

      {/* Model & Performance */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-text-primary">
          Model & Performance
        </h3>

        <div className="space-y-1.5">
          <label className="text-xs text-text-secondary">Model</label>
          <select
            value={settings.model ?? ""}
            onChange={(e) => update({ model: e.target.value || undefined })}
            className="w-full px-3 py-1.5 text-sm bg-bg-hover text-text-primary border border-border-default rounded-[var(--radius-md)] focus:outline-none focus:ring-1 focus:ring-accent-primary"
          >
            <option value="">Default</option>
            {MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-text-secondary">Effort</label>
          <div className="flex rounded-[var(--radius-md)] border border-border-default overflow-hidden">
            {EFFORT_OPTIONS.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => update({ effort: level })}
                className={[
                  "flex-1 px-3 py-1.5 text-xs font-medium capitalize transition-colors cursor-pointer",
                  settings.effort === level
                    ? "bg-accent-primary text-white"
                    : "bg-bg-hover text-text-secondary hover:text-text-primary",
                ].join(" ")}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Permissions */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-text-primary">Permissions</h3>

        <div className="space-y-1.5">
          <label className="text-xs text-text-secondary">Permission Mode</label>
          <select
            value={settings.permissionMode ?? "default"}
            onChange={(e) =>
              update({
                permissionMode:
                  e.target.value === "default" ? undefined : e.target.value,
              })
            }
            className="w-full px-3 py-1.5 text-sm bg-bg-hover text-text-primary border border-border-default rounded-[var(--radius-md)] focus:outline-none focus:ring-1 focus:ring-accent-primary"
          >
            {PERMISSION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <label className="text-xs text-text-secondary">
              Skip Permissions
            </label>
            <p className="text-xs text-text-tertiary">
              Dangerously skip all permission prompts
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              update({
                dangerouslySkipPermissions:
                  !settings.dangerouslySkipPermissions,
              })
            }
            className={[
              "relative w-9 h-5 rounded-full transition-colors cursor-pointer",
              settings.dangerouslySkipPermissions
                ? "bg-accent-primary"
                : "bg-bg-hover border border-border-default",
            ].join(" ")}
          >
            <span
              className={[
                "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                settings.dangerouslySkipPermissions
                  ? "translate-x-4"
                  : "translate-x-0",
              ].join(" ")}
            />
          </button>
        </div>
      </div>

      {/* Output */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-text-primary">Output</h3>

        <div className="space-y-1.5">
          <label className="text-xs text-text-secondary">Output Style</label>
          <div className="flex rounded-[var(--radius-md)] border border-border-default overflow-hidden">
            {OUTPUT_OPTIONS.map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => update({ outputStyle: style })}
                className={[
                  "flex-1 px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                  (settings.outputStyle ?? "Default") === style
                    ? "bg-accent-primary text-white"
                    : "bg-bg-hover text-text-secondary hover:text-text-primary",
                ].join(" ")}
              >
                {style}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <label className="text-xs text-text-secondary">Verbose output</label>
          <button
            type="button"
            onClick={() => update({ verbose: !settings.verbose })}
            className={[
              "relative w-9 h-5 rounded-full transition-colors cursor-pointer",
              settings.verbose
                ? "bg-accent-primary"
                : "bg-bg-hover border border-border-default",
            ].join(" ")}
          >
            <span
              className={[
                "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                settings.verbose ? "translate-x-4" : "translate-x-0",
              ].join(" ")}
            />
          </button>
        </div>
      </div>

      <p className="text-xs text-text-tertiary pt-2 border-t border-border-default">
        Applies to new sessions — existing sessions keep their settings.
      </p>
    </div>
  );
}

export { AgentSettings };

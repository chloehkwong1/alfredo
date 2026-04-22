import { useAgentStore } from "../../stores/agentStore";
import { useClaudeModels } from "../../services/modelCatalog";
import { useAppConfig } from "../../hooks/useAppConfig";
import { useOutputStyles } from "../../hooks/useOutputStyles";
import type { ClaudeDefaults, TabType } from "../../types";

const EFFORT_OPTIONS = ["low", "medium", "high", "max"] as const;

const PERMISSION_OPTIONS = [
  { value: "default", label: "Default", hint: "Asks before edits and commands" },
  { value: "acceptEdits", label: "Accept Edits", hint: "Auto-accepts file edits, asks before commands" },
  { value: "plan", label: "Plan", hint: "Read-only exploration, no edits or commands" },
  { value: "auto", label: "Auto", hint: "AI decides which permissions to grant — may still ask" },
  { value: "dontAsk", label: "Don't Ask", hint: "Runs all tools without asking — use with caution" },
  { value: "bypassPermissions", label: "Bypass Permissions", hint: "No checks at all — sandboxed environments only" },
];

const selectClass = [
  "h-8 w-full px-3 text-[13px] font-normal",
  "bg-bg-primary text-text-primary",
  "border border-border-default rounded-[var(--radius-md)]",
  "hover:border-border-hover",
  "focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-accent-primary/50",
  "transition-all duration-[var(--transition-fast)]",
  "cursor-pointer",
].join(" ");

const AGENT_OPTIONS = [
  { value: "claude", label: "Claude Code", agentId: "claudeCode" },
  { value: "codex", label: "Codex", agentId: "codex" },
  { value: "gemini", label: "Gemini CLI", agentId: "geminiCli" },
] as const;

interface AgentSettingsProps {
  settings: ClaudeDefaults;
  onChange: (settings: ClaudeDefaults) => void;
  defaultAgent: TabType;
  onDefaultAgentChange: (agent: TabType) => void;
}

function AgentSettings({ settings, onChange, defaultAgent, onDefaultAgentChange }: AgentSettingsProps) {
  const update = (patch: Partial<ClaudeDefaults>) =>
    onChange({ ...settings, ...patch });

  const availableAgents = useAgentStore((s) => s.availableAgents);
  const claudeModels = useClaudeModels();
  const { activeRepo } = useAppConfig();
  const outputOptions = useOutputStyles(activeRepo);

  const agentOptions = AGENT_OPTIONS.filter((opt) =>
    availableAgents.includes(opt.agentId),
  );

  const permissionValue = settings.permissionMode ?? "default";

  return (
    <div>
      <p className="text-xs text-text-tertiary mb-5">
        Defaults for all new sessions. Override per worktree via the status bar.
      </p>

      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary mb-3.5">
        Default Agent
      </div>

      <div className="mb-8">
        <select
          value={defaultAgent}
          onChange={(e) => onDefaultAgentChange(e.target.value as TabType)}
          className={selectClass}
        >
          {agentOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <p className="text-xs text-text-tertiary mt-[5px]">
          Agent used when opening a new worktree tab.
        </p>
      </div>

      {defaultAgent === "claude" && (<>
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary mb-3.5">
        Model & Performance
      </div>

      <div className="mb-4">
        <div className="text-[13px] font-medium text-text-primary mb-1.5">Model</div>
        <select
          value={settings.model ?? ""}
          onChange={(e) => update({ model: e.target.value || undefined })}
          className={selectClass}
        >
          <option value="">Default</option>
          {claudeModels.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="mb-4">
        <div className="text-[13px] font-medium text-text-primary mb-1.5">Effort</div>
        <div className="flex rounded-[var(--radius-md)] border border-border-default overflow-hidden">
          {EFFORT_OPTIONS.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => update({ effort: level })}
              className={[
                "flex-1 px-3 py-[7px] text-xs font-medium capitalize transition-colors cursor-pointer",
                (settings.effort ?? "high") === level
                  ? "bg-accent-primary text-white"
                  : "bg-bg-primary text-text-secondary hover:text-text-primary",
              ].join(" ")}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary mb-3.5 mt-8">
        Permissions
      </div>

      <div className="mb-4">
        <div className="text-[13px] font-medium text-text-primary mb-1.5">Permission Mode</div>
        <select
          value={permissionValue}
          onChange={(e) => {
            const v = e.target.value;
            update({
              permissionMode: v === "default" ? undefined : v,
              dangerouslySkipPermissions: v === "bypassPermissions" ? true : undefined,
            });
          }}
          className={selectClass}
        >
          {PERMISSION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <p className="text-xs text-text-tertiary mt-[5px]">
          {PERMISSION_OPTIONS.find((o) => o.value === permissionValue)?.hint}
        </p>
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary mb-3.5 mt-8">
        Output
      </div>

      <div className="mb-4">
        <div className="text-[13px] font-medium text-text-primary mb-1.5">Style</div>
        {outputOptions.length <= 4 ? (
          <div className="flex rounded-[var(--radius-md)] border border-border-default overflow-hidden">
            {outputOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => update({ outputStyle: opt.value })}
                className={[
                  "flex-1 px-3 py-[7px] text-xs font-medium transition-colors cursor-pointer",
                  (settings.outputStyle ?? "Default") === opt.value
                    ? "bg-accent-primary text-white"
                    : "bg-bg-primary text-text-secondary hover:text-text-primary",
                ].join(" ")}
              >
                {opt.label}
              </button>
            ))}
          </div>
        ) : (
          <select
            value={settings.outputStyle ?? "Default"}
            onChange={(e) => update({ outputStyle: e.target.value })}
            className={selectClass}
          >
            {outputOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        )}
      </div>

      <div className="flex items-center justify-between py-2">
        <span className="text-[13px] text-text-secondary">Verbose output</span>
        <button
          type="button"
          role="switch"
          aria-checked={!!settings.verbose}
          onClick={() => update({ verbose: !settings.verbose })}
          className={[
            "relative inline-flex h-5 w-9 items-center rounded-full",
            "transition-colors duration-[var(--transition-fast)] cursor-pointer",
            settings.verbose ? "bg-accent-primary" : "bg-bg-active",
          ].join(" ")}
        >
          <span
            className={[
              "inline-block h-3.5 w-3.5 rounded-full bg-white",
              "transition-transform duration-[var(--transition-fast)]",
              settings.verbose ? "translate-x-[18px]" : "translate-x-[3px]",
            ].join(" ")}
          />
        </button>
      </div>

      <p className="text-xs text-text-tertiary border-t border-border-default pt-4 mt-7">
        Applies to new sessions — existing sessions keep their settings.
      </p>
      </>)}
    </div>
  );
}

export { AgentSettings };

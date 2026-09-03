import { useAgentStore } from "../../stores/agentStore";
import type { ClaudeDefaults, TabType } from "../../types";
import { flagsError } from "../../services/launchCommand";

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

  const agentOptions = AGENT_OPTIONS.filter((opt) =>
    availableAgents.includes(opt.agentId),
  );

  const extraFlagsError = flagsError(settings.extraFlags);

  return (
    <div>
      <p className="text-xs text-text-tertiary mb-5">
        Defaults for new sessions. Model, effort, permission mode and output
        style are set inside Claude itself (e.g. /model) and carry over to new
        sessions automatically.
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
        Permissions
      </div>

      <div className="flex items-center justify-between py-2">
        <span className="text-[13px] text-text-secondary">Skip permission checks</span>
        <button
          type="button"
          role="switch"
          aria-checked={!!settings.dangerouslySkipPermissions}
          aria-describedby="agent-skip-permissions-desc"
          onClick={() => update({ dangerouslySkipPermissions: settings.dangerouslySkipPermissions ? undefined : true })}
          className={[
            "relative inline-flex h-5 w-9 items-center rounded-full",
            "transition-colors duration-[var(--transition-fast)] cursor-pointer",
            settings.dangerouslySkipPermissions ? "bg-accent-primary" : "bg-bg-active",
          ].join(" ")}
        >
          <span
            className={[
              "inline-block h-3.5 w-3.5 rounded-full bg-white",
              "transition-transform duration-[var(--transition-fast)]",
              settings.dangerouslySkipPermissions ? "translate-x-[18px]" : "translate-x-[3px]",
            ].join(" ")}
          />
        </button>
      </div>
      <p id="agent-skip-permissions-desc" className="text-xs text-text-tertiary mb-4">
        Launches every new Claude tab with --dangerously-skip-permissions: no
        checks at all. Sandboxed or throwaway worktrees only.
      </p>

      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary mb-3.5 mt-8">
        Additional flags
      </div>

      <div className="mb-4">
        <input
          type="text"
          spellCheck={false}
          value={settings.extraFlags ?? ""}
          onChange={(e) => update({ extraFlags: e.target.value || undefined })}
          placeholder="e.g. --mcp-config ./mcp.json"
          aria-invalid={extraFlagsError != null}
          aria-describedby="agent-extra-flags-desc"
          className={[
            "h-8 w-full px-3 text-[13px] font-mono",
            "bg-bg-primary text-text-primary",
            "border rounded-[var(--radius-md)]",
            extraFlagsError ? "border-red-500" : "border-border-default hover:border-border-hover",
            "focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-accent-primary/50",
            "transition-all duration-[var(--transition-fast)]",
          ].join(" ")}
        />
        <p id="agent-extra-flags-desc" className={["text-xs mt-[5px]", extraFlagsError ? "text-red-500" : "text-text-tertiary"].join(" ")}>
          {extraFlagsError ?? "Passed to every new Claude tab. Example: --mcp-config ./mcp.json."}
        </p>
      </div>

      <p className="text-xs text-text-tertiary border-t border-border-default pt-4 mt-7">
        Applies to new sessions — existing sessions keep their settings.
      </p>
      </>)}
    </div>
  );
}

export { AgentSettings };

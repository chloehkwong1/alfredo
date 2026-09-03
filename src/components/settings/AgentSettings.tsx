import { useAgentStore } from "../../stores/agentStore";
import { ToggleRow } from "../ui/ToggleRow";
import type { GlobalAppConfig, TabType } from "../../types";
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
  settings: Pick<GlobalAppConfig, "dangerouslySkipPermissions" | "extraFlags">;
  onChange: (patch: Partial<GlobalAppConfig>) => void;
  defaultAgent: TabType;
  onDefaultAgentChange: (agent: TabType) => void;
}

function AgentSettings({ settings, onChange, defaultAgent, onDefaultAgentChange }: AgentSettingsProps) {
  const availableAgents = useAgentStore((s) => s.availableAgents);

  const agentOptions = AGENT_OPTIONS.filter((opt) =>
    availableAgents.includes(opt.agentId),
  );

  const extraFlagsError = flagsError(settings.extraFlags);

  return (
    <div>
      <p className="text-xs text-text-tertiary mb-5">
        Defaults for new sessions. Model, effort and permission mode are set
        inside Claude itself (/model, /permissions) and follow you everywhere.
        Output style (/config) is saved per project; put outputStyle in
        ~/.claude/settings.json to apply it to every worktree.
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

      <ToggleRow
        label="Skip permission checks"
        description="Launches every new Claude tab with --dangerously-skip-permissions: no checks at all. Sandboxed or throwaway worktrees only. Global — applies to every repo."
        checked={!!settings.dangerouslySkipPermissions}
        onChange={(v) => onChange({ dangerouslySkipPermissions: v || null })}
      />

      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary mb-3.5 mt-8">
        Additional flags
      </div>

      <div className="mb-4">
        <input
          type="text"
          spellCheck={false}
          value={settings.extraFlags ?? ""}
          onChange={(e) => onChange({ extraFlags: e.target.value || null })}
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

import { Plus, X } from "lucide-react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { orchestrationsFromRules } from "../../services/orchestrations";
import type { OrchestrationRule } from "../../types";

const inputClass = [
  "h-8 w-full px-3 text-[13px]",
  "bg-bg-primary text-text-primary",
  "border border-border-default rounded-[var(--radius-md)]",
  "placeholder:text-text-tertiary",
  "hover:border-border-hover",
  "focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-accent-primary/50",
  "transition-all duration-[var(--transition-fast)]",
].join(" ");

interface OrchestrationRulesSettingsProps {
  repoPath: string;
  rules: OrchestrationRule[];
  onChange: (rules: OrchestrationRule[]) => void;
}

function OrchestrationRulesSettings({ repoPath, rules, onChange }: OrchestrationRulesSettingsProps) {
  const worktrees = useWorkspaceStore((s) => s.worktrees);

  const setRule = (index: number, patch: Partial<OrchestrationRule>) =>
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));

  return (
    <div className="mb-[18px]">
      <div className="text-[13px] font-medium text-text-primary mb-1.5">Orchestrations</div>
      <p className="text-xs text-text-tertiary mb-3">
        Group worktrees by branch prefix. Only you see these.
      </p>
      {rules.map((rule, i) => {
        const matching = orchestrationsFromRules(repoPath, [rule], worktrees)[0]?.items.length ?? 0;
        return (
          <div key={i} className="mb-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                className={inputClass}
                value={rule.name}
                placeholder="Name"
                aria-label="Orchestration name"
                onChange={(e) => setRule(i, { name: e.target.value })}
              />
              <input
                type="text"
                className={inputClass + " font-mono"}
                value={rule.branchPrefix}
                placeholder="Branch prefix"
                aria-label="Branch prefix"
                onChange={(e) => setRule(i, { branchPrefix: e.target.value })}
              />
              <button
                type="button"
                onClick={() => onChange(rules.filter((_, j) => j !== i))}
                className="flex-shrink-0 h-8 w-8 flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded-[var(--radius-md)] transition-colors cursor-pointer"
                aria-label="Delete orchestration"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-text-tertiary mt-1">
              {matching} {matching === 1 ? "worktree matches" : "worktrees match"} now
            </p>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => onChange([...rules, { name: "", branchPrefix: "" }])}
        className="mt-1 inline-flex items-center gap-1.5 h-8 px-3 text-[13px] text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-[var(--radius-md)] transition-colors cursor-pointer"
      >
        <Plus className="h-4 w-4" />
        Add orchestration
      </button>
    </div>
  );
}

export { OrchestrationRulesSettings };

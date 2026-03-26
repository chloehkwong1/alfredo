import { Plus, Trash2 } from "lucide-react";
import type { SetupScript } from "../../types";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Input } from "../ui/Input";

interface ScriptEditorProps {
  scripts: SetupScript[];
  onChange: (scripts: SetupScript[]) => void;
}

function ScriptEditor({ scripts, onChange }: ScriptEditorProps) {
  const addScript = () => {
    onChange([...scripts, { name: "", command: "", runOn: "create" }]);
  };

  const removeScript = (index: number) => {
    onChange(scripts.filter((_, i) => i !== index));
  };

  const updateScript = (
    index: number,
    field: keyof SetupScript,
    value: string,
  ) => {
    onChange(
      scripts.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">
          Scripts run automatically when a new worktree is created.
        </p>
      </div>

      {scripts.length === 0 && (
        <div className="rounded-[var(--radius-md)] border border-border-default bg-bg-secondary px-4 py-6 text-center text-sm text-text-tertiary">
          No setup scripts configured yet.
        </div>
      )}

      <div className="space-y-2">
        {scripts.map((script, index) => (
          <div
            key={index}
            className="flex items-start gap-2 rounded-[var(--radius-md)] border border-border-default bg-bg-secondary p-3"
          >
            <div className="flex-1 space-y-2">
              <Input
                placeholder="Name (e.g. Install deps)"
                value={script.name}
                onChange={(e) => updateScript(index, "name", e.target.value)}
              />
              <Input
                placeholder="Command (e.g. npm install)"
                value={script.command}
                onChange={(e) => updateScript(index, "command", e.target.value)}
              />
            </div>
            <IconButton
              size="sm"
              label="Remove script"
              className="mt-1 text-text-tertiary hover:text-danger"
              onClick={() => removeScript(index)}
            >
              <Trash2 />
            </IconButton>
          </div>
        ))}
      </div>

      <Button variant="secondary" size="sm" onClick={addScript}>
        <Plus className="h-3.5 w-3.5" />
        Add Script
      </Button>
    </div>
  );
}

export { ScriptEditor };

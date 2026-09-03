import { Toggle } from "./Toggle";

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}

/** Settings row: bold label + hint on the left, Toggle on the right. */
function ToggleRow({ label, description, checked, onChange, className }: ToggleRowProps) {
  return (
    <div className={["flex items-start justify-between gap-4", className ?? ""].join(" ").trim()}>
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-text-primary">{label}</div>
        <p className="text-xs text-text-tertiary mt-[5px]">{description}</p>
      </div>
      <div className="shrink-0 pt-0.5">
        <Toggle checked={checked} onChange={onChange} />
      </div>
    </div>
  );
}

export { ToggleRow };

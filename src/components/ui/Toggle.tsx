interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-5 w-9 items-center rounded-full",
        "transition-colors duration-[var(--transition-fast)]",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        checked ? "bg-accent-primary" : "bg-bg-active",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-3.5 w-3.5 rounded-full bg-white",
          "transition-transform duration-[var(--transition-fast)]",
          checked ? "translate-x-[18px]" : "translate-x-[3px]",
        ].join(" ")}
      />
    </button>
  );
}

export { Toggle };
export type { ToggleProps };

// src/components/terminal/SettingsChip.tsx
import { useRef, useEffect } from "react";

interface SettingsChipProps {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  isOpen: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
}

function SettingsChip({ label, options, value, isOpen, onToggle, onChange }: SettingsChipProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onToggle();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onToggle();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 px-2 py-0.5 text-xs text-text-secondary bg-bg-hover border border-border-default rounded-[var(--radius-sm)] hover:text-text-primary hover:border-border-hover transition-colors cursor-pointer"
      >
        {label}
        <span className="text-[10px] opacity-60">▾</span>
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 min-w-[140px] bg-bg-primary border border-border-default rounded-[var(--radius-md)] shadow-lg overflow-hidden z-50">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                onToggle();
              }}
              className={[
                "w-full px-3 py-1.5 text-xs text-left transition-colors cursor-pointer",
                opt.value === value
                  ? "text-accent-primary bg-accent-primary/8"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-hover",
              ].join(" ")}
            >
              {opt.value === value && <span className="mr-1.5">✓</span>}
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export { SettingsChip };

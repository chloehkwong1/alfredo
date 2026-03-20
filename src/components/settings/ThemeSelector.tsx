const themes = [
  { id: "warm-dark", name: "Warm Dark", bg: "#1a1918", accent: "#9333ea" },
  { id: "light", name: "Light", bg: "#fafaf9", accent: "#7c3aed" },
  { id: "synthwave", name: "Synthwave '84", bg: "#1a1028", accent: "#ff2975" },
  { id: "catppuccin", name: "Catppuccin", bg: "#1e1e2e", accent: "#cba6f7" },
  { id: "sunset", name: "Sunset Boulevard", bg: "#1f1520", accent: "#f472b6" },
  { id: "tokyo-night", name: "Tokyo Night", bg: "#1a1b26", accent: "#7aa2f7" },
  { id: "solarized", name: "Solarized Dark", bg: "#002b36", accent: "#268bd2" },
  { id: "honeycomb", name: "Honeycomb", bg: "#1c1a17", accent: "#eab308" },
] as const;

interface ThemeSelectorProps {
  currentTheme: string;
  onSelect: (theme: string) => void;
}

function ThemeSelector({ currentTheme, onSelect }: ThemeSelectorProps) {
  return (
    <div className="grid grid-cols-4 gap-3">
      {themes.map((theme) => {
        const isSelected = currentTheme === theme.id;
        return (
          <button
            key={theme.id}
            type="button"
            onClick={() => onSelect(theme.id)}
            className={[
              "flex flex-col items-center gap-2 p-3",
              "rounded-[var(--radius-md)] border",
              "transition-all duration-[var(--transition-fast)]",
              "cursor-pointer",
              isSelected
                ? "border-accent-primary ring-1 ring-accent-primary/50"
                : "border-border-default hover:border-border-hover",
            ].join(" ")}
          >
            {/* Preview swatch */}
            <div
              className="w-full h-10 rounded-[var(--radius-sm)] relative"
              style={{ backgroundColor: theme.bg }}
            >
              <div
                className="absolute bottom-1.5 right-1.5 w-3 h-3 rounded-full"
                style={{ backgroundColor: theme.accent }}
              />
            </div>
            {/* Theme name */}
            <span className="text-xs text-text-secondary truncate w-full text-center">
              {theme.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export { ThemeSelector };

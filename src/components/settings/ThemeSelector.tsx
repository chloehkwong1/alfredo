const themes = [
  { id: "warm-dark", name: "Warm Dark", bg: "#1a1918", fg: "#f5f2ef", accent: "#9333ea" },
  { id: "light", name: "Light", bg: "#fafaf9", fg: "#1c1917", accent: "#7c3aed" },
  { id: "synthwave", name: "Synthwave '84", bg: "#1a1028", fg: "#f5f0ff", accent: "#ff2975" },
  { id: "catppuccin", name: "Catppuccin", bg: "#1e1e2e", fg: "#cdd6f4", accent: "#cba6f7" },
  { id: "sunset", name: "Sunset Boulevard", bg: "#1f1520", fg: "#f5e6f0", accent: "#f472b6" },
  { id: "tokyo-night", name: "Tokyo Night", bg: "#1a1b26", fg: "#c0caf5", accent: "#7aa2f7" },
  { id: "solarized", name: "Solarized Dark", bg: "#002b36", fg: "#839496", accent: "#268bd2" },
  { id: "honeycomb", name: "Honeycomb", bg: "#1c1a17", fg: "#f5f2ef", accent: "#eab308" },
] as const;

interface ThemeSelectorProps {
  currentTheme: string;
  onSelect: (theme: string) => void;
}

function ThemeSelector({ currentTheme, onSelect }: ThemeSelectorProps) {
  return (
    <div className="grid grid-cols-4 gap-2.5">
      {themes.map((theme) => {
        const isSelected = currentTheme === theme.id;
        return (
          <button
            key={theme.id}
            type="button"
            onClick={() => onSelect(theme.id)}
            className={[
              "flex flex-col items-center gap-1.5 p-2",
              "rounded-[var(--radius-md)] border",
              "transition-all duration-[var(--transition-fast)]",
              "cursor-pointer",
              isSelected
                ? "border-accent-primary ring-1 ring-accent-primary/50"
                : "border-border-default hover:border-border-hover",
            ].join(" ")}
          >
            {/* Preview swatch with mini UI */}
            <div
              className="w-full h-9 rounded-[var(--radius-sm)] relative overflow-hidden"
              style={{ backgroundColor: theme.bg }}
            >
              {/* Mini sidebar */}
              <div
                className="absolute top-1 left-1 bottom-1 w-2 rounded-sm opacity-20"
                style={{ backgroundColor: theme.fg }}
              />
              {/* Mini title bar line */}
              <div
                className="absolute top-1.5 left-4 right-1.5 h-0.5 rounded-full opacity-15"
                style={{ backgroundColor: theme.fg }}
              />
              {/* Mini content lines */}
              <div
                className="absolute top-3.5 left-4 right-3 h-0.5 rounded-full opacity-10"
                style={{ backgroundColor: theme.fg }}
              />
              <div
                className="absolute top-5 left-4 right-4 h-0.5 rounded-full opacity-10"
                style={{ backgroundColor: theme.fg }}
              />
              {/* Accent button */}
              <div
                className="absolute bottom-1.5 right-1.5 w-3 h-1 rounded-sm"
                style={{ backgroundColor: theme.accent }}
              />
            </div>
            {/* Theme name */}
            <span className="text-xs text-text-secondary text-center leading-tight">
              {theme.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export { ThemeSelector };

import { useEffect, useState } from "react";

const FONT_FAMILIES = [
  "JetBrains Mono",
  "SF Mono",
  "Fira Code",
  "Menlo",
  "Monaco",
  "Cascadia Code",
] as const;

type CursorStyle = "block" | "underline" | "bar";

interface TerminalPreferences {
  fontFamily: string;
  fontSize: number;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
}

const STORAGE_KEY = "alfredo:terminalPreferences";

const DEFAULTS: TerminalPreferences = {
  fontFamily: "JetBrains Mono",
  fontSize: 14,
  cursorStyle: "block",
  cursorBlink: true,
};

function loadPreferences(): TerminalPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return DEFAULTS;
}

function savePreferences(prefs: TerminalPreferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

function TerminalSettings() {
  const [prefs, setPrefs] = useState<TerminalPreferences>(loadPreferences);

  useEffect(() => {
    savePreferences(prefs);
  }, [prefs]);

  const update = <K extends keyof TerminalPreferences>(
    key: K,
    value: TerminalPreferences[K],
  ) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-5">
      {/* Font Family */}
      <div className="space-y-1.5">
        <label className="text-body font-medium text-text-primary">
          Font Family
        </label>
        <select
          value={prefs.fontFamily}
          onChange={(e) => update("fontFamily", e.target.value)}
          className={[
            "h-8 w-full px-3 text-body",
            "bg-bg-secondary text-text-primary",
            "border border-border-default rounded-[var(--radius-md)]",
            "hover:border-border-hover",
            "focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-accent-primary/50",
            "transition-all duration-[var(--transition-fast)]",
            "cursor-pointer",
          ].join(" ")}
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>

      {/* Font Size */}
      <div className="space-y-1.5">
        <label className="text-body font-medium text-text-primary">
          Font Size:{" "}
          <span className="font-normal text-text-secondary">
            {prefs.fontSize}px
          </span>
        </label>
        <input
          type="range"
          min={10}
          max={20}
          step={1}
          value={prefs.fontSize}
          onChange={(e) => update("fontSize", Number(e.target.value))}
          className="w-full accent-accent-primary cursor-pointer"
        />
        <div className="flex justify-between text-caption text-text-tertiary">
          <span>10px</span>
          <span>20px</span>
        </div>
      </div>

      {/* Cursor Style */}
      <div className="space-y-1.5">
        <label className="text-body font-medium text-text-primary">
          Cursor Style
        </label>
        <div className="flex gap-2">
          {(["block", "underline", "bar"] as const).map((style) => (
            <button
              key={style}
              type="button"
              onClick={() => update("cursorStyle", style)}
              className={[
                "flex-1 h-8 text-body rounded-[var(--radius-md)]",
                "border transition-all duration-[var(--transition-fast)]",
                "capitalize cursor-pointer",
                prefs.cursorStyle === style
                  ? "border-accent-primary bg-accent-muted text-text-primary"
                  : "border-border-default bg-bg-secondary text-text-secondary hover:border-border-hover",
              ].join(" ")}
            >
              {style}
            </button>
          ))}
        </div>
      </div>

      {/* Cursor Blink */}
      <div className="flex items-center justify-between">
        <label className="text-body font-medium text-text-primary">
          Cursor Blink
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={prefs.cursorBlink}
          onClick={() => update("cursorBlink", !prefs.cursorBlink)}
          className={[
            "relative inline-flex h-5 w-9 items-center rounded-full",
            "transition-colors duration-[var(--transition-fast)]",
            "cursor-pointer",
            prefs.cursorBlink ? "bg-accent-primary" : "bg-bg-active",
          ].join(" ")}
        >
          <span
            className={[
              "inline-block h-3.5 w-3.5 rounded-full bg-white",
              "transition-transform duration-[var(--transition-fast)]",
              prefs.cursorBlink ? "translate-x-[18px]" : "translate-x-[3px]",
            ].join(" ")}
          />
        </button>
      </div>

      {/* Preview */}
      <div className="space-y-1.5">
        <label className="text-body font-medium text-text-tertiary">
          Preview
        </label>
        <div
          className="rounded-[var(--radius-md)] border border-border-default bg-bg-primary p-3"
          style={{
            fontFamily: `"${prefs.fontFamily}", monospace`,
            fontSize: `${prefs.fontSize}px`,
            lineHeight: 1.5,
          }}
        >
          <span className="text-status-idle">$</span>{" "}
          <span className="text-text-primary">npm run dev</span>
        </div>
      </div>
    </div>
  );
}

export { TerminalSettings };

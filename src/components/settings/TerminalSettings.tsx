import { useEffect, useState } from "react";
import type { TerminalPreferences } from "../../services/terminalPreferences";
import { loadTerminalPreferences, saveTerminalPreferences } from "../../services/terminalPreferences";

const FONT_FAMILIES = [
  "JetBrains Mono",
  "SF Mono",
  "Fira Code",
  "Menlo",
  "Monaco",
  "Cascadia Code",
] as const;

function TerminalSettings() {
  const [prefs, setPrefs] = useState<TerminalPreferences>(loadTerminalPreferences);

  useEffect(() => {
    saveTerminalPreferences(prefs);
  }, [prefs]);

  const update = <K extends keyof TerminalPreferences>(
    key: K,
    value: TerminalPreferences[K],
  ) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-5">
      <p className="text-xs text-text-tertiary mb-5">Terminal changes apply immediately to all sessions.</p>

      {/* Font section */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-3">Font</div>

        {/* Family */}
        <div className="space-y-1.5 mb-4">
          <div className="text-sm font-medium text-text-primary mb-1.5">Family</div>
          <select
            value={prefs.fontFamily}
            onChange={(e) => update("fontFamily", e.target.value)}
            className={[
              "h-8 w-full px-3 text-sm",
              "bg-bg-primary text-text-primary",
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

        {/* Size */}
        <div className="space-y-1.5 mb-4">
          <div className="text-sm font-medium text-text-primary mb-1.5">
            Size{" "}
            <span className="font-normal text-text-secondary">
              {prefs.fontSize}px
            </span>
          </div>
          <input
            type="range"
            min={10}
            max={20}
            step={1}
            value={prefs.fontSize}
            onChange={(e) => update("fontSize", Number(e.target.value))}
            className="w-full accent-accent-primary cursor-pointer"
          />
          <div className="flex justify-between text-xs text-text-tertiary">
            <span>10px</span>
            <span>20px</span>
          </div>
        </div>

        {/* Line Height */}
        <div className="space-y-1.5 mb-4">
          <div className="text-sm font-medium text-text-primary mb-1.5">
            Line Height{" "}
            <span className="font-normal text-text-secondary">
              {prefs.lineHeight.toFixed(1)}
            </span>
          </div>
          <input
            type="range"
            min={1.0}
            max={1.8}
            step={0.1}
            value={prefs.lineHeight}
            onChange={(e) => update("lineHeight", Number(e.target.value))}
            className="w-full accent-accent-primary cursor-pointer"
          />
          <div className="flex justify-between text-xs text-text-tertiary">
            <span>Tight</span>
            <span>Relaxed</span>
          </div>
        </div>

        {/* Letter Spacing */}
        <div className="space-y-1.5">
          <div className="text-sm font-medium text-text-primary mb-1.5">
            Letter Spacing{" "}
            <span className="font-normal text-text-secondary">
              {prefs.letterSpacing}px
            </span>
          </div>
          <input
            type="range"
            min={-1}
            max={3}
            step={0.5}
            value={prefs.letterSpacing}
            onChange={(e) => update("letterSpacing", Number(e.target.value))}
            className="w-full accent-accent-primary cursor-pointer"
          />
          <div className="flex justify-between text-xs text-text-tertiary">
            <span>Tight</span>
            <span>Wide</span>
          </div>
        </div>
      </div>

      {/* Cursor section */}
      <div className="mt-6">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-3 mt-8">Cursor</div>

        {/* Style */}
        <div className="space-y-1.5 mb-4">
          <div className="text-sm font-medium text-text-primary mb-1.5">Style</div>
          <div className="flex gap-2">
            {(["block", "underline", "bar"] as const).map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => update("cursorStyle", style)}
                className={[
                  "flex-1 h-8 text-sm rounded-[var(--radius-md)]",
                  "border transition-all duration-[var(--transition-fast)]",
                  "capitalize cursor-pointer",
                  prefs.cursorStyle === style
                    ? "border-accent-primary bg-accent-muted text-text-primary"
                    : "border-border-default bg-bg-primary text-text-secondary hover:border-border-hover",
                ].join(" ")}
              >
                {style}
              </button>
            ))}
          </div>
        </div>

        {/* Blink */}
        <div className="flex items-center justify-between py-1.5">
          <span className="text-sm text-text-secondary">Blink</span>
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
      </div>

      {/* Preview section */}
      <div className="mt-6">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-3 mt-8">Preview</div>
        <div
          className="rounded-[var(--radius-md)] border border-border-default bg-bg-primary p-3"
          style={{
            fontFamily: `"${prefs.fontFamily}", monospace`,
            fontSize: `${prefs.fontSize}px`,
            lineHeight: prefs.lineHeight,
            letterSpacing: `${prefs.letterSpacing}px`,
          }}
        >
          <div><span className="text-status-idle">$</span>{" "}
          <span className="text-text-primary">npm run dev</span></div>
          <div className="text-text-secondary">Ready in 1.2s</div>
        </div>
      </div>
    </div>
  );
}

export { TerminalSettings };

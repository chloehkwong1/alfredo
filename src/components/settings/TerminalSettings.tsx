import { useEffect, useState } from "react";
import type { TerminalPreferences } from "../../services/terminalPreferences";
import { TERMINAL_COLOR_SCHEMES, loadTerminalPreferences, saveTerminalPreferences } from "../../services/terminalPreferences";

const FONT_FAMILIES = [
  "JetBrains Mono",
  "SF Mono",
  "Fira Code",
  "Menlo",
  "Monaco",
  "Cascadia Code",
] as const;

const selectClass = [
  "h-8 w-full px-3 text-[13px]",
  "bg-bg-primary text-text-primary",
  "border border-border-default rounded-[var(--radius-md)]",
  "hover:border-border-hover",
  "focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-accent-primary/50",
  "transition-all duration-[var(--transition-fast)]",
  "cursor-pointer",
].join(" ");

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
    <div>
      <p className="text-xs text-text-tertiary mb-5">Terminal changes apply immediately to all sessions.</p>

      {/* Colour scheme */}
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary mb-3.5">Colour Scheme</div>

      <div className="grid grid-cols-2 gap-2.5 mb-8">
        {TERMINAL_COLOR_SCHEMES.map((scheme) => {
          const selected = prefs.colorScheme === scheme.id;
          const ansi = [scheme.theme.red, scheme.theme.green, scheme.theme.yellow, scheme.theme.blue, scheme.theme.magenta, scheme.theme.cyan];
          return (
            <button
              key={scheme.id}
              type="button"
              onClick={() => update("colorScheme", scheme.id)}
              className={[
                "p-2.5 text-left rounded-[var(--radius-md)] border cursor-pointer",
                "transition-all duration-[var(--transition-fast)]",
                selected
                  ? "border-accent-primary ring-1 ring-accent-primary/50"
                  : "border-border-default hover:border-border-hover",
              ].join(" ")}
            >
              <div
                className="h-12 rounded-[var(--radius-sm)] px-2.5 py-2 font-mono text-[11px] overflow-hidden"
                style={{ backgroundColor: scheme.theme.background, color: scheme.theme.foreground }}
              >
                <div><span style={{ color: scheme.theme.green }}>$</span> npm run dev</div>
                <div className="flex gap-1 mt-1">
                  {ansi.map((color, index) => (
                    <span key={index} className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                  ))}
                </div>
              </div>
              <div className="mt-2 text-[13px] font-medium text-text-primary">{scheme.name}</div>
              <div className="mt-0.5 text-[11px] text-text-tertiary">{scheme.description}</div>
            </button>
          );
        })}
      </div>

      {/* Font */}
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary mb-3.5">Font</div>

      <div className="mb-4">
        <div className="text-[13px] font-medium text-text-primary mb-1.5">Family</div>
        <select
          value={prefs.fontFamily}
          onChange={(e) => update("fontFamily", e.target.value)}
          className={selectClass}
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      <div className="mb-4">
        <div className="text-[13px] font-medium text-text-primary mb-2">
          Size <span className="font-normal text-text-secondary">{prefs.fontSize}px</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={10}
            max={20}
            step={1}
            value={prefs.fontSize}
            onChange={(e) => update("fontSize", Number(e.target.value))}
            className="flex-1 accent-accent-primary cursor-pointer"
          />
          <span className="text-xs text-text-secondary w-9 text-right">{prefs.fontSize}px</span>
        </div>
      </div>

      <div className="mb-4">
        <div className="text-[13px] font-medium text-text-primary mb-2">
          Line Height <span className="font-normal text-text-secondary">{prefs.lineHeight.toFixed(1)}</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1.0}
            max={1.8}
            step={0.1}
            value={prefs.lineHeight}
            onChange={(e) => update("lineHeight", Number(e.target.value))}
            className="flex-1 accent-accent-primary cursor-pointer"
          />
          <span className="text-xs text-text-secondary w-9 text-right">{prefs.lineHeight.toFixed(1)}</span>
        </div>
      </div>

      <div className="mb-0">
        <div className="text-[13px] font-medium text-text-primary mb-2">
          Letter Spacing <span className="font-normal text-text-secondary">{prefs.letterSpacing}px</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={-1}
            max={3}
            step={0.5}
            value={prefs.letterSpacing}
            onChange={(e) => update("letterSpacing", Number(e.target.value))}
            className="flex-1 accent-accent-primary cursor-pointer"
          />
          <span className="text-xs text-text-secondary w-9 text-right">{prefs.letterSpacing}px</span>
        </div>
      </div>

      {/* Cursor */}
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary mb-3.5 mt-8">Cursor</div>

      <div className="mb-4">
        <div className="text-[13px] font-medium text-text-primary mb-1.5">Style</div>
        <div className="flex gap-1.5">
          {(["block", "underline", "bar"] as const).map((style) => (
            <button
              key={style}
              type="button"
              onClick={() => update("cursorStyle", style)}
              className={[
                "flex-1 h-8 text-xs font-medium rounded-[var(--radius-md)]",
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

      <div className="flex items-center justify-between py-2">
        <span className="text-[13px] text-text-secondary">Blink</span>
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
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary mb-3.5 mt-8">Preview</div>
      <div
        className="rounded-[var(--radius-md)] border border-border-default bg-bg-primary px-3.5 py-3"
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
  );
}

export { TerminalSettings };

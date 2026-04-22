import { useState, useEffect } from "react";
import { CatLogo } from "../ui/CatLogo";
import type { TabType } from "../../types";

const AGENT_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
};

const HOOK_HINT_DELAY_MS = 3_000;

interface TerminalLoadingScreenProps {
  tabType: TabType;
  visible: boolean;
  /**
   * Keystrokes the user has typed before the agent started reading stdin.
   * They're already buffered in the kernel PTY; this just mirrors them back
   * so typing doesn't feel invisible during slow SessionStart hooks.
   */
  typedPreview?: string;
}

function TerminalLoadingScreen({ tabType, visible, typedPreview }: TerminalLoadingScreenProps) {
  const [fadeOut, setFadeOut] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!visible) {
      setFadeOut(true);
      const timer = setTimeout(() => setHidden(true), 300);
      return () => clearTimeout(timer);
    }
    setFadeOut(false);
    setHidden(false);
    setElapsedSeconds(0);
    const interval = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1_000);
    return () => clearInterval(interval);
  }, [visible]);

  if (hidden) return null;

  const label = AGENT_LABELS[tabType] ?? tabType;
  const showHookHint = elapsedSeconds * 1_000 >= HOOK_HINT_DELAY_MS;
  const hasPreview = !!typedPreview && typedPreview.length > 0;

  return (
    <div
      className={`absolute inset-0 z-20 flex flex-col items-center justify-center bg-bg-primary transition-opacity duration-300 ${
        fadeOut ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      <CatLogo
        aria-hidden
        className="w-12 h-12 opacity-20 select-none pointer-events-none text-white mb-4"
      />
      {/* Screen-reader-announced status: only the stable "starting" + hint text,
          not the per-keystroke preview below, which would spam AT users. */}
      <div role="status" aria-live="polite">
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <span>Starting {label}</span>
          <span aria-hidden className="inline-flex items-center gap-[3px]">
            <span className="w-[3px] h-[3px] rounded-full bg-text-tertiary animate-thinking-dot-1" />
            <span className="w-[3px] h-[3px] rounded-full bg-text-tertiary animate-thinking-dot-2" />
            <span className="w-[3px] h-[3px] rounded-full bg-text-tertiary animate-thinking-dot-3" />
          </span>
          {elapsedSeconds > 0 && (
            <span aria-hidden className="text-xs text-text-tertiary tabular-nums">{elapsedSeconds}s</span>
          )}
        </div>
        {showHookHint && (
          <div className="mt-3 max-w-md px-3 text-center text-xs text-text-tertiary">
            Waiting for {label} SessionStart hooks to finish. Long startup hooks
            (e.g. claude-mem corpus priming) block the UI until they return.
          </div>
        )}
      </div>
      {hasPreview && (
        <div className="mt-4 max-w-md w-full px-4" aria-hidden>
          <div className="text-[11px] uppercase tracking-wide text-text-tertiary mb-1">
            Queued input
          </div>
          <div className="font-mono text-xs text-text-secondary bg-bg-secondary border border-border-default rounded px-2 py-1.5 whitespace-pre-wrap break-words">
            {typedPreview}
            <span className="inline-block w-[6px] h-[12px] align-[-2px] ml-[1px] bg-text-secondary animate-pulse" />
          </div>
        </div>
      )}
    </div>
  );
}

export { TerminalLoadingScreen };

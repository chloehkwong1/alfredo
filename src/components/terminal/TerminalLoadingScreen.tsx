import { useState, useEffect } from "react";
import logoSvg from "../../assets/logo-cat.svg";
import type { TabType } from "../../types";

const AGENT_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
};

interface TerminalLoadingScreenProps {
  tabType: TabType;
  visible: boolean;
}

function TerminalLoadingScreen({ tabType, visible }: TerminalLoadingScreenProps) {
  const [fadeOut, setFadeOut] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!visible) {
      setFadeOut(true);
      const timer = setTimeout(() => setHidden(true), 300);
      return () => clearTimeout(timer);
    }
    setFadeOut(false);
    setHidden(false);
  }, [visible]);

  if (hidden) return null;

  const label = AGENT_LABELS[tabType] ?? tabType;

  return (
    <div
      className={`absolute inset-0 z-20 flex flex-col items-center justify-center bg-bg-primary transition-opacity duration-300 ${
        fadeOut ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      <img
        src={logoSvg}
        alt=""
        className="w-12 h-12 opacity-20 select-none pointer-events-none brightness-0 invert mb-4"
        draggable={false}
      />
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <span>Starting {label}</span>
        <span className="inline-flex items-center gap-[3px]">
          <span className="w-[3px] h-[3px] rounded-full bg-text-tertiary animate-thinking-dot-1" />
          <span className="w-[3px] h-[3px] rounded-full bg-text-tertiary animate-thinking-dot-2" />
          <span className="w-[3px] h-[3px] rounded-full bg-text-tertiary animate-thinking-dot-3" />
        </span>
      </div>
    </div>
  );
}

export { TerminalLoadingScreen };

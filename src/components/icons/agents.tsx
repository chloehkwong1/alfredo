import type { ComponentType, SVGProps } from "react";

interface AgentIconProps {
  size?: number;
  className?: string;
  "aria-hidden"?: boolean;
}

/** Anthropic Claude mark: stylized asterisk/spiral. Monochrome via currentColor. */
export function ClaudeIcon({ size = 16, className, ...rest }: AgentIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden={rest["aria-hidden"] ?? true}
    >
      <path d="M12 2.5l2.1 5.3 5.4 1.1-4 3.8 1.1 5.3-4.6-2.8-4.6 2.8 1.1-5.3-4-3.8 5.4-1.1z" />
    </svg>
  );
}

/** OpenAI Codex mark: swirl/knot silhouette. */
export function CodexIcon({ size = 16, className, ...rest }: AgentIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={rest["aria-hidden"] ?? true}
    >
      <path d="M12 3a4 4 0 0 1 4 4v1" />
      <path d="M16 8a4 4 0 0 1 4 4v1" />
      <path d="M20 13a4 4 0 0 1-4 4h-1" />
      <path d="M15 17a4 4 0 0 1-4 4h-1" />
      <path d="M10 21a4 4 0 0 1-4-4v-1" />
      <path d="M6 16a4 4 0 0 1-2-3.5" />
      <path d="M4 11a4 4 0 0 1 4-4h1" />
      <path d="M9 7a4 4 0 0 1 3-4" />
    </svg>
  );
}

/** Google Gemini mark: 4-pointed sparkle. */
export function GeminiIcon({ size = 16, className, ...rest }: AgentIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden={rest["aria-hidden"] ?? true}
    >
      <path d="M12 2c.2 4.4 3.4 7.6 7.8 7.8 0 .2 0 .4 0 .4-4.4.2-7.6 3.4-7.8 7.8-.2 0-.4 0-.4 0-.2-4.4-3.4-7.6-7.8-7.8 0-.2 0-.4 0-.4C8.2 9.6 11.4 6.4 11.6 2c.2 0 .4 0 .4 0z" />
    </svg>
  );
}

export type AgentIconComponent = ComponentType<AgentIconProps>;

/** Centralized agent → icon mapping. Import this everywhere an agent needs an icon. */
export const AGENT_ICONS: Record<"claude" | "codex" | "gemini", AgentIconComponent> = {
  claude: ClaudeIcon,
  codex: CodexIcon,
  gemini: GeminiIcon,
};

// Satisfy eslint unused-import check if SVGProps ends up unreferenced.
export type _Unused = SVGProps<SVGSVGElement>;

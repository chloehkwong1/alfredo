interface LogoProps {
  size?: number;
  color?: string;
  className?: string;
}

/**
 * Alfredo cat silhouette logo.
 * A clean, minimal sitting cat outline — brand identity element.
 */
function Logo({ size = 32, color = "currentColor", className = "" }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Alfredo"
    >
      {/* Sitting cat silhouette — ears, head, body, tail */}
      <path
        d="M18 8 L14 22 Q13 26 16 28 L16 28 Q12 30 12 36 L12 48 Q12 54 18 56 L28 56 Q30 56 30 54 L30 50 Q30 48 28 48 L24 48 Q20 48 20 44 L20 38 Q20 34 24 32 L40 32 Q44 34 44 38 L44 44 Q44 48 40 48 L36 48 Q34 48 34 50 L34 54 Q34 56 36 56 L46 56 Q52 54 52 48 L52 36 Q52 30 48 28 Q51 26 50 22 L46 8 Q44 4 40 10 L38 16 Q34 14 32 14 Q30 14 26 16 L24 10 Q22 4 18 8 Z"
        fillRule="evenodd"
      />
      {/* Eyes */}
      <circle cx="25" cy="22" r="2" fill="var(--bg-primary, #1a1918)" />
      <circle cx="39" cy="22" r="2" fill="var(--bg-primary, #1a1918)" />
    </svg>
  );
}

export { Logo };
export type { LogoProps };

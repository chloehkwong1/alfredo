import type { HTMLAttributes } from "react";

type BadgeVariant = "idle" | "busy" | "waiting" | "error" | "default";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const dotColorClasses: Record<BadgeVariant, string> = {
  idle: "bg-status-idle",
  busy: "bg-status-busy",
  waiting: "bg-status-waiting",
  error: "bg-status-error",
  default: "bg-text-tertiary",
};

const textColorClasses: Record<BadgeVariant, string> = {
  idle: "text-status-idle",
  busy: "text-status-busy",
  waiting: "text-status-waiting",
  error: "text-status-error",
  default: "text-text-secondary",
};

function Badge({
  variant = "default",
  className = "",
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5",
        "text-caption font-medium",
        "px-2 py-0.5 rounded-full",
        "bg-bg-hover/50",
        textColorClasses[variant],
        className,
      ].join(" ")}
      {...props}
    >
      <span
        className={["h-1.5 w-1.5 rounded-full", dotColorClasses[variant]].join(
          " ",
        )}
      />
      {children}
    </span>
  );
}

export { Badge };
export type { BadgeProps, BadgeVariant };

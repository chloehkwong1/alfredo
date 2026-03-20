import { forwardRef, type ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-accent-primary text-text-on-accent hover:bg-accent-secondary active:bg-accent-secondary/80 shadow-sm",
  secondary:
    "bg-transparent text-text-primary border border-border-default hover:border-border-hover hover:bg-bg-hover active:bg-bg-active",
  ghost:
    "bg-transparent text-text-secondary hover:text-text-primary hover:bg-bg-hover active:bg-bg-active",
  danger:
    "bg-danger text-white hover:bg-danger-hover active:bg-danger-hover/80 shadow-sm",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5 rounded-[var(--radius-sm)]",
  md: "h-8 px-3 text-sm gap-2 rounded-[var(--radius-md)]",
  lg: "h-10 px-4 text-sm gap-2 rounded-[var(--radius-md)]",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className = "", children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={[
          "inline-flex items-center justify-center font-medium",
          "transition-all duration-[var(--transition-fast)]",
          "focus-ring cursor-pointer",
          "disabled:opacity-50 disabled:pointer-events-none",
          variantClasses[variant],
          sizeClasses[size],
          className,
        ].join(" ")}
        {...props}
      >
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";

export { Button };
export type { ButtonProps, ButtonVariant, ButtonSize };

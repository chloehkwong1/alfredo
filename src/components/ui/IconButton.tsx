import { forwardRef, type ButtonHTMLAttributes } from "react";

type IconButtonSize = "sm" | "md" | "lg";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize;
  label: string;
  /** Pressed/open state (e.g. a popover the button controls is open). Swaps the
   *  base colour classes instead of relying on className overrides, which lose
   *  to the base at equal specificity depending on CSS emission order. */
  active?: boolean;
}

const sizeClasses: Record<IconButtonSize, string> = {
  sm: "h-7 w-7 rounded-[var(--radius-sm)]",
  md: "h-8 w-8 rounded-[var(--radius-md)]",
  lg: "h-10 w-10 rounded-[var(--radius-md)]",
};

const iconSizeClasses: Record<IconButtonSize, string> = {
  sm: "[&>svg]:h-3.5 [&>svg]:w-3.5",
  md: "[&>svg]:h-4 [&>svg]:w-4",
  lg: "[&>svg]:h-5 [&>svg]:w-5",
};

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ size = "md", label, active = false, className = "", children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={active || undefined}
        className={[
          "inline-flex items-center justify-center",
          active
            ? "text-accent-primary bg-bg-hover"
            : "text-text-secondary hover:text-text-primary bg-transparent hover:bg-bg-hover active:bg-bg-active",
          "transition-all duration-[var(--transition-fast)]",
          "focus-ring cursor-pointer",
          "disabled:opacity-50 disabled:pointer-events-none",
          sizeClasses[size],
          iconSizeClasses[size],
          className,
        ].join(" ")}
        {...props}
      >
        {children}
      </button>
    );
  },
);

IconButton.displayName = "IconButton";

export { IconButton };
export type { IconButtonProps, IconButtonSize };

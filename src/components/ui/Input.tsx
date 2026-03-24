import { forwardRef, type InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", ...props }, ref) => {
    return (
      <input
        ref={ref}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className={[
          "h-8 w-full px-3 text-sm",
          "bg-bg-secondary text-text-primary",
          "border border-border-default rounded-[var(--radius-md)]",
          "placeholder:text-text-tertiary",
          "hover:border-border-hover",
          "focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-accent-primary/50",
          "transition-all duration-[var(--transition-fast)]",
          "disabled:opacity-50 disabled:pointer-events-none",
          className,
        ].join(" ")}
        {...props}
      />
    );
  },
);

Input.displayName = "Input";

export { Input };
export type { InputProps };

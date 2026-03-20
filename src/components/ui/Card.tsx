import { forwardRef, type HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ hoverable = false, className = "", children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={[
          "bg-bg-elevated border border-border-default",
          "rounded-[var(--radius-lg)] shadow-sm",
          "transition-all duration-[var(--transition-normal)]",
          "animate-card-in",
          hoverable &&
            "hover:border-border-hover hover:shadow-md hover:-translate-y-0.5",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...props}
      >
        {children}
      </div>
    );
  },
);

Card.displayName = "Card";

export { Card };
export type { CardProps };

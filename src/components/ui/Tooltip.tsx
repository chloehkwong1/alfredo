import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
}

function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={300}>{children}</RadixTooltip.Provider>
  );
}

function Tooltip({
  children,
  content,
  side = "top",
  delayDuration,
}: TooltipProps) {
  return (
    <RadixTooltip.Root delayDuration={delayDuration}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className={[
            "z-50 px-2.5 py-1.5 text-caption font-medium",
            "bg-bg-elevated text-text-primary",
            "border border-border-default",
            "rounded-[var(--radius-md)] shadow-md",
            "animate-in fade-in-0 zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          ].join(" ")}
        >
          {content}
          <RadixTooltip.Arrow className="fill-bg-elevated" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

export { Tooltip, TooltipProvider };
export type { TooltipProps };

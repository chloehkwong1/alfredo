import * as RadixContextMenu from "@radix-ui/react-context-menu";
import { forwardRef } from "react";

const ContextMenu = RadixContextMenu.Root;
const ContextMenuTrigger = RadixContextMenu.Trigger;

const ContextMenuContent = forwardRef<
  HTMLDivElement,
  RadixContextMenu.ContextMenuContentProps
>(({ className = "", children, ...props }, ref) => (
  <RadixContextMenu.Portal>
    <RadixContextMenu.Content
      ref={ref}
      className={[
        "z-50 min-w-[160px] p-1",
        "bg-bg-elevated border border-border-default",
        "rounded-[var(--radius-lg)] shadow-lg",
        "animate-in fade-in-0 zoom-in-95",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </RadixContextMenu.Content>
  </RadixContextMenu.Portal>
));

ContextMenuContent.displayName = "ContextMenuContent";

const ContextMenuItem = forwardRef<
  HTMLDivElement,
  RadixContextMenu.ContextMenuItemProps
>(({ className = "", ...props }, ref) => (
  <RadixContextMenu.Item
    ref={ref}
    className={[
      "flex items-center gap-2 px-2 py-1.5",
      "text-body text-text-primary",
      "rounded-[var(--radius-sm)] cursor-pointer",
      "outline-none",
      "data-[highlighted]:bg-bg-hover data-[highlighted]:text-text-primary",
      "transition-colors duration-[var(--transition-fast)]",
      className,
    ].join(" ")}
    {...props}
  />
));

ContextMenuItem.displayName = "ContextMenuItem";

function ContextMenuSeparator({ className = "" }: { className?: string }) {
  return (
    <RadixContextMenu.Separator
      className={["h-px my-1 bg-border-default", className].join(" ")}
    />
  );
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
};

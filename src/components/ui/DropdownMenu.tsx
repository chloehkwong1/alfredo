import * as RadixDropdownMenu from "@radix-ui/react-dropdown-menu";
import { forwardRef, type ReactNode } from "react";

const DropdownMenu = RadixDropdownMenu.Root;
const DropdownMenuTrigger = RadixDropdownMenu.Trigger;

const DropdownMenuContent = forwardRef<
  HTMLDivElement,
  RadixDropdownMenu.DropdownMenuContentProps
>(({ className = "", children, ...props }, ref) => (
  <RadixDropdownMenu.Portal>
    <RadixDropdownMenu.Content
      ref={ref}
      sideOffset={4}
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
    </RadixDropdownMenu.Content>
  </RadixDropdownMenu.Portal>
));

DropdownMenuContent.displayName = "DropdownMenuContent";

const DropdownMenuItem = forwardRef<
  HTMLDivElement,
  RadixDropdownMenu.DropdownMenuItemProps
>(({ className = "", ...props }, ref) => (
  <RadixDropdownMenu.Item
    ref={ref}
    className={[
      "flex items-center gap-2 px-2 py-1.5",
      "text-sm text-text-primary",
      "rounded-[var(--radius-sm)] cursor-pointer",
      "outline-none",
      "data-[highlighted]:bg-bg-hover data-[highlighted]:text-text-primary",
      "transition-colors duration-[var(--transition-fast)]",
      className,
    ].join(" ")}
    {...props}
  />
));

DropdownMenuItem.displayName = "DropdownMenuItem";

function DropdownMenuSeparator({
  className = "",
}: {
  className?: string;
}) {
  return (
    <RadixDropdownMenu.Separator
      className={["h-px my-1 bg-border-default", className].join(" ")}
    />
  );
}

function DropdownMenuLabel({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <RadixDropdownMenu.Label
      className={[
        "px-2 py-1.5 text-xs font-medium text-text-tertiary",
        className,
      ].join(" ")}
    >
      {children}
    </RadixDropdownMenu.Label>
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
};

import * as RadixDialog from "@radix-ui/react-dialog";
import { forwardRef, type ReactNode } from "react";
import { X } from "lucide-react";

const Dialog = RadixDialog.Root;
const DialogTrigger = RadixDialog.Trigger;
const DialogClose = RadixDialog.Close;

const DialogOverlay = forwardRef<
  HTMLDivElement,
  RadixDialog.DialogOverlayProps
>(({ className = "", ...props }, ref) => (
  <RadixDialog.Overlay
    ref={ref}
    className={[
      "fixed inset-0 z-50 bg-black/60",
      "data-[state=open]:animate-in data-[state=open]:fade-in-0",
      "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
      className,
    ].join(" ")}
    {...props}
  />
));

DialogOverlay.displayName = "DialogOverlay";

const DialogContent = forwardRef<
  HTMLDivElement,
  RadixDialog.DialogContentProps
>(({ className = "", children, ...props }, ref) => (
  <RadixDialog.Portal>
    <DialogOverlay />
    <RadixDialog.Content
      ref={ref}
      className={[
        "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
        "w-full p-7",
        "border border-border-default",
        "rounded-[var(--radius-lg)] shadow-lg",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
        "focus:outline-none",
        className,
      ].join(" ")}
      style={{ backgroundColor: "var(--bg-secondary)" }}
      {...props}
    >
      {children}
      <RadixDialog.Close
        className={[
          "absolute right-4 top-4",
          "text-text-tertiary hover:text-text-primary",
          "h-7 w-7 rounded-[6px]",
          "flex items-center justify-center",
          "hover:bg-bg-hover",
          "transition-colors duration-[var(--transition-fast)]",
          "focus-ring cursor-pointer",
        ].join(" ")}
      >
        <X className="h-4 w-4" />
      </RadixDialog.Close>
    </RadixDialog.Content>
  </RadixDialog.Portal>
));

DialogContent.displayName = "DialogContent";

function DialogHeader({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={["mb-5 space-y-1.5", className].join(" ")}>{children}</div>
  );
}

function DialogTitle({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <RadixDialog.Title
      className={["text-subheading font-semibold text-text-primary", className].join(
        " ",
      )}
    >
      {children}
    </RadixDialog.Title>
  );
}

function DialogDescription({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <RadixDialog.Description
      className={["text-body text-text-tertiary", className].join(" ")}
    >
      {children}
    </RadixDialog.Description>
  );
}

function DialogFooter({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={[
        "mt-7 pt-5 flex items-center justify-end gap-3 border-t border-border-default",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
};

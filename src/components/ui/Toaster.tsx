import { Loader2 } from "lucide-react";
import { useToastStore } from "../../stores/toastStore";

/** Singleton toast surface — mount once near the App root. Standard toasts stack
 *  bottom-right; `variant: "progress"` toasts render prominently at top-center
 *  with a spinner (for in-flight actions). Clicking the close glyph or letting
 *  the duration elapse removes them. */
function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  const progress = toasts.filter((t) => t.variant === "progress");
  const standard = toasts.filter((t) => t.variant !== "progress");

  return (
    <>
      {progress.length > 0 && (
        <div
          role="region"
          aria-label="In progress"
          className="fixed top-5 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none"
        >
          {progress.map((t) => (
            <div
              key={t.id}
              role="status"
              className={[
                "pointer-events-auto inline-flex items-center gap-3",
                "px-5 py-3.5 max-w-[520px]",
                "bg-bg-elevated border border-accent-primary/40",
                "rounded-[var(--radius-md)] shadow-xl",
                "text-[14px] font-medium text-text-primary",
                "animate-in fade-in-0 slide-in-from-top-2 duration-150",
              ].join(" ")}
            >
              <Loader2 className="h-4 w-4 text-accent-primary animate-spin flex-shrink-0" />
              <span className="flex-1 min-w-0">{t.message}</span>
            </div>
          ))}
        </div>
      )}

      {standard.length > 0 && (
        <div
          role="region"
          aria-label="Notifications"
          className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none"
        >
          {standard.map((t) => (
            <div
              key={t.id}
              role="status"
              className={[
                "pointer-events-auto inline-flex items-center gap-3",
                "px-3.5 py-2.5 max-w-[460px]",
                "bg-bg-elevated border border-border-default",
                "rounded-[var(--radius-md)] shadow-lg",
                "text-[12px] text-text-primary",
                "animate-in fade-in-0 slide-in-from-bottom-2 duration-150",
              ].join(" ")}
            >
              <span className="flex-1 min-w-0">{t.message}</span>
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                  className="text-accent-primary font-medium hover:text-accent-secondary cursor-pointer flex-shrink-0"
                >
                  {t.action.label}
                </button>
              )}
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => dismiss(t.id)}
                className="text-text-tertiary hover:text-text-secondary cursor-pointer flex-shrink-0 leading-none"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export { Toaster };

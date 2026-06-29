import { useToastStore } from "../../stores/toastStore";

/** Singleton toast surface — mount once near the App root. Toasts stack
 *  bottom-right, fade in via the existing `card-in` keyframe. Clicking the
 *  close glyph or letting the duration elapse removes them. */
function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Notifications"
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none"
    >
      {toasts.map((t) => (
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
  );
}

export { Toaster };

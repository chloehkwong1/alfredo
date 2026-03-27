import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

interface CollapsibleSectionProps {
  title: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

function CollapsibleSection({
  title,
  badge,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-border-subtle">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2 hover:bg-bg-hover transition-colors"
      >
        <ChevronRight
          className={[
            "h-3.5 w-3.5 text-text-tertiary transition-transform",
            open ? "rotate-90" : "",
          ].join(" ")}
        />
        <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">
          {title}
        </span>
        {badge && <span className="ml-auto">{badge}</span>}
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

export { CollapsibleSection };

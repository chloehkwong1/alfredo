import { Smartphone } from "lucide-react";
import { useRemoteControlStore } from "../../stores/remoteControlStore";

interface RemoteControlIconProps {
  worktreeId: string;
  hasActiveSession: boolean;
  onToggle: (worktreeId: string) => void;
}

function RemoteControlIcon({ worktreeId, hasActiveSession, onToggle }: RemoteControlIconProps) {
  const isActive = useRemoteControlStore((s) => worktreeId in s.sessions);
  const disabled = !hasActiveSession && !isActive;

  return (
    <button
      type="button"
      title={
        disabled
          ? "No active session"
          : isActive
            ? "Remote Control: On"
            : "Remote Control: Off"
      }
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(worktreeId);
      }}
      className={[
        "flex-shrink-0 p-0 bg-transparent border-none cursor-pointer transition-all duration-[var(--transition-fast)]",
        disabled ? "opacity-30 cursor-not-allowed" : "",
        isActive
          ? "text-accent-primary drop-shadow-[0_0_4px_var(--accent-primary)]"
          : "text-fg-tertiary hover:text-text-secondary",
      ].join(" ")}
    >
      <Smartphone size={14} />
    </button>
  );
}

export { RemoteControlIcon };

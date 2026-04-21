import { HelpCircle } from "lucide-react";

interface AskButtonProps {
  onClick: () => void;
  isOpen: boolean;
}

export function AskButton({ onClick, isOpen }: AskButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-label={isOpen ? "Close Ask Alfredo" : "Ask Alfredo"}
      title={isOpen ? "Close Ask Alfredo" : "Ask Alfredo"}
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        height: 30,
        width: 30,
        borderRadius: 9999,
        background: "var(--bg-elevated)",
        color: "var(--text-secondary)",
        border: "1px solid var(--border-default)",
        boxShadow: "var(--shadow-md)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        zIndex: 40,
      }}
    >
      <HelpCircle size={14} />
    </button>
  );
}

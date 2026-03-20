import { Logo } from "../Logo";
import { Button } from "../ui/Button";
import { FolderOpen } from "lucide-react";

interface WelcomeScreenProps {
  onOpenRepository: () => void;
}

function WelcomeScreen({ onOpenRepository }: WelcomeScreenProps) {
  return (
    <div className="flex-1 flex items-center justify-center h-full">
      <div className="flex flex-col items-center text-center max-w-md px-6">
        {/* Logo with gradient background */}
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center mb-6 shadow-lg">
          <Logo size={48} color="var(--text-on-accent)" />
        </div>

        <h1 className="text-2xl font-semibold text-text-primary mb-2">
          Welcome to Alfredo
        </h1>

        <p className="text-sm text-text-secondary mb-6 leading-relaxed">
          Manage your AI coding agents across worktrees. Get started by opening
          a repository.
        </p>

        <Button size="lg" onClick={onOpenRepository}>
          <FolderOpen className="h-4 w-4" />
          Open repository...
        </Button>

        <p className="text-xs text-text-tertiary mt-4">
          or drag a folder here
        </p>
      </div>
    </div>
  );
}

export { WelcomeScreen };
export type { WelcomeScreenProps };

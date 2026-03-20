import { Button } from "../ui/Button";
import logoSvg from "../../assets/logo-cat.svg";
import { FolderOpen } from "lucide-react";

interface WelcomeScreenProps {
  onOpenRepository: () => void;
}

function WelcomeScreen({ onOpenRepository }: WelcomeScreenProps) {
  return (
    <div className="flex-1 flex items-center justify-center h-full">
      <div className="flex flex-col items-center text-center max-w-lg px-6 -mt-16">
        <img src={logoSvg} alt="Alfredo" width={64} height={64} className="mb-5 opacity-80" />

        <h1 className="text-2xl font-semibold text-text-primary mb-2">
          Welcome to Alfredo
        </h1>

        <p className="text-base text-text-secondary mb-10 leading-relaxed">
          Manage your AI coding agents across git worktrees.
          <br />
          Open a repository to get started.
        </p>

        <Button size="lg" onClick={onOpenRepository}>
          <FolderOpen className="h-4 w-4" />
          Open repository...
        </Button>

        <p className="text-xs text-text-tertiary mt-6">
          or drag a folder here
        </p>
      </div>
    </div>
  );
}

export { WelcomeScreen };
export type { WelcomeScreenProps };

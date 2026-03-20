import { Button } from "../ui/Button";
import logoSvg from "../../assets/logo-cat.svg";
import { FolderOpen } from "lucide-react";

interface WelcomeScreenProps {
  onOpenRepository: () => void;
}

function WelcomeScreen({ onOpenRepository }: WelcomeScreenProps) {
  return (
    <div className="flex-1 flex items-center justify-center h-full">
      <div className="flex flex-col items-center text-center max-w-md px-6 -mt-12">
        <img src={logoSvg} alt="Alfredo" width={72} height={72} className="mb-8" />

        <h1 className="text-2xl font-semibold text-text-primary mb-3">
          Welcome to Alfredo
        </h1>

        <p className="text-sm text-text-secondary mb-8 leading-relaxed">
          Manage your AI coding agents across worktrees. Get started by opening
          a repository.
        </p>

        <Button size="lg" onClick={onOpenRepository}>
          <FolderOpen className="h-4 w-4" />
          Open repository...
        </Button>

        <p className="text-xs text-text-tertiary mt-5">
          or drag a folder here
        </p>
      </div>
    </div>
  );
}

export { WelcomeScreen };
export type { WelcomeScreenProps };

import { Input } from "../ui/Input";

interface GithubSettingsProps {
  githubToken: string;
  linearApiKey: string;
  onGithubTokenChange: (value: string) => void;
  onLinearApiKeyChange: (value: string) => void;
}

function GithubSettings({
  githubToken,
  linearApiKey,
  onGithubTokenChange,
  onLinearApiKeyChange,
}: GithubSettingsProps) {
  return (
    <div className="space-y-5">
      {/* GitHub Token */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-text-primary">
          GitHub Token
        </label>
        <Input
          type="password"
          placeholder="ghp_xxxxxxxxxxxx"
          value={githubToken}
          onChange={(e) => onGithubTokenChange(e.target.value)}
        />
        <p className="text-xs text-text-tertiary">
          Used for PR status sync. Requires <code>repo</code> scope.
        </p>
      </div>

      {/* Linear API Key */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-text-primary">
          Linear API Key
        </label>
        <Input
          type="password"
          placeholder="lin_api_xxxxxxxxxxxx"
          value={linearApiKey}
          onChange={(e) => onLinearApiKeyChange(e.target.value)}
        />
        <p className="text-xs text-text-tertiary">
          Used for creating worktrees from Linear tickets.
        </p>
      </div>
    </div>
  );
}

export { GithubSettings };

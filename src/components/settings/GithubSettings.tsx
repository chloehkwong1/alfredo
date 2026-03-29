import { useCallback, useEffect, useState } from "react";
import { Github, Check, Loader2, Terminal } from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import {
  githubAuthStatus,
  githubAuthToken,
  saveConfig,
  getConfig,
} from "../../api";

interface GithubSettingsProps {
  githubToken: string;
  linearApiKey: string;
  onGithubTokenChange: (value: string) => void;
  onLinearApiKeyChange: (value: string) => void;
}

type AuthState =
  | { step: "checking" }
  | { step: "not-installed" }
  | { step: "not-authenticated" }
  | { step: "connected"; username: string };

function GithubSettings({
  githubToken,
  linearApiKey,
  onGithubTokenChange,
  onLinearApiKeyChange,
}: GithubSettingsProps) {
  const [auth, setAuth] = useState<AuthState>({ step: "checking" });
  const [error, setError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    setAuth({ step: "checking" });
    setError(null);
    try {
      const status = await githubAuthStatus();
      if (!status.installed) {
        setAuth({ step: "not-installed" });
      } else if (!status.authenticated) {
        setAuth({ step: "not-authenticated" });
      } else {
        // Authenticated — grab token and persist
        const token = await githubAuthToken();
        onGithubTokenChange(token);

        const config = await getConfig(".");
        config.githubToken = token;
        await saveConfig(".", config);

        setAuth({ step: "connected", username: status.username ?? "unknown" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setAuth({ step: "not-authenticated" });
    }
  }, [onGithubTokenChange]);

  // Check on mount
  useEffect(() => {
    if (githubToken) {
      // Already have a token — verify gh is still authed
      githubAuthStatus()
        .then((status) => {
          if (status.authenticated && status.username) {
            setAuth({ step: "connected", username: status.username });
          } else {
            // Token stale, re-check
            checkStatus();
          }
        })
        .catch(() => checkStatus());
    } else {
      checkStatus();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {/* GitHub Connection */}
      <div className="mb-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary mb-3.5">GitHub</div>

        {auth.step === "checking" && (
          <div className="flex items-center gap-2 text-xs text-text-tertiary">
            <Loader2 className="h-3 w-3 animate-spin" />
            Checking GitHub CLI...
          </div>
        )}

        {auth.step === "not-installed" && (
          <div className="space-y-2">
            <div className="rounded-[var(--radius-md)] border border-border-default bg-bg-primary p-3 space-y-2">
              <p className="text-sm text-text-secondary">
                GitHub CLI (<code className="text-xs font-mono bg-bg-primary px-1 py-0.5 rounded">gh</code>) is not installed.
              </p>
              <p className="text-xs text-text-tertiary">
                Install it with <code className="font-mono bg-bg-primary px-1 py-0.5 rounded">brew install gh</code>, then run <code className="font-mono bg-bg-primary px-1 py-0.5 rounded">gh auth login</code>.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={checkStatus}>
              <Terminal className="h-3.5 w-3.5 mr-1.5" />
              Re-check
            </Button>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        )}

        {auth.step === "not-authenticated" && (
          <div className="space-y-2">
            <div className="rounded-[var(--radius-md)] border border-border-default bg-bg-primary p-3 space-y-2">
              <p className="text-sm text-text-secondary">
                GitHub CLI is installed but not authenticated.
              </p>
              <p className="text-xs text-text-tertiary">
                Run <code className="font-mono bg-bg-primary px-1 py-0.5 rounded">gh auth login</code> in your terminal, then click Re-check.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={checkStatus}>
              <Github className="h-3.5 w-3.5 mr-1.5" />
              Re-check
            </Button>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        )}

        {auth.step === "connected" && (
          <div>
            <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border-default bg-bg-primary px-3 h-8 text-sm">
              <Check className="h-3.5 w-3.5 text-green-400" />
              <span className="text-text-primary font-medium">
                @{auth.username}
              </span>
            </div>
            <p className="text-xs text-text-tertiary mt-[5px]">
              Authenticated via GitHub CLI. Run <code className="font-mono bg-bg-primary px-1 py-0.5 rounded">gh auth login</code> to switch accounts.
            </p>
          </div>
        )}
      </div>

      {/* Linear API Key */}
      <div className="mb-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary mb-3.5 mt-8">Linear</div>
        <div className="text-[13px] font-medium text-text-primary mb-1.5">API Key</div>
        <Input
          type="password"
          placeholder="lin_api_xxxxxxxxxxxx"
          value={linearApiKey}
          onChange={(e) => onLinearApiKeyChange(e.target.value)}
        />
        <p className="text-xs text-text-tertiary mt-[5px]">
          Used for creating worktrees from Linear tickets.
        </p>
      </div>
    </div>
  );
}

export { GithubSettings };

import { useCallback, useEffect, useState } from "react";
import { Github, Check, Loader2, ExternalLink, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import {
  githubAuthStart,
  githubAuthPoll,
  githubAuthUser,
  githubAuthDisconnect,
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
  | { step: "idle" }
  | { step: "waiting"; userCode: string; verificationUri: string }
  | { step: "connected"; username: string };

function GithubSettings({
  githubToken,
  linearApiKey,
  onGithubTokenChange,
  onLinearApiKeyChange,
}: GithubSettingsProps) {
  const [auth, setAuth] = useState<AuthState>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // On mount, check if we already have a token and resolve username
  useEffect(() => {
    if (!githubToken) return;
    githubAuthUser(githubToken)
      .then((username) => setAuth({ step: "connected", username }))
      .catch(() => setAuth({ step: "idle" }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startAuth = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const device = await githubAuthStart();
      setAuth({
        step: "waiting",
        userCode: device.userCode,
        verificationUri: device.verificationUri,
      });
      setLoading(false);

      // Open browser
      await openUrl(device.verificationUri);

      // Poll blocks on the Rust side until authorized or failed
      const token = await githubAuthPoll(device.deviceCode, device.interval);

      onGithubTokenChange(token);
      const username = await githubAuthUser(token);
      setAuth({ step: "connected", username });

      // Persist immediately so sync loop picks it up
      const config = await getConfig(".");
      config.githubToken = token;
      await saveConfig(".", config);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setAuth({ step: "idle" });
      setLoading(false);
    }
  }, [onGithubTokenChange]);

  const disconnect = useCallback(async () => {
    onGithubTokenChange("");
    setAuth({ step: "idle" });
    setError(null);
    try {
      await githubAuthDisconnect(".");
    } catch {
      // Best effort
    }
  }, [onGithubTokenChange]);

  return (
    <div className="space-y-5">
      {/* GitHub Connection */}
      <div className="space-y-1.5">
        <label className="text-body font-medium text-text-primary">GitHub</label>

        {auth.step === "idle" && (
          <div className="space-y-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={startAuth}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Github className="h-3.5 w-3.5 mr-1.5" />
              )}
              Connect to GitHub
            </Button>
            <p className="text-caption text-text-tertiary">
              Authorizes Alfredo to read your repos and PRs.
            </p>
            {error && (
              <p className="text-caption text-red-400">{error}</p>
            )}
          </div>
        )}

        {auth.step === "waiting" && (
          <div className="rounded-[var(--radius-md)] border border-border-default bg-bg-secondary p-3 space-y-2">
            <p className="text-body text-text-secondary">
              Enter this code on GitHub:
            </p>
            <div className="flex items-center gap-3">
              <code className="text-lg font-mono font-bold text-text-primary tracking-widest bg-bg-primary px-3 py-1.5 rounded-[var(--radius-sm)] border border-border-default select-all">
                {auth.userCode}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => openUrl(auth.verificationUri)}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                Open GitHub
              </Button>
            </div>
            <div className="flex items-center gap-2 text-caption text-text-tertiary">
              <Loader2 className="h-3 w-3 animate-spin" />
              Waiting for authorization...
            </div>
          </div>
        )}

        {auth.step === "connected" && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border-default bg-bg-secondary px-3 h-8 text-body">
              <Check className="h-3.5 w-3.5 text-green-400" />
              <span className="text-text-primary font-medium">
                @{auth.username}
              </span>
            </div>
            <Button variant="secondary" size="sm" onClick={disconnect}>
              <X className="h-3.5 w-3.5 mr-1" />
              Disconnect
            </Button>
          </div>
        )}
      </div>

      {/* Linear API Key */}
      <div className="space-y-1.5">
        <label className="text-body font-medium text-text-primary">
          Linear API Key
        </label>
        <Input
          type="password"
          placeholder="lin_api_xxxxxxxxxxxx"
          value={linearApiKey}
          onChange={(e) => onLinearApiKeyChange(e.target.value)}
        />
        <p className="text-caption text-text-tertiary">
          Used for creating worktrees from Linear tickets.
        </p>
      </div>
    </div>
  );
}

export { GithubSettings };

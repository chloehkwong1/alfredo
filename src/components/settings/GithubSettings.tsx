import { useCallback, useEffect, useRef, useState } from "react";
import { Github, Check, Loader2, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import {
  githubAuthExchange,
  githubAuthUser,
  githubAuthDisconnect,
  saveConfig,
  getConfig,
} from "../../api";

const INSTALL_URL = "https://github.com/apps/alfredo-desktop/installations/new";
const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface GithubSettingsProps {
  githubToken: string;
  linearApiKey: string;
  onGithubTokenChange: (value: string) => void;
  onLinearApiKeyChange: (value: string) => void;
}

type AuthState =
  | { step: "idle" }
  | { step: "waiting" }
  | { step: "connected"; username: string };

function GithubSettings({
  githubToken,
  linearApiKey,
  onGithubTokenChange,
  onLinearApiKeyChange,
}: GithubSettingsProps) {
  const [auth, setAuth] = useState<AuthState>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On mount, check if we already have a token and resolve username
  useEffect(() => {
    if (!githubToken) return;
    githubAuthUser(githubToken)
      .then((username) => setAuth({ step: "connected", username }))
      .catch(() => setAuth({ step: "idle" }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup listeners and timeouts on unmount
  useEffect(() => {
    return () => {
      unlistenRef.current?.();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const startAuth = useCallback(async () => {
    setError(null);
    setAuth({ step: "waiting" });

    try {
      // Listen for the deep link callback from Tauri
      unlistenRef.current?.();
      const unlisten = await listen<{ code: string; installationId?: string }>(
        "github-auth-callback",
        async (event) => {
          try {
            const { code, installationId } = event.payload;
            const token = await githubAuthExchange(code);

            onGithubTokenChange(token);
            const username = await githubAuthUser(token);
            setAuth({ step: "connected", username });

            // Persist immediately so sync loop picks it up
            const config = await getConfig(".");
            config.githubToken = token;
            if (installationId) {
              config.githubInstallationId = Number(installationId);
            }
            await saveConfig(".", config);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setAuth({ step: "idle" });
          } finally {
            unlisten();
            unlistenRef.current = null;
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
          }
        }
      );
      unlistenRef.current = unlisten;

      // Also listen for errors
      const unlistenError = await listen<{ error: string }>(
        "github-auth-callback-error",
        (event) => {
          setError(event.payload.error);
          setAuth({ step: "idle" });
          unlisten();
          unlistenError();
          unlistenRef.current = null;
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
        }
      );

      // Timeout after 5 minutes
      timeoutRef.current = setTimeout(() => {
        unlisten();
        unlistenError();
        unlistenRef.current = null;
        setError("Timed out waiting for GitHub authorization. Please try again.");
        setAuth({ step: "idle" });
      }, AUTH_TIMEOUT_MS);

      // Open the GitHub App installation page
      await openUrl(INSTALL_URL);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setAuth({ step: "idle" });
    }
  }, [onGithubTokenChange]);

  const cancelAuth = useCallback(() => {
    unlistenRef.current?.();
    unlistenRef.current = null;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setAuth({ step: "idle" });
    setError(null);
  }, []);

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
        <label className="text-sm font-medium text-text-primary">GitHub</label>

        {auth.step === "idle" && (
          <div className="space-y-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={startAuth}
            >
              <Github className="h-3.5 w-3.5 mr-1.5" />
              Connect to GitHub
            </Button>
            <p className="text-xs text-text-tertiary">
              Installs the Alfredo app on your GitHub account to access repos and PRs.
            </p>
            {error && (
              <p className="text-xs text-red-400">{error}</p>
            )}
          </div>
        )}

        {auth.step === "waiting" && (
          <div className="rounded-[var(--radius-md)] border border-border-default bg-bg-secondary p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Waiting for GitHub authorization...
              </div>
              <Button variant="secondary" size="sm" onClick={cancelAuth}>
                <X className="h-3.5 w-3.5 mr-1" />
                Cancel
              </Button>
            </div>
            <p className="text-xs text-text-tertiary">
              Complete the installation in your browser, then return here.
            </p>
          </div>
        )}

        {auth.step === "connected" && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border-default bg-bg-secondary px-3 h-8 text-sm">
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

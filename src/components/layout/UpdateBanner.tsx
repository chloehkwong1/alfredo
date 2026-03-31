import { ArrowUpCircle, CheckCircle, X, ExternalLink } from "lucide-react";
import { Button } from "../ui/Button";
import type { UpdateState } from "../../hooks/useUpdater";

interface UpdateBannerProps {
  updater: UpdateState;
}

export function UpdateBanner({ updater }: UpdateBannerProps) {
  const { status, version, progress, update, restart, dismiss, openReleaseNotes } = updater;

  if (status === "idle") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2.5 px-3 py-2 bg-bg-secondary border-b border-border-default text-xs text-text-secondary shrink-0"
      style={{ minHeight: 36 }}
    >
      {status === "ready" ? (
        <CheckCircle size={16} className="text-status-idle shrink-0" />
      ) : (
        <ArrowUpCircle size={16} className="text-accent-primary shrink-0" />
      )}

      {status === "available" && (
        <>
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <span>Update available —</span>
            <VersionBadge version={version} />
            <button
              onClick={openReleaseNotes}
              className="inline-flex items-center gap-1 text-text-tertiary hover:text-accent-primary hover:underline cursor-pointer ml-0.5"
              style={{ fontSize: 11 }}
            >
              Release notes
              <ExternalLink size={10} />
            </button>
          </div>
          <Button variant="primary" size="sm" onClick={update}>
            Update &amp; restart
          </Button>
        </>
      )}

      {status === "downloading" && (
        <>
          <span>Downloading update...</span>
          <div className="flex items-center gap-2 flex-1">
            <div className="h-1 rounded-sm bg-bg-tertiary overflow-hidden" style={{ maxWidth: 140, flex: 1 }}>
              <div
                className="h-full rounded-sm bg-accent-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="font-mono text-text-tertiary" style={{ fontSize: 11, width: 28 }}>
              {progress}%
            </span>
          </div>
        </>
      )}

      {status === "ready" && (
        <>
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <span>Update ready — restart to apply</span>
            <VersionBadge version={version} />
          </div>
          <Button variant="primary" size="sm" onClick={restart}>
            Restart now
          </Button>
        </>
      )}

      {status !== "downloading" && (
        <button
          onClick={dismiss}
          className="w-5 h-5 flex items-center justify-center rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-tertiary cursor-pointer shrink-0"
          aria-label="Dismiss update notification"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function VersionBadge({ version }: { version: string | null }) {
  if (!version) return null;
  return (
    <span
      className="font-mono font-semibold text-status-idle rounded"
      style={{ fontSize: 11, padding: "1px 6px", background: "rgba(52, 211, 153, 0.1)" }}
    >
      v{version}
    </span>
  );
}

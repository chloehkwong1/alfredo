import { Copy, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { useRemoteControlStore } from "../../stores/remoteControlStore";
import { Button, Dialog, DialogContent, DialogTrigger, DialogTitle, DialogDescription } from "../ui";

interface RemoteControlBarProps {
  worktreeId: string;
}

function RemoteControlBar({ worktreeId }: RemoteControlBarProps) {
  const session = useRemoteControlStore((s) => s.sessions[worktreeId]);
  const disable = useRemoteControlStore((s) => s.disable);
  const [copied, setCopied] = useState(false);

  if (!session) return null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(session.sessionUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDisconnect = () => {
    disable(worktreeId);
  };

  return (
    <div className="h-14 flex items-center gap-4 px-4 bg-bg-secondary border-t border-border-subtle flex-shrink-0 animate-slide-up">
      {/* QR Code — click to enlarge */}
      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            className="flex-shrink-0 rounded overflow-hidden bg-white p-1 cursor-pointer hover:ring-2 hover:ring-accent-primary/50 transition-shadow"
          >
            <QRCodeSVG value={session.sessionUrl} size={40} />
          </button>
        </DialogTrigger>
        <DialogContent className="!w-auto !max-w-none flex flex-col items-center gap-4">
          <DialogTitle className="sr-only">Remote Control QR Code</DialogTitle>
          <DialogDescription className="sr-only">
            Scan to connect a remote device
          </DialogDescription>
          <div className="rounded-lg overflow-hidden bg-white p-3">
            <QRCodeSVG value={session.sessionUrl} size={200} />
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="text-xs text-text-secondary hover:text-text-primary font-mono transition-colors"
            title="Click to copy"
          >
            {copied ? "Copied!" : "Click to copy URL"}
          </button>
        </DialogContent>
      </Dialog>

      {/* URL + copy */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-xs text-text-secondary truncate font-mono">
          {session.sessionUrl}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex-shrink-0 text-text-tertiary hover:text-text-secondary transition-colors"
          title="Copy URL"
        >
          <Copy size={14} />
        </button>
        {copied && (
          <span className="text-2xs text-accent-primary flex-shrink-0">Copied!</span>
        )}
      </div>

      {/* Status */}
      <span className="flex items-center gap-1.5 text-xs flex-shrink-0">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        <span className="text-text-tertiary">Waiting</span>
      </span>

      {/* Disconnect */}
      <Button
        variant="secondary"
        onClick={handleDisconnect}
        className="flex-shrink-0 h-7 px-2 text-xs gap-1"
      >
        <X size={12} />
        Disconnect
      </Button>
    </div>
  );
}

export { RemoteControlBar };

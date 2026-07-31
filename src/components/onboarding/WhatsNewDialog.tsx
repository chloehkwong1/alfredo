import { ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/Dialog";
import { Button } from "../ui/Button";
import { MarkdownBody } from "../shared/MarkdownBody";
import { VersionBadge } from "../layout/UpdateBanner";
import type { WhatsNewEntry } from "../../types";

const RELEASES_URL = "https://github.com/chloehkwong1/alfredo/releases";

interface WhatsNewDialogProps {
  entries: WhatsNewEntry[];
  open: boolean;
  onDismiss: () => void;
}

export function WhatsNewDialog({ entries, open, onDismiss }: WhatsNewDialogProps) {
  if (entries.length === 0) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Every close path — button, Esc, backdrop, the X — marks as seen.
        if (!next) onDismiss();
      }}
    >
      <DialogContent className="w-[620px] max-w-[92vw]">
        <DialogHeader>
          <DialogTitle>What's new in Alfredo</DialogTitle>
          <DialogDescription>
            {entries.length === 1
              ? "Here's what landed in the latest release."
              : `Here's what landed across the last ${entries.length} releases.`}
          </DialogDescription>
        </DialogHeader>

        <div
          className="flex flex-col gap-6 overflow-y-auto pr-1"
          style={{ maxHeight: "52vh" }}
          tabIndex={0}
        >
          {entries.map((entry) => (
            <section key={entry.version}>
              <div className="mb-2 flex items-baseline gap-2">
                <VersionBadge version={entry.version} />
                <span className="text-text-tertiary" style={{ fontSize: 11 }}>
                  {entry.date}
                </span>
              </div>
              <MarkdownBody text={entry.body} compact />
            </section>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => openUrl(RELEASES_URL)}>
            Full release notes
            <ExternalLink size={12} />
          </Button>
          <Button variant="primary" size="sm" onClick={onDismiss}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

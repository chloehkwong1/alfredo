import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/Dialog";

const SHORTCUT_GROUPS = [
  {
    label: "Navigation",
    shortcuts: [
      { keys: "⌘ 1–9", description: "Jump to worktree by position" },
    ],
  },
  {
    label: "Tabs & Panes",
    shortcuts: [
      { keys: "⌘ ⇧ P", description: "Command palette" },
      { keys: "⌘ R", description: "Reload app" },
      { keys: "⌘ ⇧ R", description: "Add repository" },
      { keys: "⌘ N", description: "New worktree" },
      { keys: "⌘ T", description: "New tab" },
      { keys: "⌘ W", description: "Close tab" },
      { keys: "⌘ \\", description: "Split pane right" },
      { keys: "⌘ ⇧ \\", description: "Split pane down" },
      { keys: "⌘ ⇧ C", description: "Toggle changes panel" },
      { keys: "⌘ ⇧ T", description: "Switch to terminal tab" },
    ],
  },
  {
    label: "Panels",
    shortcuts: [
      { keys: "⌘ B", description: "Toggle sidebar" },
      { keys: "⌘ I", description: "Toggle changes panel" },
    ],
  },
  {
    label: "Search",
    shortcuts: [
      { keys: "⌘ F", description: "Search (terminal or file filter)" },
    ],
  },
  {
    label: "Changes View",
    shortcuts: [
      { keys: "] / n", description: "Next file" },
      { keys: "[ / p", description: "Previous file" },
      { keys: "x", description: "Toggle file collapse" },
    ],
  },
  {
    label: "Help",
    shortcuts: [
      { keys: "⌘ ?", description: "Show keyboard shortcuts" },
    ],
  },
];

interface ShortcutsOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ShortcutsOverlay({ open, onOpenChange }: ShortcutsOverlayProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[480px] p-6">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-0 overflow-y-auto max-h-[70vh]">
          {SHORTCUT_GROUPS.map((group, index) => (
            <div key={group.label} className={index > 0 ? "pt-5 mt-5 border-t border-border-default" : ""}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary mb-2">
                {group.label}
              </div>
              <div className="space-y-1">
                {group.shortcuts.map((shortcut) => (
                  <div key={shortcut.keys} className="flex items-center justify-between gap-4 py-1.5">
                    <span className="text-[13px] text-text-secondary truncate min-w-0">
                      {shortcut.description}
                    </span>
                    <kbd className="px-2 py-0.5 text-[11px] font-mono bg-bg-primary text-text-primary rounded border border-border-default whitespace-nowrap flex-shrink-0">
                      {shortcut.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { ShortcutsOverlay };

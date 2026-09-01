import { useCallback } from "react";
import { Smartphone } from "lucide-react";
import { OpenInDropdown } from "../ui/OpenInDropdown";
import { toggleRemoteControl } from "../../services/remoteControl";
import { useRemoteControlStore } from "../../stores/remoteControlStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useTabStore } from "../../stores/tabStore";
import { useLayoutStore } from "../../stores/layoutStore";

interface SettingsStatusBarProps {
  worktreeId: string;
}

function SettingsStatusBar({ worktreeId }: SettingsStatusBarProps) {
  const worktree = useWorkspaceStore((s) => s.worktrees.find((wt) => wt.id === worktreeId));
  const worktreePath = worktree?.path ?? "";

  // Pick the Claude tab to target for Remote. Only mounted tabs can respond
  // (TerminalView only mounts for the pane's active tab) — so we look across
  // panes for whichever has a Claude tab as its active tab.
  const tabs = useTabStore((s) => s.tabs[worktreeId] ?? []);
  const allPanes = useLayoutStore((s) => s.panes[worktreeId]);
  const claudeTargetTab = Object.values(allPanes ?? {})
    .map((p) => tabs.find((t) => t.id === p.activeTabId))
    .find((t) => t?.type === "claude");
  const sessionKey = claudeTargetTab?.id ?? "";

  const linearTicketUrl = useWorkspaceStore(
    useCallback((s) => s.worktrees.find((wt) => wt.id === worktreeId)?.linearTicketUrl, [worktreeId]),
  );

  const isRcActive = useRemoteControlStore(
    useCallback((s) => sessionKey in s.sessions, [sessionKey]),
  );

  const handleToggleRemote = useCallback(() => {
    if (!sessionKey) return;
    toggleRemoteControl(sessionKey);
  }, [sessionKey]);

  return (
    <div className="flex items-center justify-end px-2 py-1 border-t border-border-default flex-shrink-0">
      <div className="flex items-center gap-2">
        {!!claudeTargetTab && (
          <button
            type="button"
            onClick={handleToggleRemote}
            className={[
              "flex items-center gap-1 text-xs transition-all cursor-pointer",
              isRcActive
                ? "text-accent-primary drop-shadow-[0_0_4px_var(--accent-primary)]"
                : "text-text-tertiary hover:text-text-secondary",
            ].join(" ")}
            title={isRcActive ? "Remote Control: On" : "Remote Control: Off"}
          >
            <Smartphone size={13} />
            Remote
          </button>
        )}
        <OpenInDropdown worktreePath={worktreePath} linearTicketUrl={linearTicketUrl} />
      </div>
    </div>
  );
}

export { SettingsStatusBar };

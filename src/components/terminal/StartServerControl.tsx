import * as RadixDropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { getConfig, listWorktrees, takeWorktreePort } from "../../api";
import { useAppConfig } from "../../hooks/useAppConfig";
import { sessionManager } from "../../services/sessionManager";
import { usePortPickerStore } from "../../stores/portPickerStore";
import { useTabStore } from "../../stores/tabStore";
import { useToastStore } from "../../stores/toastStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import {
  REPO_COLOR_PALETTE,
  getRepoColor,
  repoBadgeLabel,
  resolveColorId,
} from "../sidebar/RepoSelector";
import { PortPicker, type PickerSlot } from "../settings/PortPicker";

interface Props {
  worktreeId: string;
  isServerRunning: boolean;
  runScriptName: string;
  /** Parent's existing toggle handler — runs the silent auto-assign + start
   *  flow for the left half of the split-button. The split-button doesn't
   *  reimplement Start logic; it only adds the picker doorway. */
  onToggleServer: () => void;
}

function StartServerControl({
  worktreeId,
  isServerRunning,
  runScriptName,
  onToggleServer,
}: Props) {
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState<PickerSlot[]>([]);
  const [autoAssignEnabled, setAutoAssignEnabled] = useState<boolean | null>(null);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);

  const worktree = useWorkspaceStore((s) =>
    s.worktrees.find((w) => w.id === worktreeId),
  );
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const runningServers = useWorkspaceStore((s) => s.runningServers);
  const setWorktreesForRepo = useWorkspaceStore((s) => s.setWorktreesForRepo);
  const setRunningServer = useWorkspaceStore((s) => s.setRunningServer);
  const { repoColors, repoDisplayNames, repoShortLabels, repos } = useAppConfig();
  const showToast = useToastStore((s) => s.show);

  const pendingForStart = usePortPickerStore((s) => s.pendingForStart);
  const resolveStart = usePortPickerStore((s) => s.resolveStart);
  const cancelStart = usePortPickerStore((s) => s.cancelStart);

  const repoPath = worktree?.repoPath;
  const targetBranch = worktree?.branch ?? worktreeId;

  // useServer auto-opens the picker via this store when its silent claim hits
  // rangeFull. Watch for requests targeting our worktree and open locally.
  useEffect(() => {
    if (
      pendingForStart &&
      pendingForStart.worktreeId === worktreeId &&
      !open
    ) {
      setOpen(true);
    }
  }, [pendingForStart, worktreeId, open]);

  // Hydrate slots whenever the picker opens (or its inputs change while open).
  // We re-fetch config rather than relying on a global config snapshot because
  // port_assignments can change underneath us if another worktree just claimed.
  useEffect(() => {
    if (!open || !repoPath) return;
    let cancelled = false;
    (async () => {
      try {
        const config = await getConfig(repoPath);
        if (cancelled) return;
        const rangeStart = config.portRangeStart;
        const rangeEnd = config.portRangeEnd;
        const enabled = config.autoAssignPorts === true && rangeStart != null && rangeEnd != null && rangeStart <= rangeEnd;
        setAutoAssignEnabled(enabled);
        if (!enabled) {
          setSlots([]);
          setRange(null);
          return;
        }
        setRange({ start: rangeStart!, end: rangeEnd! });
        setSlots(
          buildSlots({
            rangeStart: rangeStart!,
            rangeEnd: rangeEnd!,
            assignments: config.portAssignments ?? {},
            selfWorktreeId: worktreeId,
            worktrees,
            runningServers,
            repoColors,
            repoDisplayNames,
            repoShortLabels,
            repos: repos ?? [],
            fallbackRepoPath: repoPath,
          }),
        );
      } catch (e) {
        console.error("[port-picker] failed to load config", e);
        setAutoAssignEnabled(false);
        setSlots([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, repoPath, worktreeId, worktrees, runningServers, repoColors, repoDisplayNames, repoShortLabels, repos]);

  async function handleTake(slot: PickerSlot) {
    if (!repoPath || slot.kind === "self") return;

    // If the holder has a running server, stop it first. Capture enough state
    // to surface a non-blocking toast afterwards. The take_worktree_port
    // backend command is atomic on the assignment side; we orchestrate the
    // session-stop here because session state lives in the frontend.
    let stoppedHolderBranch: string | null = null;
    if (slot.kind === "held" && slot.isRunning) {
      const holderRunning = runningServers[slot.worktreeName];
      if (holderRunning) {
        stoppedHolderBranch = slot.branch;
        try {
          await sessionManager.stopSession(holderRunning.tabId);
          useTabStore
            .getState()
            .updateTab(slot.worktreeName, holderRunning.tabId, { command: undefined });
          setRunningServer(slot.worktreeName, null);
        } catch (e) {
          console.warn("[port-picker] failed to stop holder server", e);
          // Continue — the take itself is the important bit. Worst case the
          // holder's server is still running on the OS port and the new
          // claimant's bind will fail; that surfaces as a server error.
        }
      }
    }

    const result = await takeWorktreePort(repoPath, worktreeId, slot.port);
    if (result.kind === "disabled") {
      throw new Error("Auto-assign ports is off — enable it in repo settings to manage ports.");
    }

    // Refresh worktrees so sidebar chips update immediately.
    try {
      const fresh = await listWorktrees(repoPath);
      setWorktreesForRepo(repoPath, fresh);
    } catch (e) {
      console.warn("[port-picker] post-take refresh failed", e);
    }

    // Resolve any pending useServer-driven open so its Start path continues.
    if (
      pendingForStart &&
      pendingForStart.worktreeId === worktreeId
    ) {
      resolveStart(pendingForStart.token, slot.port);
    }

    if (stoppedHolderBranch) {
      showToast({
        message: (
          <span>
            Took <strong>:{slot.port}</strong> from{" "}
            <strong className="font-medium">{stoppedHolderBranch}</strong> · server stopped
          </span>
        ),
      });
    }

    setOpen(false);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next && pendingForStart && pendingForStart.worktreeId === worktreeId) {
      // User dismissed the picker that useServer was waiting on — abort the
      // Start-server flow rather than spawning without a port.
      cancelStart(pendingForStart.token);
    }
  }

  function handleStartClick(e: React.MouseEvent<HTMLButtonElement>) {
    if (e.altKey && !isServerRunning) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    onToggleServer();
  }

  // Caret only makes sense when starting (not stopping) and when auto-assign
  // is configured. Hiding it when the picker can't do anything keeps the
  // button surface clean for users who haven't enabled port management.
  // We optimistically show the caret unless we've already loaded config and
  // confirmed it's disabled — avoids flicker on first open.
  const showCaret = !isServerRunning && autoAssignEnabled !== false;

  const baseClasses = [
    "inline-flex items-center gap-1.5 h-6 text-xs font-medium border transition-colors",
    isServerRunning
      ? "text-red-400 hover:text-red-300 bg-red-400/10 hover:bg-red-400/20 border-red-400/25"
      : "text-green-500 hover:text-green-400 bg-green-500/10 hover:bg-green-500/20 border-green-500/25",
  ].join(" ");

  return (
    <RadixDropdownMenu.Root open={open} onOpenChange={handleOpenChange}>
      <div className="inline-flex items-stretch flex-shrink-0">
        <button
          type="button"
          aria-label={
            isServerRunning ? `Stop ${runScriptName}` : `Start ${runScriptName}`
          }
          title={
            !isServerRunning && showCaret
              ? `Start ${runScriptName} · Alt-click to pick a port`
              : undefined
          }
          onClick={handleStartClick}
          className={[
            baseClasses,
            "px-2.5",
            showCaret ? "rounded-l border-r-0" : "rounded",
          ].join(" ")}
        >
          {isServerRunning ? (
            <Square size={10} fill="currentColor" />
          ) : (
            <Play size={10} fill="currentColor" />
          )}
          {isServerRunning ? `Stop ${runScriptName}` : `Start ${runScriptName}`}
        </button>

        {showCaret && (
          <RadixDropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label="Pick a port"
              title="Pick a port"
              className={[baseClasses, "px-1.5 rounded-r"].join(" ")}
            >
              <ChevronDown size={10} />
            </button>
          </RadixDropdownMenu.Trigger>
        )}
      </div>

      <RadixDropdownMenu.Portal>
        <RadixDropdownMenu.Content
          align="end"
          sideOffset={4}
          className={[
            "z-50 bg-bg-elevated border border-border-default",
            "rounded-[var(--radius-lg)] shadow-lg overflow-hidden",
            "animate-in fade-in-0 zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          ].join(" ")}
        >
          {range && autoAssignEnabled ? (
            <PortPicker
              rangeStart={range.start}
              rangeEnd={range.end}
              targetBranch={targetBranch}
              slots={slots}
              onTake={handleTake}
            />
          ) : (
            <div className="w-[300px] p-3 text-[12px] text-text-secondary">
              {autoAssignEnabled === false
                ? "Auto-assign ports isn't enabled for this repo."
                : "Loading…"}
            </div>
          )}
        </RadixDropdownMenu.Content>
      </RadixDropdownMenu.Portal>
    </RadixDropdownMenu.Root>
  );
}

interface BuildSlotsArgs {
  rangeStart: number;
  rangeEnd: number;
  assignments: Record<string, number>;
  selfWorktreeId: string;
  worktrees: ReturnType<typeof useWorkspaceStore.getState>["worktrees"];
  runningServers: ReturnType<typeof useWorkspaceStore.getState>["runningServers"];
  repoColors: Record<string, string>;
  repoDisplayNames: Record<string, string>;
  repoShortLabels: Record<string, string>;
  repos: { path: string }[];
  fallbackRepoPath: string;
}

function buildSlots({
  rangeStart,
  rangeEnd,
  assignments,
  selfWorktreeId,
  worktrees,
  runningServers,
  repoColors,
  repoDisplayNames,
  repoShortLabels,
  repos,
  fallbackRepoPath,
}: BuildSlotsArgs): PickerSlot[] {
  // Invert the worktree → port map into port → worktree for the slot list.
  // Multiple assignments to the same port shouldn't happen, but defend with
  // first-wins so a corrupted config doesn't crash the picker.
  const portToWorktree = new Map<number, string>();
  for (const [name, port] of Object.entries(assignments)) {
    if (!portToWorktree.has(port)) portToWorktree.set(port, name);
  }

  const slots: PickerSlot[] = [];
  for (let port = rangeStart; port <= rangeEnd; port++) {
    const holderName = portToWorktree.get(port);
    if (!holderName) {
      slots.push({ kind: "free", port });
      continue;
    }
    if (holderName === selfWorktreeId) {
      slots.push({ kind: "self", port });
      continue;
    }

    const wt = worktrees.find((w) => w.id === holderName);
    const branch = wt?.branch ?? holderName;
    const repoPath = wt?.repoPath ?? fallbackRepoPath;
    const colorId = resolveColorId(repoColors[repoPath]);
    const palette = colorId
      ? REPO_COLOR_PALETTE.find((c) => c.id === colorId)
      : undefined;
    const fallback =
      palette ??
      (repos.some((r) => r.path === repoPath)
        ? getRepoColor(repos.findIndex((r) => r.path === repoPath))
        : REPO_COLOR_PALETTE.find((c) => c.id === "slate") ?? REPO_COLOR_PALETTE[0]);

    slots.push({
      kind: "held",
      port,
      worktreeName: holderName,
      branch,
      isRunning: !!runningServers[holderName],
      chip: {
        label: repoBadgeLabel(repoPath, repoDisplayNames, repoShortLabels),
        bg: fallback.bg,
        text: fallback.text,
      },
    });
  }
  return slots;
}

export { StartServerControl };

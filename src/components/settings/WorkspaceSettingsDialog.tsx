import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive as ArchiveIcon,
  Check,
  Copy,
  Edit2,
  ExternalLink,
  FileText,
  FolderOpen,
  MoreVertical,
  Play,
  PlayCircle,
  RotateCcw,
} from "lucide-react";
import type {
  AppConfig,
  GlobalAppConfig,
  RepoEntry,
  RepoMode,
  RepoOverrideFlags,
} from "../../types";
import {
  getConfig,
  saveConfig,
  getAppConfig,
  saveAppConfig,
  setRepoMode,
  listWorktrees,
} from "../../api";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useAppConfigStore } from "../../stores/appConfigStore";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useRepoConfig } from "../../hooks/useRepoConfig";
import { openPathInEditor } from "../../services/openExternal";
import { flagsError } from "../../services/launchCommand";
import { Button } from "../ui/Button";
import { Dialog, DialogContent } from "../ui/Dialog";
import { RepoDropdown } from "../ui/RepoDropdown";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui/DropdownMenu";
import {
  REPO_COLOR_PALETTE,
  resolveColorId,
  repoBadgeLabel,
  repoInitials,
} from "../sidebar/RepoSelector";
import { copyText } from "../../lib/clipboard";

type WorkspaceTab = "general" | "scripts" | "ports";
type ScriptKind = "setup" | "run" | "archive";

// Mirrors the Rust constant in src-tauri/src/repo_config.rs — the URL injected
// as `$schema` in every alfredo.json so editors pick up autocompletion.
const SCHEMA_URL =
  "https://raw.githubusercontent.com/chloehkwong1/alfredo/main/schemas/alfredo.schema.json";

const FLAG_FIELDS: Array<keyof RepoOverrideFlags> = [
  "setupScripts",
  "runScript",
  "archiveScript",
  "portEnvVar",
  "portRangeStart",
  "portRangeEnd",
];

// Collapse all whitespace runs (including newlines) into a single space, then
// trim. Pasted commands often contain word-wrap newlines that the shell would
// treat as statement terminators, breaking `&&` chains.
const normalizeCommand = (s: string) => s.replace(/\s+/g, " ").trim();

const inputClass = [
  "h-8 w-full px-3 text-sm",
  "bg-bg-primary text-text-primary",
  "border border-border-default rounded-[var(--radius-md)]",
  "placeholder:text-text-tertiary",
  "hover:border-border-hover",
  "focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-accent-primary/50",
  "transition-all duration-[var(--transition-fast)]",
].join(" ");

// ── Small inline components ──────────────────────────────────────────

function OverrideTag() {
  return (
    <span
      className="inline-flex items-center gap-[5px] h-5 px-2 rounded-full text-[11px] font-semibold tracking-[0.01em] text-status-busy"
      style={{ background: "rgba(251,191,36,0.14)" }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full bg-status-busy"
        style={{ boxShadow: "0 0 0 3px rgba(251,191,36,0.25)" }}
      />
      Edited locally
    </span>
  );
}

function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Discard local edits and use alfredo.json"
      className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-medium cursor-pointer transition-colors duration-[var(--transition-fast)] bg-transparent border border-status-busy/35 text-status-busy hover:bg-status-busy/10 hover:border-status-busy/60"
    >
      <RotateCcw className="w-[11px] h-[11px]" /> Reset
    </button>
  );
}

function IconBtnSmBare({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex items-center justify-center w-[26px] h-[26px] rounded-md bg-transparent border-0 text-text-tertiary hover:bg-bg-hover hover:text-text-primary cursor-pointer transition-colors duration-[var(--transition-fast)]"
    >
      {children}
    </button>
  );
}

interface SourceChipProps {
  upstreamPresent: boolean;
  upstreamInGit: boolean;
  onOpen: () => void;
  onCreate: () => void;
  loading: boolean;
}

function SourceChip({ upstreamPresent, upstreamInGit, onOpen, onCreate, loading }: SourceChipProps) {
  if (loading) return null;
  if (upstreamPresent) {
    // Untracked alfredo.json is almost always a migration artifact: Alfredo
    // wrote it from the personal layer and the user never committed it. The
    // value won't be shared with teammates, so distinguish it from a real
    // committed alfredo.json. A plain "Tracking" chip in this state is a lie.
    if (!upstreamInGit) {
      return (
        <button
          type="button"
          onClick={onOpen}
          title="alfredo.json exists locally but isn't in git — commit it to share with teammates"
          className="ml-auto inline-flex items-center gap-2 h-7 px-2.5 rounded-full text-xs text-status-busy border border-status-busy/40 bg-status-busy/10 hover:bg-status-busy/15 transition-colors duration-[var(--transition-fast)] cursor-pointer"
        >
          <FileText className="w-3 h-3" />
          <code className="font-mono text-[11px]">alfredo.json</code>
          <span>not in git</span>
          <ExternalLink className="w-3 h-3" />
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={onOpen}
        title="Open alfredo.json in editor"
        className="ml-auto inline-flex items-center gap-2 h-7 px-2.5 rounded-full text-xs text-text-secondary border border-border-default bg-bg-primary hover:border-border-hover hover:text-text-primary transition-colors duration-[var(--transition-fast)] cursor-pointer"
      >
        <FileText className="w-3 h-3 text-text-tertiary" />
        Tracking
        <code className="font-mono text-[11px] text-text-primary">alfredo.json</code>
        <ExternalLink className="w-3 h-3 text-text-tertiary" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onCreate}
      title="Create alfredo.json in this repo"
      className="ml-auto inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs text-text-tertiary border border-dashed border-border-default bg-bg-primary hover:border-border-hover transition-colors duration-[var(--transition-fast)] cursor-pointer"
    >
      Local only
      <span className="text-accent-primary">·</span>
      <span className="text-accent-primary">Create alfredo.json</span>
    </button>
  );
}

interface ScriptCardProps {
  kind: ScriptKind;
  title: string;
  subtitle: string;
  value: string;
  onChange: (value: string) => void;
  overridden: boolean;
  onReset?: () => void;
  isEditing: boolean;
  onStartEditing: () => void;
  upstreamExists: boolean;
  onOpenAlfredoJson: () => void;
}

function ScriptCard({
  kind,
  title,
  subtitle,
  value,
  onChange,
  overridden,
  onReset,
  isEditing,
  onStartEditing,
  upstreamExists,
  onOpenAlfredoJson,
}: ScriptCardProps) {
  const Icon = kind === "setup" ? Play : kind === "run" ? PlayCircle : ArchiveIcon;
  const showEmpty = !value && !isEditing;
  const { copied, copy } = useCopyToClipboard();

  return (
    <div className="bg-bg-primary border border-border-default rounded-[var(--radius-md)] overflow-hidden mb-3.5">
      <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-border-default">
        <span className="w-6 h-6 rounded-md inline-flex items-center justify-center text-text-secondary flex-shrink-0 bg-white/[0.04]">
          <Icon className="w-3.5 h-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-text-primary leading-none flex items-center gap-2">
            {title}
            {overridden && <OverrideTag />}
          </h3>
          <div className="text-[11.5px] text-text-tertiary mt-1">{subtitle}</div>
        </div>
        <div className="ml-auto inline-flex items-center gap-1.5 flex-shrink-0">
          {overridden && onReset && <ResetButton onClick={onReset} />}
          {value && (
            <IconBtnSmBare
              title={copied ? "Copied!" : "Copy"}
              onClick={() => copy(value)}
            >
              {copied ? <Check className="w-3.5 h-3.5 text-diff-added" /> : <Copy className="w-3.5 h-3.5" />}
            </IconBtnSmBare>
          )}
          {upstreamExists && (
            <IconBtnSmBare title="Open alfredo.json" onClick={onOpenAlfredoJson}>
              <Edit2 className="w-3.5 h-3.5" />
            </IconBtnSmBare>
          )}
        </div>
      </div>
      {showEmpty ? (
        <div className="px-3.5 py-3 text-xs text-text-tertiary bg-white/[0.015]">
          Not configured.{" "}
          <button
            type="button"
            onClick={onStartEditing}
            className="text-accent-primary underline cursor-pointer bg-transparent border-0 p-0 text-xs font-[inherit]"
          >
            Add a command
          </button>
        </div>
      ) : (
        <textarea
          className="block w-full bg-transparent border-0 px-3.5 py-3 text-[12px] leading-[1.55] font-mono text-text-primary whitespace-pre overflow-x-auto resize-none min-h-[44px] max-h-[160px] focus:outline-none [scrollbar-width:thin]"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(normalizeCommand(e.target.value))}
          autoFocus={isEditing && !value}
        />
      )}
    </div>
  );
}

// ── Tab list helper ──────────────────────────────────────────────────

interface TabSpec {
  id: WorkspaceTab;
  label: string;
  count?: number;
  tourId?: string;
}

function HorizontalTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabSpec[];
  active: WorkspaceTab;
  onChange: (id: WorkspaceTab) => void;
}) {
  return (
    <div className="flex gap-0.5 px-5 border-b border-border-default">
      {tabs.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            data-tour-id={t.tourId}
            onClick={() => onChange(t.id)}
            className={[
              "relative px-3.5 pt-2.5 pb-3 text-[13px] bg-transparent border-0 cursor-pointer font-[inherit]",
              "transition-colors duration-[var(--transition-fast)]",
              isActive
                ? "text-text-primary font-medium"
                : "text-text-tertiary hover:text-text-secondary",
            ].join(" ")}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1.5 text-[11px] text-text-tertiary tabular-nums">
                {t.count}
              </span>
            )}
            {isActive && (
              <span className="absolute left-2.5 right-2.5 -bottom-px h-0.5 rounded bg-accent-primary" />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Main dialog ──────────────────────────────────────────────────────

interface WorkspaceSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoPath: string;
  repos: RepoEntry[];
  repoColors: Record<string, string>;
  repoDisplayNames: Record<string, string>;
  repoShortLabels?: Record<string, string>;
  onSetRepoDisplayName?: (repoPath: string, name: string | null) => void;
  onSetRepoShortLabel?: (repoPath: string, label: string | null) => void;
  onSetRepoColor?: (repoPath: string, color: string) => void;
  defaultRepoPath?: string;
}

function WorkspaceSettingsDialog({
  open,
  onOpenChange,
  repoPath,
  repos,
  repoColors,
  repoDisplayNames,
  repoShortLabels,
  onSetRepoDisplayName,
  onSetRepoShortLabel,
  onSetRepoColor,
  defaultRepoPath,
}: WorkspaceSettingsDialogProps) {
  const [tab, setTab] = useState<WorkspaceTab>("general");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [appConfig, setAppConfig] = useState<GlobalAppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [currentRepoPath, setCurrentRepoPath] = useState(
    defaultRepoPath ?? repoPath,
  );
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [shortLabelDraft, setShortLabelDraft] = useState("");
  const [switchingMode, setSwitchingMode] = useState(false);
  const [modeSaved, setModeSaved] = useState(false);
  const modeSavedTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const prevOpenRef = useRef(false);
  const [editingScripts, setEditingScripts] = useState<Set<ScriptKind>>(
    new Set(),
  );
  const [schemaCopied, setSchemaCopied] = useState(false);

  const { upstream, upstreamInGit, loading: layersLoading, createAlfredoJson } = useRepoConfig(
    open ? currentRepoPath : null,
  );

  const upstreamPresent = upstream !== null;

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      const initPath = defaultRepoPath ?? repoPath;
      setCurrentRepoPath(initPath);
      setDisplayNameDraft(repoDisplayNames[initPath] ?? "");
      setShortLabelDraft(repoShortLabels?.[initPath] ?? "");
      setSaveError(null);
      setEditingScripts(new Set());
    }
    if (!open && modeSavedTimerRef.current) {
      clearTimeout(modeSavedTimerRef.current);
      setModeSaved(false);
      setEditingScripts(new Set());
    }
    prevOpenRef.current = open;
  }, [open, defaultRepoPath, repoPath, repoDisplayNames, repoShortLabels]);

  // Load config when dialog opens or currentRepoPath changes
  useEffect(() => {
    if (!open) return;
    setEditingScripts(new Set());
    getConfig(currentRepoPath)
      .then((c) => {
        setConfig(c);
        setDirty(false);
      })
      .catch(() => {
        setConfig({
          repoPath: currentRepoPath,
          setupScripts: [],
          githubToken: null,
          linearApiKey: null,
          branchMode: false,
          worktreeBasePath: null,
        });
      });
    getAppConfig().then(setAppConfig).catch((e) => console.error("Failed to load app config:", e));
  }, [open, currentRepoPath]);

  // Re-pull effective config on focus / appConfig-store-publish so out-of-band
  // edits to alfredo.json don't leave our snapshot stale (which would surface as
  // a false "Edited locally" tag, since `useRepoConfig` does refresh upstream
  // on focus). `dirtyRef` keeps the listener stable for the dialog's lifetime —
  // without it, every keystroke would tear down and re-attach the handlers.
  //
  // We previously subscribed to the `config-changed` window event directly,
  // but the App-root listener already triggers `appConfigStore.refetch()` on
  // every dispatch — so subscribing to the store gives us identical coverage
  // (any save anywhere republishes the store) without registering an extra
  // fan-out listener for app-config.
  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  useEffect(() => {
    if (!open) return;
    const refresh = () => {
      if (dirtyRef.current) return;
      getConfig(currentRepoPath)
        .then((c) => setConfig(c))
        .catch(() => {});
    };
    window.addEventListener("focus", refresh);
    const unsubscribe = useAppConfigStore.subscribe((s, prev) => {
      if (s.config !== prev.config) refresh();
    });
    return () => {
      window.removeEventListener("focus", refresh);
      unsubscribe();
    };
  }, [open, currentRepoPath]);

  const updateConfig = useCallback((patch: Partial<AppConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
    setSaveError(null);
  }, []);

  // Derive override state from local config vs upstream so UI updates the
  // moment a Reset click writes the upstream value into local state — without
  // waiting for a Save round-trip.
  const isLocallyOverridden = useCallback(
    (field: keyof RepoOverrideFlags): boolean => {
      if (!upstream || !config) return false;
      const upstreamVal = upstream[field];
      if (upstreamVal === undefined) return false;
      const localVal = (config as unknown as Record<string, unknown>)[field];
      return JSON.stringify(localVal) !== JSON.stringify(upstreamVal);
    },
    [upstream, config],
  );

  const overriddenFieldCount = useMemo(
    () => FLAG_FIELDS.filter((f) => isLocallyOverridden(f)).length,
    [isLocallyOverridden],
  );

  const resetField = useCallback(
    (field: keyof RepoOverrideFlags) => {
      if (!upstream) return;
      const val = upstream[field];
      if (val === undefined) return;
      updateConfig({ [field]: val } as Partial<AppConfig>);
    },
    [upstream, updateConfig],
  );

  const resetAllToUpstream = useCallback(() => {
    if (!upstream) return;
    const patch: Partial<AppConfig> = {};
    if (upstream.setupScripts !== undefined) patch.setupScripts = upstream.setupScripts;
    if (upstream.runScript !== undefined) patch.runScript = upstream.runScript;
    if (upstream.archiveScript !== undefined) patch.archiveScript = upstream.archiveScript;
    if (upstream.portEnvVar !== undefined) patch.portEnvVar = upstream.portEnvVar;
    if (upstream.portRangeStart !== undefined) patch.portRangeStart = upstream.portRangeStart;
    if (upstream.portRangeEnd !== undefined) patch.portRangeEnd = upstream.portRangeEnd;
    updateConfig(patch);
  }, [upstream, updateConfig]);

  const handleRepoChange = useCallback(
    (newPath: string) => {
      if (newPath === currentRepoPath) return;
      if (dirty) {
        const discard = window.confirm(
          "You have unsaved changes. Discard and switch repository?",
        );
        if (!discard) return;
      }
      setCurrentRepoPath(newPath);
      setDisplayNameDraft(repoDisplayNames[newPath] ?? "");
      setShortLabelDraft(repoShortLabels?.[newPath] ?? "");
      setModeSaved(false);
    },
    [currentRepoPath, dirty, repoDisplayNames, repoShortLabels],
  );

  const currentMode: RepoMode = repos.find((r) => r.path === currentRepoPath)?.mode ?? "worktree";

  const handleModeSwitch = useCallback(async (newMode: RepoMode) => {
    if (newMode === currentMode) return;
    const label = newMode === "branch" ? "branch" : "worktree";
    const confirmed = window.confirm(
      `Switch to ${label} mode? The board will reload to reflect the change.`,
    );
    if (!confirmed) return;
    setSwitchingMode(true);
    setSaveError(null);
    try {
      await setRepoMode(currentRepoPath, newMode);
      const [fresh, freshConfig] = await Promise.all([
        getAppConfig(),
        getConfig(currentRepoPath),
      ]);
      setAppConfig(fresh);
      setConfig(freshConfig);
      window.dispatchEvent(new Event("config-changed"));
      setModeSaved(true);
      if (modeSavedTimerRef.current) clearTimeout(modeSavedTimerRef.current);
      modeSavedTimerRef.current = setTimeout(() => setModeSaved(false), 2500);
    } catch (e) {
      console.error("Failed to switch repo mode:", e);
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSwitchingMode(false);
    }
  }, [currentRepoPath, currentMode]);

  const handleSave = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    setSaveError(null);
    try {
      await Promise.all([
        saveConfig(currentRepoPath, config),
        ...(appConfig ? [saveAppConfig(appConfig)] : []),
      ]);
      const newName = displayNameDraft.trim() || null;
      const oldName = repoDisplayNames[currentRepoPath] ?? null;
      if (newName !== oldName) {
        await onSetRepoDisplayName?.(currentRepoPath, newName);
      }
      const cleanedLabel = shortLabelDraft
        .replace(/[^A-Za-z0-9]/g, "")
        .slice(0, 4)
        .toUpperCase();
      const newLabel = cleanedLabel || null;
      const oldLabel = repoShortLabels?.[currentRepoPath] ?? null;
      if (newLabel !== oldLabel) {
        await onSetRepoShortLabel?.(currentRepoPath, newLabel);
      }
      setDirty(false);
      try {
        const fresh = await listWorktrees(currentRepoPath);
        useWorkspaceStore.getState().setWorktreesForRepo(currentRepoPath, fresh);
      } catch (e) {
        console.warn("Failed to refresh worktrees after settings save:", e);
      }
      window.dispatchEvent(new Event("config-changed"));
      onOpenChange(false);
    } catch (e) {
      console.error("Failed to save workspace settings:", e);
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [config, appConfig, currentRepoPath, displayNameDraft, shortLabelDraft, repoDisplayNames, repoShortLabels, onSetRepoDisplayName, onSetRepoShortLabel, onOpenChange]);

  const currentColorId = resolveColorId(repoColors[currentRepoPath]);
  const previewColor = (currentColorId ? REPO_COLOR_PALETTE.find((c) => c.id === currentColorId) : undefined) ?? REPO_COLOR_PALETTE[0];
  const previewLabel = useMemo(() => {
    const draft = shortLabelDraft.replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase();
    if (draft) return draft;
    return repoBadgeLabel(currentRepoPath, {
      ...repoDisplayNames,
      [currentRepoPath]: displayNameDraft.trim() || repoDisplayNames[currentRepoPath] || "",
    });
  }, [shortLabelDraft, displayNameDraft, currentRepoPath, repoDisplayNames]);

  const labelPlaceholder = useMemo(() => {
    return repoInitials(currentRepoPath, {
      ...repoDisplayNames,
      [currentRepoPath]: displayNameDraft.trim() || repoDisplayNames[currentRepoPath] || "",
    });
  }, [displayNameDraft, currentRepoPath, repoDisplayNames]);

  const handlePickColor = useCallback(async (colorId: string) => {
    if (!onSetRepoColor) return;
    try {
      await onSetRepoColor(currentRepoPath, colorId);
    } catch (e) {
      console.error("Failed to set repo colour:", e);
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }, [currentRepoPath, onSetRepoColor]);

  const startEditingScript = useCallback((kind: ScriptKind) => {
    setEditingScripts((prev) => {
      if (prev.has(kind)) return prev;
      const next = new Set(prev);
      next.add(kind);
      return next;
    });
  }, []);

  const openAlfredoJson = useCallback(() => {
    void openPathInEditor(`${currentRepoPath}/alfredo.json`);
  }, [currentRepoPath]);

  const copySchemaUrl = useCallback(() => {
    void copyText(SCHEMA_URL).then(() => {
      setSchemaCopied(true);
      setTimeout(() => setSchemaCopied(false), 1500);
    });
  }, []);

  const createAlfredoJsonHandler = useCallback(() => {
    void createAlfredoJson().then(async () => {
      const fresh = await getConfig(currentRepoPath);
      setConfig(fresh);
      setDirty(false);
    });
  }, [createAlfredoJson, currentRepoPath]);

  if (!config) return null;

  // Configured-script count for the Scripts tab badge. In branch mode only the
  // run script is editable, so the count can be 0 or 1.
  const setupConfigured = (config.setupScripts?.[0]?.command ?? "").length > 0;
  const runConfigured = (config.runScript?.command ?? "").length > 0;
  const archiveConfigured = (config.archiveScript ?? "").length > 0;
  const scriptsCount =
    currentMode === "worktree"
      ? Number(setupConfigured) + Number(runConfigured) + Number(archiveConfigured)
      : Number(runConfigured);

  const repoExtraFlagsError = flagsError(config.claudeDefaults?.extraFlags);

  const tabs: TabSpec[] = [
    { id: "general", label: "General" },
    { id: "scripts", label: "Scripts", count: scriptsCount, tourId: "setup-script-tab" },
  ];
  if (currentMode === "worktree") {
    tabs.push({ id: "ports", label: "Ports" });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[760px] p-0 overflow-hidden">
        <form onSubmit={(e) => { e.preventDefault(); if (dirty && !saving) handleSave(); }}>
          {/* ── Header: title · repo pill · source-of-truth chip ── */}
          <div className="flex items-center gap-4 px-5 pt-[18px] pb-[14px]">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-sm font-semibold tracking-[-0.01em] text-text-primary whitespace-nowrap">
                Repository settings
              </span>
              <span className="text-text-tertiary/70 text-xs">·</span>
              <RepoDropdown
                compact
                repos={repos}
                repoColors={repoColors}
                repoDisplayNames={repoDisplayNames}
                value={currentRepoPath}
                onChange={handleRepoChange}
              />
            </div>
            <SourceChip
              upstreamPresent={upstreamPresent}
              upstreamInGit={upstreamInGit}
              loading={layersLoading}
              onOpen={openAlfredoJson}
              onCreate={createAlfredoJsonHandler}
            />
          </div>

          <HorizontalTabs tabs={tabs} active={tab} onChange={setTab} />

          {/* ── Body ── */}
          <div className="px-5 pt-[18px] pb-5 h-[460px] overflow-y-auto">
            {tab === "general" && (
              <div>
                {/* Mode toggle */}
                <div className="mb-[18px]">
                  <div className="text-[13px] font-medium text-text-primary mb-1.5">Mode</div>
                  <div className="flex bg-bg-primary border border-border-default rounded-lg p-0.5">
                    <button
                      type="button"
                      disabled={switchingMode}
                      className={`flex-1 text-center py-1.5 rounded-md text-[13px] font-medium transition-colors cursor-pointer ${
                        currentMode === "branch"
                          ? "bg-bg-elevated text-text-primary"
                          : "text-text-tertiary hover:text-text-secondary"
                      }`}
                      onClick={() => handleModeSwitch("branch")}
                    >
                      Branches
                    </button>
                    <button
                      type="button"
                      disabled={switchingMode}
                      className={`flex-1 text-center py-1.5 rounded-md text-[13px] font-medium transition-colors cursor-pointer ${
                        currentMode === "worktree"
                          ? "bg-bg-elevated text-text-primary"
                          : "text-text-tertiary hover:text-text-secondary"
                      }`}
                      onClick={() => handleModeSwitch("worktree")}
                    >
                      Worktrees
                    </button>
                  </div>
                  <p className="text-xs text-text-tertiary mt-[5px]">
                    {modeSaved ? (
                      <span className="text-green-500">Mode saved — close this dialog or make further changes.</span>
                    ) : (
                      <>Branch mode shows git branches. Worktree mode uses git worktrees with a kanban board.</>
                    )}
                  </p>
                </div>

                {/* Repo Path (read-only) */}
                <div className="mb-[18px]">
                  <div className="text-[13px] font-medium text-text-primary mb-1.5">Repository Path</div>
                  <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border-default bg-bg-primary px-3 h-8 text-sm text-text-secondary">
                    <FolderOpen className="h-4 w-4 flex-shrink-0 text-text-tertiary" />
                    <span className="truncate">
                      {config.repoPath && config.repoPath !== "." ? config.repoPath : "No repository configured"}
                    </span>
                  </div>
                </div>

                {/* Display Name */}
                <div className="mb-[18px]">
                  <div className="text-[13px] font-medium text-text-primary mb-1.5">Display Name</div>
                  <input
                    type="text"
                    className={inputClass}
                    placeholder={currentRepoPath.split("/").filter(Boolean).pop() ?? ""}
                    value={displayNameDraft}
                    onChange={(e) => {
                      setDisplayNameDraft(e.target.value);
                      setDirty(true);
                      setSaveError(null);
                    }}
                  />
                  <p className="text-xs text-text-tertiary mt-[5px]">
                    Shown in the repo selector. Defaults to the directory name.
                  </p>
                </div>

                {/* Badge Label */}
                <div className="mb-[18px]">
                  <div className="text-[13px] font-medium text-text-primary mb-1.5">Badge Label</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      className={[inputClass, "w-28 uppercase tracking-wide font-semibold"].join(" ")}
                      maxLength={4}
                      placeholder={labelPlaceholder}
                      value={shortLabelDraft}
                      onChange={(e) => {
                        const cleaned = e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 4);
                        setShortLabelDraft(cleaned);
                        setDirty(true);
                        setSaveError(null);
                      }}
                      onBlur={(e) => setShortLabelDraft(e.target.value.toUpperCase())}
                    />
                    <span
                      className="text-[11px] font-semibold px-1.5 py-0.5 rounded-[4px] tracking-wide"
                      style={{ background: previewColor.bg, color: previewColor.text }}
                      aria-label="Badge preview"
                    >
                      {previewLabel}
                    </span>
                  </div>
                  <p className="text-xs text-text-tertiary mt-[5px]">
                    1–4 characters shown on sidebar cards. Defaults to initials.
                  </p>
                </div>

                {/* Badge Colour */}
                <div className="mb-[18px]">
                  <div className="text-[13px] font-medium text-text-primary mb-1.5">Badge Colour</div>
                  <div className="flex items-center gap-2">
                    {REPO_COLOR_PALETTE.map((c) => {
                      const isActive = (currentColorId ?? REPO_COLOR_PALETTE[0].id) === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          title={c.id}
                          aria-label={`Set badge colour to ${c.id}`}
                          aria-pressed={isActive}
                          onClick={() => handlePickColor(c.id)}
                          className={[
                            "h-6 w-6 rounded-full transition-all cursor-pointer",
                            "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/60",
                            isActive ? "ring-2 ring-offset-2 ring-offset-bg-secondary" : "hover:scale-110",
                          ].join(" ")}
                          style={{
                            background: c.bg,
                            ...(isActive ? { ["--tw-ring-color" as string]: c.border } : {}),
                          }}
                        />
                      );
                    })}
                  </div>
                </div>

                {currentMode === "worktree" && (
                  <div className="mb-[18px]">
                    <div className="text-[13px] font-medium text-text-primary mb-1.5">Worktree Directory</div>
                    <input
                      type="text"
                      className={inputClass}
                      placeholder="e.g. /Users/you/worktrees"
                      value={config.worktreeBasePath ?? ""}
                      onChange={(e) => updateConfig({ worktreeBasePath: e.target.value || null })}
                    />
                    <p className="text-xs text-text-tertiary mt-[5px]">
                      Where new worktrees are created. Defaults to the repository parent.
                    </p>
                  </div>
                )}
                <div className="mb-[18px]">
                  <div className="text-[13px] font-medium text-text-primary mb-1.5">Claude launch flags</div>
                  <input
                    type="text"
                    spellCheck={false}
                    className={[
                      repoExtraFlagsError ? "!border-red-500" : "",
                      inputClass,
                      "font-mono",
                    ].join(" ")}
                    placeholder="e.g. --mcp-config ./mcp.json"
                    value={config.claudeDefaults?.extraFlags ?? ""}
                    aria-invalid={repoExtraFlagsError != null}
                    aria-describedby="repo-extra-flags-desc"
                    onChange={(e) =>
                      updateConfig({
                        claudeDefaults: {
                          ...config.claudeDefaults,
                          extraFlags: e.target.value || undefined,
                        },
                      })
                    }
                  />
                  <p id="repo-extra-flags-desc" className={["text-xs mt-[5px]", repoExtraFlagsError ? "text-red-500" : "text-text-tertiary"].join(" ")}>
                    {repoExtraFlagsError ?? "Extra flags for new Claude tabs in this repo. Overrides the global default."}
                  </p>
                </div>

                {/* Linear prompt */}
                <div className="mb-[18px]">
                  <div className="text-[13px] font-medium text-text-primary mb-1.5">Linear prompt</div>
                  <textarea
                    spellCheck={false}
                    className={[inputClass.replace("h-8", ""), "font-mono h-24 py-2 resize-none leading-relaxed"].join(" ")}
                    placeholder={"Work on Linear issue {{identifier}}:\n\nSuggested branch name: {{branch}}\n\n# {{title}}\n\n{{description}}"}
                    value={config.linearPromptTemplate ?? ""}
                    onChange={(e) => updateConfig({ linearPromptTemplate: e.target.value || null })}
                  />
                  <p className="text-xs text-text-tertiary mt-[5px]">
                    Pasted into Claude when opening a Linear issue in this repo. Variables:{" "}
                    {"{{identifier}}, {{title}}, {{description}}, {{branch}}, {{url}}"}. Leave empty for the default format.
                  </p>
                  <label className="flex items-center gap-2 mt-2 text-[13px] text-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.linearAutoSubmit ?? false}
                      onChange={(e) => updateConfig({ linearAutoSubmit: e.target.checked })}
                    />
                    Submit prompt automatically
                  </label>
                </div>
              </div>
            )}

            {tab === "scripts" && (
              <div>
                {currentMode === "worktree" && (
                  <ScriptCard
                    kind="setup"
                    title="Setup"
                    subtitle="Runs once when a worktree is created."
                    value={config.setupScripts?.[0]?.command ?? ""}
                    onChange={(cmd) =>
                      updateConfig({
                        setupScripts: cmd
                          ? [{ name: "Setup", command: cmd, runOn: "create" }]
                          : [],
                      })
                    }
                    overridden={isLocallyOverridden("setupScripts")}
                    onReset={() => resetField("setupScripts")}
                    isEditing={editingScripts.has("setup")}
                    onStartEditing={() => startEditingScript("setup")}
                    upstreamExists={upstreamPresent}
                    onOpenAlfredoJson={openAlfredoJson}
                  />
                )}
                <ScriptCard
                  kind="run"
                  title="Run"
                  subtitle={`Started from any ${currentMode === "worktree" ? "worktree" : "branch"} via the play button in the tab bar.`}
                  value={config.runScript?.command ?? ""}
                  onChange={(cmd) =>
                    updateConfig({
                      runScript: cmd ? { name: "Run", command: cmd } : null,
                    })
                  }
                  overridden={isLocallyOverridden("runScript")}
                  onReset={() => resetField("runScript")}
                  isEditing={editingScripts.has("run")}
                  onStartEditing={() => startEditingScript("run")}
                  upstreamExists={upstreamPresent}
                  onOpenAlfredoJson={openAlfredoJson}
                />
                {currentMode === "worktree" && (
                  <ScriptCard
                    kind="archive"
                    title="Archive"
                    subtitle="Runs when a worktree is archived."
                    value={config.archiveScript ?? ""}
                    onChange={(cmd) => updateConfig({ archiveScript: cmd || null })}
                    overridden={isLocallyOverridden("archiveScript")}
                    onReset={() => resetField("archiveScript")}
                    isEditing={editingScripts.has("archive")}
                    onStartEditing={() => startEditingScript("archive")}
                    upstreamExists={upstreamPresent}
                    onOpenAlfredoJson={openAlfredoJson}
                  />
                )}
              </div>
            )}

            {tab === "ports" && currentMode === "worktree" && (
              <div>
                {/* Auto-assign toggle */}
                <div className="mb-[18px]">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[13px] font-medium text-text-primary">Auto-assign dev server ports</div>
                      <p className="text-xs text-text-tertiary mt-[3px]">
                        Claim a unique port for each worktree when its first dev server starts, so multiple can run at once.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={config.autoAssignPorts ?? false}
                      onClick={() => updateConfig({ autoAssignPorts: !config.autoAssignPorts })}
                      className={[
                        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 cursor-pointer",
                        config.autoAssignPorts ? "bg-accent-primary" : "bg-bg-tertiary",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                          config.autoAssignPorts ? "translate-x-[18px]" : "translate-x-[3px]",
                        ].join(" ")}
                      />
                    </button>
                  </div>
                </div>

                {config.autoAssignPorts && (() => {
                  const rangeStart = config.portRangeStart ?? null;
                  const rangeEnd = config.portRangeEnd ?? null;
                  const rangeUnset = rangeStart == null || rangeEnd == null;
                  const rangeInvalid = !rangeUnset && rangeStart! > rangeEnd!;
                  const slotCount =
                    rangeUnset || rangeInvalid ? 0 : rangeEnd! - rangeStart! + 1;
                  const helperText = rangeUnset
                    ? "Set a start and end port to enable auto-assign"
                    : rangeInvalid
                      ? "Start must be ≤ end"
                      : `${slotCount} port${slotCount === 1 ? "" : "s"}`;
                  const helperTone =
                    rangeUnset || rangeInvalid ? "text-status-error" : "text-text-tertiary";
                  const parseRangeInput = (raw: string): number | null => {
                    if (raw === "") return null;
                    const v = parseInt(raw, 10);
                    if (!Number.isFinite(v)) return null;
                    return v;
                  };
                  const portRangeOverridden =
                    isLocallyOverridden("portRangeStart") || isLocallyOverridden("portRangeEnd");
                  const portEnvOverridden = isLocallyOverridden("portEnvVar");
                  return (
                    <div className="space-y-4">
                      <div>
                        <label className="text-[13px] text-text-secondary mb-1 flex items-center gap-2 flex-wrap">
                          Port range
                          {portRangeOverridden && <OverrideTag />}
                          {portRangeOverridden && (
                            <ResetButton
                              onClick={() => {
                                resetField("portRangeStart");
                                resetField("portRangeEnd");
                              }}
                            />
                          )}
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1024}
                            max={65535}
                            placeholder="3000"
                            className={[
                              inputClass,
                              "!w-24 text-center",
                              rangeInvalid || rangeUnset ? "!border-status-error" : "",
                            ].join(" ")}
                            value={rangeStart ?? ""}
                            onChange={(e) =>
                              updateConfig({ portRangeStart: parseRangeInput(e.target.value) })
                            }
                          />
                          <span className="text-text-tertiary">–</span>
                          <input
                            type="number"
                            min={1024}
                            max={65535}
                            placeholder="3099"
                            className={[
                              inputClass,
                              "!w-24 text-center",
                              rangeInvalid || rangeUnset ? "!border-status-error" : "",
                            ].join(" ")}
                            value={rangeEnd ?? ""}
                            onChange={(e) =>
                              updateConfig({ portRangeEnd: parseRangeInput(e.target.value) })
                            }
                          />
                          <span className={`text-xs ml-2 ${helperTone}`}>{helperText}</span>
                        </div>
                        <p className="text-xs text-text-tertiary mt-[5px]">
                          The first dev server to run in a worktree claims the next free port and keeps it until the worktree is marked Done.
                        </p>
                      </div>
                      <div>
                        <label className="text-[13px] text-text-secondary mb-1 flex items-center gap-2 flex-wrap">
                          Port environment variable
                          {portEnvOverridden && <OverrideTag />}
                          {portEnvOverridden && (
                            <ResetButton onClick={() => resetField("portEnvVar")} />
                          )}
                        </label>
                        <input
                          className={inputClass + " !w-40"}
                          placeholder="PORT"
                          value={config.portEnvVar ?? ""}
                          onChange={(e) =>
                            updateConfig({ portEnvVar: e.target.value || null })
                          }
                        />
                        <p className="text-xs text-text-tertiary mt-[3px]">
                          The env var injected into each session. Defaults to PORT.
                        </p>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* ── Footer: kebab · errors · cancel/save ── */}
          <div className="flex items-center gap-2 px-4 py-3 border-t border-border-default bg-bg-primary">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title="More options"
                  aria-label="More options"
                  className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-transparent border-0 text-text-tertiary hover:bg-bg-hover hover:text-text-primary cursor-pointer transition-colors duration-[var(--transition-fast)] mr-auto"
                >
                  <MoreVertical className="w-3.5 h-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-60">
                <DropdownMenuItem
                  disabled={overriddenFieldCount === 0}
                  onSelect={() => {
                    if (overriddenFieldCount === 0) return;
                    if (!window.confirm("Discard all personal overrides and use alfredo.json values?")) return;
                    resetAllToUpstream();
                  }}
                  className={overriddenFieldCount === 0 ? "opacity-50 pointer-events-none" : ""}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span className="flex-1">Reset all overrides</span>
                  {overriddenFieldCount > 0 && (
                    <span className="text-[11px] text-text-tertiary tabular-nums">
                      {overriddenFieldCount} field{overriddenFieldCount === 1 ? "" : "s"}
                    </span>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!upstreamPresent}
                  onSelect={() => upstreamPresent && openAlfredoJson()}
                  className={!upstreamPresent ? "opacity-50 pointer-events-none" : ""}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>
                    Open <code className="font-mono text-[12px]">alfredo.json</code>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={copySchemaUrl}>
                  {schemaCopied ? (
                    <Check className="w-3.5 h-3.5 text-diff-added" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{schemaCopied ? "Copied!" : "Copy schema URL"}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {saveError && (
              <span
                className="text-xs text-status-error truncate flex-1 min-w-0 text-right"
                title={saveError}
              >
                {saveError}
              </span>
            )}
            <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!dirty || saving || repoExtraFlagsError != null}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { WorkspaceSettingsDialog };

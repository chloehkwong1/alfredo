import { REPO_COLOR_PALETTE, repoBadgeLabel, resolveColorId } from "./RepoSelector";

interface RepoTagProps {
  repoPath: string;
  repoColors: Record<string, string>;
  repoDisplayNames?: Record<string, string>;
  repoShortLabels?: Record<string, string>;
  repoIndex: number;
  visible: boolean;
}

function RepoTag({
  repoPath,
  repoColors,
  repoDisplayNames,
  repoShortLabels,
  repoIndex,
  visible,
}: RepoTagProps) {
  if (!visible) return null;

  const resolved = resolveColorId(repoColors[repoPath]);
  const color = (resolved ? REPO_COLOR_PALETTE.find((c) => c.id === resolved) : undefined)
    ?? REPO_COLOR_PALETTE[repoIndex % REPO_COLOR_PALETTE.length];

  const label = repoBadgeLabel(repoPath, repoDisplayNames, repoShortLabels);

  return (
    <span
      className="text-[11px] font-semibold px-1.5 py-0.5 rounded-[4px] flex-shrink-0 tracking-wide"
      style={{
        background: color.bg,
        color: color.text,
      }}
    >
      {label}
    </span>
  );
}

export { RepoTag };

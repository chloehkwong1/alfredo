import { REPO_COLOR_PALETTE, repoInitials } from "./RepoSelector";

interface RepoTagProps {
  repoPath: string;
  repoColors: Record<string, string>;
  repoDisplayNames?: Record<string, string>;
  repoIndex: number;
  visible: boolean;
}

function RepoTag({ repoPath, repoColors, repoDisplayNames, repoIndex, visible }: RepoTagProps) {
  if (!visible) return null;

  const colorId = repoColors[repoPath];
  const color = REPO_COLOR_PALETTE.find((c) => c.id === colorId)
    ?? REPO_COLOR_PALETTE[repoIndex % REPO_COLOR_PALETTE.length];

  const shortName = repoInitials(repoPath, repoDisplayNames);

  return (
    <span
      className="text-[9px] font-medium px-1.5 py-px rounded-[3px] flex-shrink-0"
      style={{
        background: color.bg,
        color: color.text,
      }}
    >
      {shortName}
    </span>
  );
}

export { RepoTag };

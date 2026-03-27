import { REPO_COLOR_PALETTE, repoAbbrev } from "./RepoSelector";

interface RepoTagProps {
  repoPath: string;
  repoColors: Record<string, string>;
  repoIndex: number;
  visible: boolean;
}

function RepoTag({ repoPath, repoColors, repoIndex, visible }: RepoTagProps) {
  if (!visible) return null;

  const colorId = repoColors[repoPath];
  const color = REPO_COLOR_PALETTE.find((c) => c.id === colorId)
    ?? REPO_COLOR_PALETTE[repoIndex % REPO_COLOR_PALETTE.length];

  const name = repoAbbrev(repoPath);
  const shortName = name.length > 6
    ? name.split(/[_-]/)[0]?.slice(0, 4) ?? name.slice(0, 4)
    : name;

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

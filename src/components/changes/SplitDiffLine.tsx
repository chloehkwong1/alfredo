import { memo, useEffect, useRef, useState } from "react";
import { tokenizeLine, getLangFromPath } from "../../services/syntaxHighlighter";
import type { ThemedToken } from "shiki";

interface SplitSide {
  lineNumber: number | null;
  content: string; // includes prefix (+/-/space)
  lineType: "context" | "addition" | "deletion";
}

interface SplitDiffLineProps {
  left: SplitSide | null;
  right: SplitSide | null;
  filePath: string;
  onClickLine?: (lineNumber: number) => void;
  children?: React.ReactNode;
}

const SIDE_BG: Record<string, string> = {
  addition: "bg-diff-added/15",
  deletion: "bg-diff-removed/15",
  context: "",
  empty: "bg-bg-primary/50",
};

const GUTTER_BG: Record<string, string> = {
  addition: "bg-diff-added/25",
  deletion: "bg-diff-removed/25",
  context: "",
  empty: "",
};

function SplitSideContent({
  side,
  filePath,
  onClickLine,
  align,
}: {
  side: SplitSide | null;
  filePath: string;
  onClickLine?: (lineNumber: number) => void;
  align: "left" | "right";
}) {
  const [tokens, setTokens] = useState<ThemedToken[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !side) return;
    let cancelled = false;
    const lang = getLangFromPath(filePath);
    const code =
      side.content.length > 0 &&
      (side.content[0] === "+" || side.content[0] === "-" || side.content[0] === " ")
        ? side.content.slice(1)
        : side.content;

    tokenizeLine(code, lang).then((result) => {
      if (!cancelled) setTokens(result);
    });
    return () => { cancelled = true; };
  }, [visible, side, filePath]);

  if (!side) {
    return (
      <div ref={ref} className={`flex-1 flex font-mono text-xs leading-5 ${SIDE_BG.empty}`}>
        <span className="w-[36px] flex-shrink-0">&nbsp;</span>
        <span className="flex-1">&nbsp;</span>
      </div>
    );
  }

  const bgClass = SIDE_BG[side.lineType];
  const gutterBgClass = GUTTER_BG[side.lineType];
  const canClick = onClickLine && side.lineNumber !== null && align === "right";

  return (
    <div
      ref={ref}
      className={[
        "flex-1 flex font-mono text-xs leading-5 group/split min-w-0",
        bgClass,
        canClick ? "cursor-pointer hover:bg-bg-hover/50" : "",
      ].join(" ")}
      onClick={canClick ? () => onClickLine!(side.lineNumber!) : undefined}
    >
      <span
        className={[
          "w-[36px] text-right pr-1.5 text-text-tertiary select-none flex-shrink-0 text-[10px]",
          gutterBgClass,
        ].join(" ")}
      >
        {side.lineNumber ?? ""}
      </span>
      <span className="flex-1 px-2 whitespace-pre overflow-x-auto">
        {tokens ? (
          tokens.map((token, i) => (
            <span key={i} style={token.color ? { color: token.color } : undefined}>
              {token.content}
            </span>
          ))
        ) : (
          <span className="text-text-primary">
            {side.content.length > 0 ? side.content.slice(1) : ""}
          </span>
        )}
      </span>
    </div>
  );
}

const SplitDiffLine = memo(function SplitDiffLine({
  left,
  right,
  filePath,
  onClickLine,
  children,
}: SplitDiffLineProps) {
  return (
    <>
      <div className="flex">
        <SplitSideContent side={left} filePath={filePath} onClickLine={onClickLine} align="left" />
        <div className="w-px bg-border-default flex-shrink-0" />
        <SplitSideContent side={right} filePath={filePath} onClickLine={onClickLine} align="right" />
      </div>
      {children}
    </>
  );
});

export { SplitDiffLine };
export type { SplitSide, SplitDiffLineProps };

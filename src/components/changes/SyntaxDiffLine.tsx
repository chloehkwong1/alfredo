import { useEffect, useState } from "react";
import { tokenizeLine, getLangFromPath } from "../../services/syntaxHighlighter";
import type { ThemedToken } from "shiki";

interface SyntaxDiffLineProps {
  content: string;
  lineType: "context" | "addition" | "deletion";
  oldLineNumber: number | null;
  newLineNumber: number | null;
  filePath: string;
  onClickLine?: () => void;
  children?: React.ReactNode;
}

const LINE_BG: Record<string, string> = {
  addition: "bg-diff-added/6",
  deletion: "bg-diff-removed/6",
  context: "",
};

const GUTTER_BG: Record<string, string> = {
  addition: "bg-diff-added/10",
  deletion: "bg-diff-removed/10",
  context: "",
};

function SyntaxDiffLine({
  content,
  lineType,
  oldLineNumber,
  newLineNumber,
  filePath,
  onClickLine,
  children,
}: SyntaxDiffLineProps) {
  const [tokens, setTokens] = useState<ThemedToken[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const lang = getLangFromPath(filePath);
    const code =
      content.length > 0 &&
      (content[0] === "+" || content[0] === "-" || content[0] === " ")
        ? content.slice(1)
        : content;

    tokenizeLine(code, lang).then((result) => {
      if (!cancelled) setTokens(result);
    });

    return () => {
      cancelled = true;
    };
  }, [content, filePath]);

  const prefix =
    lineType === "addition" ? "+" : lineType === "deletion" ? "-" : " ";

  return (
    <>
      <div
        className={["flex font-mono text-[11px] leading-[20px] group", LINE_BG[lineType]].join(" ")}
        onClick={onClickLine}
      >
        <span
          className={[
            "w-[44px] text-right pr-1.5 text-text-tertiary select-none flex-shrink-0 text-[10px]",
            GUTTER_BG[lineType],
          ].join(" ")}
        >
          {oldLineNumber ?? ""}
        </span>
        <span
          className={[
            "w-[44px] text-right pr-3 text-text-tertiary select-none flex-shrink-0 text-[10px]",
            GUTTER_BG[lineType],
          ].join(" ")}
        >
          {newLineNumber ?? ""}
        </span>
        <span className="w-4 text-center text-text-tertiary select-none flex-shrink-0">
          {prefix}
        </span>
        <span className="flex-1 px-2 whitespace-pre overflow-x-auto">
          {tokens ? (
            tokens.map((token, i) => (
              <span key={i} style={token.color ? { color: token.color } : undefined}>
                {token.content}
              </span>
            ))
          ) : (
            <span className="text-text-secondary">{content.slice(1)}</span>
          )}
        </span>
      </div>
      {children}
    </>
  );
}

export { SyntaxDiffLine };

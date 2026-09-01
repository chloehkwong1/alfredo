import { useMemo, useState } from "react";
import { MarkdownBody, stripCommentNoise } from "../shared/MarkdownBody";

/** Count media items in a PR body string. */
function countMedia(body: string): { images: number; videos: number } {
  const imgTags = (body.match(/<img[^>]*\/?>/gi) ?? []).length;
  const videoTags = (body.match(/<video[^>]*>[\s\S]*?<\/video>/gi) ?? []).length +
    (body.match(/<video[^>]*\/>/gi) ?? []).length;
  const mdImages = (body.match(/!\[[^\]]*\]\([^)]+\)/g) ?? []).length;
  return { images: imgTags + mdImages, videos: videoTags };
}

export function PrDescription({
  body,
  prUrl,
}: {
  body: string;
  prUrl: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { images, videos } = countMedia(body);
  const hasMedia = images > 0 || videos > 0;
  const clean = useMemo(() => stripCommentNoise(body), [body]);
  const isLong = clean.split("\n").length > 8;

  return (
    <div className="px-2.5 py-1.5 text-text-secondary overflow-x-auto">
      <div className={expanded || !isLong ? "" : "relative max-h-[160px] overflow-hidden"}>
        <MarkdownBody text={clean} compact />
        {!expanded && isLong && (
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[var(--bg-primary)] to-transparent pointer-events-none" />
        )}
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-accent-primary text-[11px] mt-1 bg-transparent border-none cursor-pointer p-0 font-[inherit] hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
      {hasMedia && (
        <div className="mt-1.5 pt-1.5 border-t border-border-subtle">
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-primary text-[11px] hover:underline"
          >
            Open on GitHub ↗ (media not shown)
          </a>
        </div>
      )}
    </div>
  );
}

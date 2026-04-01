import type React from "react";

/** Count media items in a PR body string. */
function countMedia(body: string): { images: number; videos: number } {
  const imgTags = (body.match(/<img[^>]*\/?>/gi) ?? []).length;
  const videoTags = (body.match(/<video[^>]*>[\s\S]*?<\/video>/gi) ?? []).length +
    (body.match(/<video[^>]*\/>/gi) ?? []).length;
  const mdImages = (body.match(/!\[[^\]]*\]\([^)]+\)/g) ?? []).length;
  return { images: imgTags + mdImages, videos: videoTags };
}

/** Lightly format a PR body for display: strip media, render headers as bold, preserve line breaks. */
function formatPrBody(body: string): React.ReactNode[] {
  // Strip HTML img tags, video tags, and markdown images
  const cleaned = body
    .replace(/<img[^>]*\/?>/gi, "")
    .replace(/<video[^>]*>[\s\S]*?<\/video>/gi, "")
    .replace(/<video[^>]*\/?>/gi, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\|[-|]+\|/g, "");

  return cleaned.split("\n").map((line, i) => {
    // ## Headers → bold
    const headerMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headerMatch) {
      return (
        <span key={i} className="block text-text-primary font-semibold mt-1 first:mt-0">
          {headerMatch[1]}
        </span>
      );
    }
    // Blank lines → small spacer
    if (line.trim() === "") {
      return <span key={i} className="block h-1" />;
    }
    // **bold** → <strong>
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return (
      <span key={i} className="block">
        {parts.map((part, j) => {
          const boldMatch = part.match(/^\*\*(.+)\*\*$/);
          if (boldMatch) {
            return <strong key={j} className="text-text-primary">{boldMatch[1]}</strong>;
          }
          return part;
        })}
      </span>
    );
  });
}

export function PrDescription({
  body,
  prUrl,
  expanded,
  onToggle,
}: {
  body: string;
  prUrl: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { images, videos } = countMedia(body);
  const hasMedia = images + videos > 0;

  const mediaSummary = [
    images > 0 ? `${images} image${images !== 1 ? "s" : ""}` : null,
    videos > 0 ? `${videos} video${videos !== 1 ? "s" : ""}` : null,
  ].filter(Boolean).join(", ");

  return (
    <div className="px-2.5 py-2 border-b border-border-subtle text-xs text-text-secondary leading-[1.5] overflow-hidden">
      <div className={expanded ? "" : "max-h-[4.5em] overflow-hidden"}>
        {formatPrBody(body)}
      </div>
      <button
        onClick={onToggle}
        className="text-accent-primary text-[10px] mt-1 bg-transparent border-none cursor-pointer p-0 font-[inherit]"
      >
        {expanded ? "Show less" : "Show more"}
      </button>
      {hasMedia && (
        <div className="mt-1.5 pt-1.5 border-t border-border-subtle">
          <a
            href={prUrl}
            target="_blank"
            rel="noreferrer"
            className="text-accent-primary text-[10px] hover:underline"
          >
            View full description on GitHub ↗
          </a>
          <div className="text-[10px] text-text-tertiary mt-0.5">
            {mediaSummary} not shown
          </div>
        </div>
      )}
    </div>
  );
}

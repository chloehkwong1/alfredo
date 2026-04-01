import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { useMemo } from "react";

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "details", "summary", "picture", "source", "del", "ins", "sup", "sub", "kbd", "var", "samp", "ruby", "rt", "rp",
  ],
  attributes: {
    ...defaultSchema.attributes,
    source: ["srcSet", "media", "type"],
    img: ["src", "alt", "width", "height"],
    td: ["align", "colSpan", "rowSpan"],
    th: ["align", "colSpan", "rowSpan"],
    details: ["open"],
    code: ["className"],
  },
};

/**
 * Strip HTML comments (<!-- ... -->) and image-link buttons
 * (<a> wrapping <picture> or <img> with external src).
 */
export function stripCommentNoise(text: string): string {
  // Strip HTML comments (including multiline)
  let cleaned = text.replace(/<!--[\s\S]*?-->/g, "");
  // Strip <a> tags that wrap <picture> or <img> with external src
  // Matches: <a ...><picture>...</picture></a> and <a ...><img ...></a>
  cleaned = cleaned.replace(
    /<a\b[^>]*>[\s\n]*<picture[\s\S]*?<\/picture>[\s\n]*<\/a>/gi,
    "",
  );
  cleaned = cleaned.replace(
    /<a\b[^>]*>[\s\n]*<img\b[^>]*>[\s\n]*<\/a>/gi,
    "",
  );
  // Strip standalone <img> with external src (http)
  cleaned = cleaned.replace(
    /<img\b[^>]*src\s*=\s*["']https?:\/\/[^"']*["'][^>]*\/?>/gi,
    "",
  );
  return cleaned.trim();
}

/**
 * Strip comment noise AND all remaining HTML tags to produce plain text.
 * Used for sending comment text to Claude as a quote block.
 */
export function stripToPlainText(text: string): string {
  let cleaned = stripCommentNoise(text);
  // Strip all HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, "");
  // Collapse multiple blank lines into one
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  return cleaned.trim();
}

interface MarkdownBodyProps {
  text: string;
  compact?: boolean;
}

function MarkdownBody({ text, compact = false }: MarkdownBodyProps) {
  const cleaned = useMemo(() => stripCommentNoise(text), [text]);

  const baseClass = compact ? "markdown-body markdown-compact" : "markdown-body";

  return (
    <div className={baseClass}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        children={cleaned}
        components={{
          a: ({ children, href, ...props }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent-primary)] hover:underline"
              {...props}
            >
              {children}
            </a>
          ),
          code: ({ children, className, ...props }) => {
            const isBlock = className?.startsWith("language-");
            if (isBlock) {
              return (
                <code className={`${className} block text-[11px] leading-[1.4]`} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="bg-[var(--bg-hover)] px-1 py-0.5 rounded text-[11px]"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ children, ...props }) => (
            <pre
              className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded p-2 overflow-x-auto max-h-[200px] overflow-y-auto text-[11px]"
              {...props}
            >
              {children}
            </pre>
          ),
          p: ({ children, ...props }) => (
            <p className="my-1 leading-[1.5] text-xs" {...props}>
              {children}
            </p>
          ),
          details: ({ children, ...props }) => (
            <details
              className="my-1 border border-[var(--border-subtle)] rounded"
              {...props}
            >
              {children}
            </details>
          ),
          summary: ({ children, ...props }) => (
            <summary
              className="px-2 py-1 text-xs cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              {...props}
            >
              {children}
            </summary>
          ),
        }}
      />
    </div>
  );
}

export { MarkdownBody };

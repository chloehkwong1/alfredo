import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { visit } from "unist-util-visit";
import type { Root, Element } from "hast";
import { useMemo } from "react";

/**
 * Copy each task-list `<li>`'s source position onto the synthesized
 * `<input type="checkbox">` that `mdast-util-to-hast` inserts. Without this
 * the input has no `position` (it's not in the source) and we can't map a
 * click back to the source line.
 *
 * Gated on the `task-list-item` className (only set on actual task `<li>`s)
 * and only looks at direct children — never recurses into a nested sublist —
 * so a non-task `<li>` containing a nested task doesn't accidentally write
 * the outer list-item's position onto the inner task's checkbox.
 */
function rehypeTaskListItemPosition() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "li" || !node.position) return;
      const classes = node.properties?.className;
      const isTask = Array.isArray(classes) && classes.includes("task-list-item");
      if (!isTask) return;
      const checkbox = findDirectCheckbox(node);
      if (checkbox && !checkbox.position) {
        checkbox.position = node.position;
      }
    });
  };
}

/** Looks at direct children only, plus one level of unwrapping for the
 *  loose-list `<p>` wrapper. Never recurses further. */
function findDirectCheckbox(node: Element): Element | null {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (
      child.tagName === "input" &&
      child.properties?.type === "checkbox"
    ) {
      return child;
    }
    if (child.tagName === "p") {
      for (const grand of child.children) {
        if (
          grand.type === "element" &&
          grand.tagName === "input" &&
          grand.properties?.type === "checkbox"
        ) {
          return grand;
        }
      }
      return null;
    }
    return null;
  }
  return null;
}

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
    input: ["type", "checked", "disabled"],
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
  // Strip <video> elements INCLUDING their content: rehype-sanitize deletes
  // the tag nodes but keeps inner text, so "Your browser does not support
  // video" fallback prose would otherwise leak into the rendered body.
  cleaned = cleaned.replace(/<video\b[^>]*>[\s\S]*?<\/video>/gi, "");
  cleaned = cleaned.replace(/<video\b[^>]*\/>/gi, "");
  return cleaned.trim();
}

/**
 * Strip comment noise AND all remaining HTML tags to produce plain text.
 * Used for sending comment text to Claude as a quote block.
 */
export function stripToPlainText(text: string): string {
  let cleaned = stripCommentNoise(text);
  // Strip HTML tags, but preserve markdown code regions (fenced ``` blocks
  // and inline `code` spans) so JSX-like snippets inside them survive.
  const placeholders: string[] = [];
  const stash = (match: string) => {
    placeholders.push(match);
    return `\u0000CODE${placeholders.length - 1}\u0000`;
  };
  cleaned = cleaned.replace(/```[\s\S]*?```/g, stash);
  cleaned = cleaned.replace(/`[^`\n]*`/g, stash);
  cleaned = cleaned.replace(/<[^>]+>/g, "");
  cleaned = cleaned.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => placeholders[Number(i)]);
  // Collapse multiple blank lines into one
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  return cleaned.trim();
}

interface MarkdownBodyProps {
  text: string;
  compact?: boolean;
  /** When provided, GFM task-list checkboxes become interactive. The callback
   * receives the 1-based source line and the new checked state. The caller is
   * responsible for persisting the change and updating `checkboxOverrides`
   * with the optimistic value. */
  onToggleTaskListItem?: (line: number, newChecked: boolean) => void;
  /** Optimistic checkbox state, keyed by 1-based source line. Overrides the
   * `[ ]`/`[x]` value parsed from the markdown source. */
  checkboxOverrides?: ReadonlyMap<number, boolean>;
}

function MarkdownBody({
  text,
  compact = false,
  onToggleTaskListItem,
  checkboxOverrides,
}: MarkdownBodyProps) {
  const cleaned = useMemo(() => stripCommentNoise(text), [text]);

  // `prose-alfredo` maps Tailwind's prose color tokens onto Alfredo's CSS vars
  // (defined in globals.css) so light/dark theme switches just work.
  // `prose-sm` is used for tight contexts like PR comment cards.
  const baseClass = compact
    ? "prose prose-alfredo prose-sm max-w-none"
    : "prose prose-alfredo max-w-none";

  return (
    <div className={baseClass}>
      <ReactMarkdown
        // remarkFrontmatter parses YAML frontmatter as a `yaml` AST node so its
        // line range is accounted for, keeping `node.position` aligned with
        // the source file (critical for the task-list toggle backend call).
        // ReactMarkdown has no default renderer for `yaml`, so it's skipped
        // visually — no need to strip it from the input string.
        remarkPlugins={[remarkFrontmatter, remarkGfm]}
        rehypePlugins={[
          rehypeTaskListItemPosition,
          [rehypeSanitize, sanitizeSchema],
        ]}
        children={cleaned}
        components={{
          a: ({ children, href, ...props }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            >
              {children}
            </a>
          ),
          input: ({ node, ...props }) => {
            const isCheckbox = props.type === "checkbox";
            const line = node?.position?.start?.line;
            if (!isCheckbox || line == null) {
              return <input {...props} />;
            }
            const override = checkboxOverrides?.get(line);
            const checked = override ?? props.checked ?? false;
            if (!onToggleTaskListItem) {
              return <input {...props} checked={checked} readOnly />;
            }
            return (
              <input
                {...props}
                checked={checked}
                disabled={false}
                onChange={(e) => onToggleTaskListItem(line, e.target.checked)}
                style={{ cursor: "pointer" }}
              />
            );
          },
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

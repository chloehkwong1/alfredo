import type { LinearComment, LinearTicket } from "../types";

/** The six variables a Linear prompt template may reference. */
interface TemplateVars {
  identifier: string;
  title: string;
  description: string;
  branch: string;
  url: string;
  comments: string;
}

/**
 * The built-in prompt format, expressed as a template. Single source of truth:
 * the settings dialog shows it as the textarea placeholder, and the default
 * (no-template) paste path renders it via {@link buildIssuePrompt}.
 */
export const DEFAULT_TEMPLATE =
  "Work on Linear issue {{identifier}}:\n\nSuggested branch name: {{branch}}\n\n# {{title}}\n\n{{description}}\n\n{{comments}}";

/**
 * Total char budget for the rendered comments section. Middle-trimmed, not
 * truncated: early comments carry triage context (auto-triage bots post
 * first), late ones the latest decisions, so both ends survive. Also keeps
 * pathological threads from blowing past the paste-echo settle window that
 * gates auto-submit.
 */
const COMMENT_BUDGET = 10_000;

/**
 * Render ticket comments as a `## Comments` markdown section, oldest-first
 * (the fetch already sorts them). Empty string when there are none, so a
 * `{{comments}}` slot vanishes cleanly. Threads over `budget` chars lose
 * comments from the middle, replaced by an omission marker.
 */
export function formatComments(comments: LinearComment[], budget = COMMENT_BUDGET): string {
  if (!comments.length) return "";
  const render = (c: LinearComment) => {
    const who = c.author ?? "Unknown";
    const when = c.createdAt ? ` (${c.createdAt.slice(0, 10)})` : "";
    return `**${who}${when}:**\n${c.body}`;
  };
  const kept = comments.map(render);
  let omitted = 0;
  while (kept.length > 2 && kept.reduce((n, s) => n + s.length + 2, 0) > budget) {
    kept.splice(Math.floor(kept.length / 2), 1);
    omitted++;
  }
  if (omitted > 0) {
    kept.splice(
      Math.floor(kept.length / 2),
      0,
      `[… ${omitted} comment${omitted === 1 ? "" : "s"} omitted …]`,
    );
  }
  return `## Comments\n\n${kept.join("\n\n")}`;
}

// Dumb {{var}} substitution — known keys only, unknown tokens left untouched.
function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(
    /\{\{(identifier|title|description|branch|url|comments)\}\}/g,
    (_, key: keyof TemplateVars) => vars[key],
  );
}

/**
 * Build the full prompt from a fetched ticket. Linear truncates `{{prompt}}` in
 * the Custom-link URL for long issues (it appends "[Truncated …]"), so we paste
 * the API's complete title + description instead, under the same "Work on … /
 * Suggested branch name: …" header Linear's template uses. Trailing trim keeps
 * the no-comments render byte-identical to the pre-comments format.
 */
function buildIssuePrompt(ticket: LinearTicket, branch: string): string {
  return renderTemplate(DEFAULT_TEMPLATE, {
    identifier: ticket.identifier,
    title: ticket.title,
    description: ticket.description ?? "",
    branch,
    url: ticket.url,
    comments: formatComments(ticket.comments ?? []),
  }).trimEnd();
}

/**
 * Choose what to paste into Claude for an open-issue request: the user's
 * per-repo template (rendered), or the built-in format when no template is
 * set. `fallbackPrompt` is the (possibly Linear-truncated) prompt from the
 * deep-link URL — the best description available when the ticket fetch failed.
 * `fallbackDescription` is that same prompt with its "Work on … / Suggested
 * branch name: …" header stripped, so a template's `{{description}}` gets the
 * issue body rather than the whole preamble.
 */
export function buildPasteMessage(opts: {
  template: string | null | undefined;
  ticket: LinearTicket | null;
  fallbackPrompt: string;
  fallbackDescription: string;
  branch: string;
  issueId: string | null;
}): string {
  const { template, ticket, fallbackPrompt, fallbackDescription, branch, issueId } = opts;
  if (template?.trim()) {
    return renderTemplate(template, {
      identifier: ticket?.identifier ?? issueId ?? "",
      title: ticket?.title ?? "",
      // Truthiness on purpose: a fetched ticket whose description is "" should
      // still fall back, matching the default path's behaviour.
      description: ticket?.description || fallbackDescription,
      branch,
      url: ticket?.url ?? "",
      // No deep-link fallback for comments — only the API carries them.
      comments: formatComments(ticket?.comments ?? []),
    });
  }
  // A fetched ticket wins over the (possibly truncated) URL prompt whenever it
  // adds anything the fallback can't have: a full description or comments.
  if (ticket && (ticket.description || ticket.comments?.length)) {
    return buildIssuePrompt(ticket, branch);
  }
  return fallbackPrompt;
}

import type { LinearTicket } from "../types";

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

// Dumb {{var}} substitution — known keys only, unknown tokens left untouched.
// {{comments}} (and a fetch-failed {{title}}/{{description}}) can render
// empty, so trailing whitespace is trimmed for every template.
function renderTemplate(template: string, vars: TemplateVars): string {
  return template
    .replace(
      /\{\{(identifier|title|description|branch|url|comments)\}\}/g,
      (_, key: keyof TemplateVars) => vars[key],
    )
    .trimEnd();
}

/**
 * Build the full prompt from a fetched ticket. Linear truncates `{{prompt}}` in
 * the Custom-link URL for long issues (it appends "[Truncated …]"), so we paste
 * the API's complete title + description instead, under the same "Work on … /
 * Suggested branch name: …" header Linear's template uses. Blank-run collapse
 * covers a description-less ticket with comments, where the empty
 * `{{description}}` slot would otherwise leave a double blank line.
 */
function buildIssuePrompt(ticket: LinearTicket, branch: string): string {
  return renderTemplate(DEFAULT_TEMPLATE, {
    identifier: ticket.identifier,
    title: ticket.title,
    description: ticket.description ?? "",
    branch,
    url: ticket.url,
    comments: ticket.commentsMd ?? "",
  }).replace(/\n{3,}/g, "\n\n");
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
      comments: ticket?.commentsMd ?? "",
    });
  }
  // A fetched ticket wins over the (possibly truncated) URL prompt whenever it
  // adds anything the fallback can't have: a full description or comments.
  if (ticket && (ticket.description || ticket.commentsMd)) {
    return buildIssuePrompt(ticket, branch);
  }
  return fallbackPrompt;
}

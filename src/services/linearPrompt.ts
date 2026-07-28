import type { LinearTicket } from "../types";

/** The five variables a Linear prompt template may reference. */
interface TemplateVars {
  identifier: string;
  title: string;
  description: string;
  branch: string;
  url: string;
}

// Dumb {{var}} substitution — known keys only, unknown tokens left untouched.
function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(
    /\{\{(identifier|title|description|branch|url)\}\}/g,
    (_, key: keyof TemplateVars) => vars[key],
  );
}

/**
 * Build the full prompt from a fetched ticket. Linear truncates `{{prompt}}` in
 * the Custom-link URL for long issues (it appends "[Truncated …]"), so we paste
 * the API's complete title + description instead, under the same "Work on … /
 * Suggested branch name: …" header Linear's template uses.
 */
export function buildIssuePrompt(ticket: LinearTicket, branch: string): string {
  return [
    `Work on Linear issue ${ticket.identifier}:`,
    "",
    `Suggested branch name: ${branch}`,
    "",
    `# ${ticket.title}`,
    "",
    ticket.description ?? "",
  ].join("\n");
}

/**
 * Choose what to paste into Claude for an open-issue request: the user's
 * per-repo template (rendered), or the built-in format when no template is
 * set. `fallbackPrompt` is the (possibly Linear-truncated) prompt from the
 * deep-link URL — the best description available when the ticket fetch failed.
 */
export function buildPasteMessage(opts: {
  template: string | null | undefined;
  ticket: LinearTicket | null;
  fallbackPrompt: string;
  branch: string;
  issueId: string | null;
}): string {
  const { template, ticket, fallbackPrompt, branch, issueId } = opts;
  if (template?.trim()) {
    return renderTemplate(template, {
      identifier: ticket?.identifier ?? issueId ?? "",
      title: ticket?.title ?? "",
      description: ticket?.description ?? fallbackPrompt,
      branch,
      url: ticket?.url ?? "",
    });
  }
  return ticket?.description ? buildIssuePrompt(ticket, branch) : fallbackPrompt;
}

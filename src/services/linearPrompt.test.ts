import { describe, expect, it } from "vitest";
import { buildPasteMessage, formatComments } from "./linearPrompt";
import type { LinearComment, LinearTicket } from "../types";

const ticket: LinearTicket = {
  id: "abc",
  identifier: "ENG-412",
  title: "Fix the flux capacitor",
  description: "It fluxes when it should capacitate.",
  url: "https://linear.app/florence/issue/ENG-412",
  state: "Todo",
  labels: [],
  assignee: null,
};

describe("buildPasteMessage", () => {
  it("substitutes all five variables from the fetched ticket", () => {
    expect(
      buildPasteMessage({
        template: "/proceed_with_ticket {{identifier}} on {{branch}}\n{{title}}\n{{description}}\n{{url}}",
        ticket,
        fallbackPrompt: "unused",
        fallbackDescription: "unused",
        branch: "chloe/eng-412",
        issueId: "ENG-412",
      }),
    ).toBe(
      "/proceed_with_ticket ENG-412 on chloe/eng-412\nFix the flux capacitor\nIt fluxes when it should capacitate.\nhttps://linear.app/florence/issue/ENG-412",
    );
  });

  it("leaves unknown {{tokens}} untouched", () => {
    expect(
      buildPasteMessage({
        template: "{{identifier}} {{nope}}",
        ticket,
        fallbackPrompt: "",
        fallbackDescription: "",
        branch: "b",
        issueId: null,
      }),
    ).toBe("ENG-412 {{nope}}");
  });

  it("renders offline fallback vars (stripped description) when the ticket fetch failed", () => {
    expect(
      buildPasteMessage({
        template: "{{identifier}}|{{title}}|{{description}}|{{branch}}|{{url}}",
        ticket: null,
        fallbackPrompt: "Work on Linear issue ENG-412:\n\nSuggested branch name: chloe/eng-412\n\nraw url prompt body",
        fallbackDescription: "raw url prompt body",
        branch: "chloe/eng-412",
        issueId: "ENG-412",
      }),
    ).toBe("ENG-412||raw url prompt body|chloe/eng-412|");
  });

  it("falls back to fallbackDescription when the fetched ticket's description is empty", () => {
    expect(
      buildPasteMessage({
        template: "{{description}}",
        ticket: { ...ticket, description: "" },
        fallbackPrompt: "unused",
        fallbackDescription: "body from the deep link",
        branch: "b",
        issueId: "ENG-412",
      }),
    ).toBe("body from the deep link");
  });

  it("renders an empty identifier when neither ticket nor issueId is known", () => {
    expect(
      buildPasteMessage({
        template: "[{{identifier}}]",
        ticket: null,
        fallbackPrompt: "",
        fallbackDescription: "",
        branch: "b",
        issueId: null,
      }),
    ).toBe("[]");
  });

  it("falls back to the built-in format when the template is unset", () => {
    expect(
      buildPasteMessage({
        template: null,
        ticket,
        fallbackPrompt: "unused",
        fallbackDescription: "unused",
        branch: "chloe/eng-412",
        issueId: "ENG-412",
      }),
    ).toBe(
      [
        "Work on Linear issue ENG-412:",
        "",
        "Suggested branch name: chloe/eng-412",
        "",
        "# Fix the flux capacitor",
        "",
        "It fluxes when it should capacitate.",
      ].join("\n"),
    );
  });

  it("treats a whitespace-only template as unset", () => {
    expect(
      buildPasteMessage({
        template: "  \n ",
        ticket: null,
        fallbackPrompt: "the url prompt",
        fallbackDescription: "the url prompt",
        branch: "b",
        issueId: null,
      }),
    ).toBe("the url prompt");
  });

  it("uses the raw fallback prompt when the template is unset and the ticket has no description", () => {
    expect(
      buildPasteMessage({
        template: undefined,
        ticket: { ...ticket, description: null },
        fallbackPrompt: "the url prompt",
        fallbackDescription: "stripped body",
        branch: "b",
        issueId: null,
      }),
    ).toBe("the url prompt");
  });

  it("appends a Comments section to the default format when the ticket has comments", () => {
    expect(
      buildPasteMessage({
        template: null,
        ticket: {
          ...ticket,
          comments: [
            {
              author: "Tom's Triage",
              createdAt: "2026-08-01T10:00:00.000Z",
              body: "Auto-triage: likely a regression.",
            },
          ],
        },
        fallbackPrompt: "unused",
        fallbackDescription: "unused",
        branch: "chloe/eng-412",
        issueId: "ENG-412",
      }),
    ).toBe(
      [
        "Work on Linear issue ENG-412:",
        "",
        "Suggested branch name: chloe/eng-412",
        "",
        "# Fix the flux capacitor",
        "",
        "It fluxes when it should capacitate.",
        "",
        "## Comments",
        "",
        "**Tom's Triage (2026-08-01):**",
        "Auto-triage: likely a regression.",
      ].join("\n"),
    );
  });

  it("builds from the ticket when it has comments but no description", () => {
    const result = buildPasteMessage({
      template: null,
      ticket: {
        ...ticket,
        description: null,
        comments: [{ author: "Tom's Triage", createdAt: null, body: "triage note" }],
      },
      fallbackPrompt: "the url prompt",
      fallbackDescription: "",
      branch: "b",
      issueId: "ENG-412",
    });
    expect(result).toContain("## Comments");
    expect(result).toContain("**Tom's Triage:**\ntriage note");
  });

  it("substitutes {{comments}} in a custom template, empty when there are none", () => {
    const withComments = buildPasteMessage({
      template: "{{identifier}}\n{{comments}}",
      ticket: {
        ...ticket,
        comments: [{ author: "Chloe", createdAt: "2026-08-02T00:00:00.000Z", body: "ship it" }],
      },
      fallbackPrompt: "",
      fallbackDescription: "",
      branch: "b",
      issueId: null,
    });
    expect(withComments).toBe("ENG-412\n## Comments\n\n**Chloe (2026-08-02):**\nship it");

    expect(
      buildPasteMessage({
        template: "{{identifier}}|{{comments}}",
        ticket,
        fallbackPrompt: "",
        fallbackDescription: "",
        branch: "b",
        issueId: null,
      }),
    ).toBe("ENG-412|");
  });
});

describe("formatComments", () => {
  const make = (i: number, body = "x".repeat(100)): LinearComment => ({
    author: `User${i}`,
    createdAt: `2026-08-0${i}T00:00:00.000Z`,
    body,
  });

  it("keeps every comment when under budget", () => {
    const out = formatComments([1, 2, 3, 4, 5].map((i) => make(i)));
    expect(out).not.toContain("omitted");
    expect(out).toContain("**User1 (2026-08-01):**");
    expect(out).toContain("**User5 (2026-08-05):**");
  });

  it("trims the middle over budget, keeping first and last with an omission marker", () => {
    const out = formatComments([1, 2, 3, 4, 5].map((i) => make(i)), 300);
    expect(out).toContain("**User1 (2026-08-01):**");
    expect(out).toContain("**User5 (2026-08-05):**");
    expect(out).toContain("[… 3 comments omitted …]");
    expect(out).not.toContain("User3");
  });

  it("labels authorless comments Unknown and returns empty for no comments", () => {
    expect(formatComments([{ author: null, createdAt: null, body: "hi" }])).toBe(
      "## Comments\n\n**Unknown:**\nhi",
    );
    expect(formatComments([])).toBe("");
  });
});

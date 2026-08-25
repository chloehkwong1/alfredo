import { describe, expect, it } from "vitest";
import { buildPasteMessage } from "./linearPrompt";
import type { LinearTicket } from "../types";

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

  it("appends the pre-rendered Comments section to the default format", () => {
    expect(
      buildPasteMessage({
        template: null,
        ticket: {
          ...ticket,
          commentsMd:
            "## Comments\n\n**Tom's Triage (2026-08-01):**\nAuto-triage: likely a regression.",
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

  it("builds from the ticket when it has comments but no description, without a blank-line gap", () => {
    const result = buildPasteMessage({
      template: null,
      ticket: {
        ...ticket,
        description: null,
        commentsMd: "## Comments\n\n**Tom's Triage:**\ntriage note",
      },
      fallbackPrompt: "the url prompt",
      fallbackDescription: "",
      branch: "b",
      issueId: "ENG-412",
    });
    expect(result).toContain("# Fix the flux capacitor\n\n## Comments");
    expect(result).toContain("**Tom's Triage:**\ntriage note");
  });

  it("substitutes {{comments}} in a custom template, empty when there are none", () => {
    const withComments = buildPasteMessage({
      template: "{{identifier}}\n{{comments}}",
      ticket: { ...ticket, commentsMd: "## Comments\n\n**Chloe (2026-08-02):**\nship it" },
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

  it("trims trailing blank lines a custom template's empty {{comments}} slot leaves behind", () => {
    expect(
      buildPasteMessage({
        template: "{{identifier}}\n\n{{description}}\n\n{{comments}}",
        ticket,
        fallbackPrompt: "",
        fallbackDescription: "",
        branch: "b",
        issueId: null,
      }),
    ).toBe("ENG-412\n\nIt fluxes when it should capacitate.");
  });
});

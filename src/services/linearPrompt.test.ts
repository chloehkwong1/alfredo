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
});

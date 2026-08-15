import { describe, it, expect } from "vitest";
import {
  buildCallGuide,
  coerceQuestions,
  inferAnswerType,
  duplicatesCoreQuestion,
  allQuestions,
  guideProgress,
  type CallGuideInput,
} from "@/lib/domain/call-guide";

function input(overrides: Partial<CallGuideInput> = {}): CallGuideInput {
  return {
    companyName: "Acme HVAC",
    ownerName: "Dana Reyes",
    trade: "HVAC",
    opportunityTitle: "Chiller replacement",
    agency: "GSA",
    source: "outreach",
    ...overrides,
  };
}

describe("inferAnswerType", () => {
  it("reads money, number, and date questions from their wording", () => {
    expect(inferAnswerType("How much would you charge?")).toBe("money");
    expect(inferAnswerType("How many crew members can you field?")).toBe("number");
    expect(inferAnswerType("When could you start?")).toBe("date");
  });

  it("treats a leading auxiliary verb as a yes/no", () => {
    expect(inferAnswerType("Do you carry insurance?")).toBe("yes_no");
    expect(inferAnswerType("Can you meet the schedule?")).toBe("yes_no");
    expect(inferAnswerType("Have you worked on a federal site?")).toBe("yes_no");
  });

  it("falls back to text rather than guessing a structured type", () => {
    // A wrong short_text costs keystrokes; a wrong yes_no loses the answer.
    expect(inferAnswerType("What sequencing works best for the tie-in?")).toBe(
      "short_text"
    );
    expect(inferAnswerType("Describe your approach to the demolition")).toBe("notes");
  });
});

describe("coerceQuestions", () => {
  it("upgrades the legacy plain-string questions already on old cards", () => {
    const qs = coerceQuestions([
      "Do you have a crew available in July?",
      "How much for the ductwork?",
    ]);
    expect(qs).toHaveLength(2);
    expect(qs[0].type).toBe("yes_no");
    expect(qs[1].type).toBe("money");
    expect(qs[0].id).toMatch(/^q_/);
  });

  it("keeps a typed question's own type and options", () => {
    const qs = coerceQuestions([
      {
        id: "shift",
        ask: "Which shift suits your crew?",
        type: "choice",
        options: ["Day", "Night"],
      },
    ]);
    expect(qs[0]).toMatchObject({ id: "shift", type: "choice" });
    expect(qs[0].options).toEqual([
      { value: "Day", label: "Day" },
      { value: "Night", label: "Night" },
    ]);
  });

  it("refuses to render a choice with no options", () => {
    const qs = coerceQuestions([{ ask: "Which shift?", type: "choice" }]);
    expect(qs[0].type).toBe("short_text");
  });

  it("drops empty and malformed entries instead of rendering blanks", () => {
    expect(coerceQuestions(["", "   ", null, 42, {}, { ask: "" }])).toEqual([]);
    expect(coerceQuestions(null)).toEqual([]);
    expect(coerceQuestions("not an array")).toEqual([]);
  });
});

describe("duplicatesCoreQuestion", () => {
  it("recognizes the topics the form already captures with a real input", () => {
    expect(duplicatesCoreQuestion("What is your price for this scope?")).toBe(true);
    expect(duplicatesCoreQuestion("When could you start on site?")).toBe(true);
    expect(duplicatesCoreQuestion("Do you carry insurance?")).toBe(true);
    expect(duplicatesCoreQuestion("Are you interested in this work?")).toBe(true);
  });

  it("leaves genuinely job-specific questions alone", () => {
    expect(
      duplicatesCoreQuestion("Can you work around the chiller staying live?")
    ).toBe(false);
    expect(duplicatesCoreQuestion("Is the roof crane access wide enough?")).toBe(false);
  });
});

describe("buildCallGuide", () => {
  it("asks each thing once, in the order a call takes them", () => {
    const guide = buildCallGuide(
      input({
        generated: [
          "What is your price for the ductwork?", // duplicate of the money field
          "When could you start?", // duplicate of the date field
          "Can you work around the chiller staying live?", // genuinely specific
        ],
      })
    );

    // Insurance is asked unless the solicitation says otherwise, so the
    // paperwork section is present by default.
    expect(guide.sections.map((s) => s.id)).toEqual([
      "fit",
      "job",
      "pricing",
      "schedule",
      "quals",
    ]);
    const qs = allQuestions(guide);
    expect(qs.map((q) => q.ask)).toContain("Can you work around the chiller staying live?");
    // The duplicates collapsed into the one structured field for each topic:
    // one amount to type, one date to pick.
    expect(qs.filter((q) => q.type === "money")).toHaveLength(1);
    expect(qs.filter((q) => q.type === "date")).toHaveLength(1);
    expect(qs.filter((q) => /what is your price/i.test(q.ask))).toHaveLength(0);
  });

  it("drops the job section entirely when nothing survives dedupe", () => {
    const guide = buildCallGuide(
      input({ generated: ["What is your price?", "Do you carry insurance?"] })
    );
    expect(guide.sections.find((s) => s.id === "job")).toBeUndefined();
  });

  it("removes an exact repeat of the same generated question", () => {
    const guide = buildCallGuide(
      input({ generated: ["Is crane access available?", "is crane access available?"] })
    );
    const job = guide.sections.find((s) => s.id === "job");
    expect(job?.questions).toHaveLength(1);
  });

  it("only asks about the paperwork this solicitation requires", () => {
    const none = buildCallGuide(input({ requires: { insurance: false } }));
    expect(none.sections.find((s) => s.id === "quals")).toBeUndefined();

    const bonded = buildCallGuide(input({ requires: { bonding: true, licenses: true } }));
    const ids = bonded.sections.find((s) => s.id === "quals")!.questions.map((q) => q.id);
    expect(ids).toEqual(["insurance_confirmed", "bonding_confirmed", "certs_confirmed"]);
  });

  it("asks for project history only when none is on file", () => {
    const without = buildCallGuide(input({ generated: ["Is crane access available?"] }));
    expect(allQuestions(without).some((q) => q.id === "project_history")).toBe(false);

    const with_ = buildCallGuide(
      input({ generated: ["Is crane access available?"], needsProjectHistory: true })
    );
    expect(allQuestions(with_).some((q) => q.id === "project_history")).toBe(true);
  });

  it("gives every question a structured answer type, never a bare text box by default", () => {
    const guide = buildCallGuide(input({ requires: { bonding: true } }));
    const typed = allQuestions(guide);
    expect(typed.every((q) => q.type)).toBe(true);
    expect(typed.find((q) => q.id === "quote_amount")!.type).toBe("money");
    expect(typed.find((q) => q.id === "start_date")!.type).toBe("date");
    expect(typed.find((q) => q.id === "price_type")!.type).toBe("choice");
    expect(typed.find((q) => q.id === "can_perform")!.type).toBe("yes_no");
  });

  it("carries a price from their email onto the question instead of asking cold", () => {
    const guide = buildCallGuide(input({ emailMentionedPrice: 42500 }));
    const q = allQuestions(guide).find((x) => x.id === "quote_amount")!;
    expect(q.note).toMatch(/42,500/);
  });

  it("opens differently for a reply than for a cold follow-up", () => {
    expect(buildCallGuide(input({ source: "reply" })).opener).toMatch(/Thanks for replying/);
    expect(buildCallGuide(input({ source: "outreach" })).opener).toMatch(/I emailed you/);
  });

  it("keeps the opener and closer to a single line each", () => {
    const guide = buildCallGuide(input());
    // The old card opened with a five-sentence paragraph nobody read aloud.
    expect(guide.opener.split(". ").length).toBeLessThanOrEqual(4);
    expect(guide.closer.length).toBeLessThan(160);
  });
});

describe("guideProgress", () => {
  it("counts only what is needed to price a bid", () => {
    const guide = buildCallGuide(input());
    const empty = guideProgress(guide, {});
    expect(empty.answered).toBe(0);
    expect(empty.total).toBeGreaterThan(0);

    const partial = guideProgress(guide, { can_perform: "yes", quote_amount: 1000 });
    expect(partial.answered).toBe(2);
  });

  it("does not count a blank or negative answer as answered", () => {
    const guide = buildCallGuide(input());
    const p = guideProgress(guide, {
      can_perform: "",
      interested: null,
      insurance_confirmed: false,
    });
    expect(p.answered).toBe(0);
  });
});

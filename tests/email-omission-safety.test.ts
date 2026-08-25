/**
 * End-to-end guarantees for what a subcontractor actually reads.
 *
 * Regression origin: a follow-up email reached a real sub reading
 *   "You can also call me at [CONTACT REDACTED]."
 * because the contact scrubber ran over the fully rendered body, after the
 * operator's own phone number had been substituted in. The scrubber cannot tell
 * the contracting officer's number from Brost Co's own, so it censored ours.
 *
 * These tests pin down all three halves of the fix: the operator's details
 * survive, a missing value removes its sentence instead of leaving a hole, and
 * anything that slips through both is refused before it can be sent.
 */
import { describe, it, expect } from "vitest";
import { renderTemplate } from "../lib/domain/template-render";
import { repairOmissions, OMISSION } from "../lib/domain/text-repair";
import { findEmailSafetyIssues } from "../lib/domain/email-safety";
import { scrubGovtContacts } from "../lib/integrations/scrub-contacts";
import { buildDeclineThankYouEmail } from "../lib/domain/decline-closeout";
import { sendOutreachEmail } from "../lib/integrations/email-transport";
import { DEFAULT_TEMPLATES } from "../db/seedData";

const outreachTemplate = DEFAULT_TEMPLATES.find((t) => t.slug === "template_1_outreach")!;
const followUpTemplate = DEFAULT_TEMPLATES.find((t) => t.slug === "template_2_followup")!;

const FULL_VARS: Record<string, string> = {
  owner_name: "Marcus",
  company_name: "BROSTCO Holdings LLC",
  opportunity_title: "Erosion control/riprap placement",
  location_state: "MI",
  deadline: "Aug 18, 2026, 3:00 PM",
  trade: "Erosion control/riprap placement",
  scope_summary: "Place riprap along 1,200 linear feet of channel bank.",
  questions: "- Do you hold a current MI license?",
  sender_name: "Todd",
  phone: "(586) 555-0142",
  solicitation_number: "W912JC26Q2715",
  agency: "US Army Corps of Engineers",
  location_city_state: "Detroit, Michigan",
  quote_due_date: "August 11, 2026 at 3:00 PM EDT",
  trade_scope_requirements: "- Place riprap along 1,200 linear feet of channel bank",
  subcontractor_requirements: "- License: Michigan contractor license (required)",
  estimated_start_date: "",
  project_duration: "",
};

/** Everything that would read as broken or bureaucratic to a subcontractor. */
function expectReadsNaturally(body: string) {
  expect(body).not.toContain("{{");
  expect(body).not.toMatch(/REDACTED/i);
  expect(body).not.toContain(OMISSION);
  expect(body).not.toMatch(/\s[.,;:!?](\s|$)/); // "call me at ."
  expect(body).not.toMatch(/\(\s*\)/); // "()"
  expect(body).not.toMatch(/\|\s*\|/); // "A |  | B"
  expect(body).not.toMatch(/\n{3,}/); // orphaned blank block
  expect(findEmailSafetyIssues({ text: body })).toEqual([]);
}

// ---------------------------------------------------------------------------
// The reported bug
// ---------------------------------------------------------------------------

describe("the operator's own contact details survive rendering", () => {
  it("keeps Brost Co's phone number in the follow-up email", () => {
    const body = renderTemplate(followUpTemplate.body, FULL_VARS);
    expect(body).toContain("(586) 555-0142");
    expectReadsNaturally(body);
  });

  it("keeps the operator's phone in the initial outreach email", () => {
    const body = renderTemplate(outreachTemplate.body, FULL_VARS);
    expect(body).toContain("BROSTCO Holdings LLC");
    expectReadsNaturally(body);
  });
});

// ---------------------------------------------------------------------------
// Missing values remove their sentence
// ---------------------------------------------------------------------------

describe("a missing value removes its sentence, never leaves a stub", () => {
  it("drops the signature's phone line when no phone is on file", () => {
    const body = renderTemplate(followUpTemplate.body, { ...FULL_VARS, phone: "" });

    expect(body).not.toContain("(586)");
    // The sentence before it is untouched and still carries the ask.
    expect(body).toContain("Can your team provide pricing by");
    expect(body).toContain("Hi Marcus,");
    expect(body).toContain("Todd");
    expectReadsNaturally(body);
  });

  it("drops only the company clause when the company name is missing", () => {
    const body = renderTemplate(outreachTemplate.body, { ...FULL_VARS, company_name: "" });
    // "I'm Todd with ." would be worse than not introducing ourselves at all.
    expect(body).not.toContain("I'm Todd with");
    // The ask survives losing the introduction. The scope, dates and documents
    // live in the sections the Outreach agent appends, not in this body.
    expect(body).toContain("Please review the complete scope");
    expect(body).toContain("Hi Marcus,");
    expectReadsNaturally(body);
  });

  it("keeps the outreach ask intact when there is no phone on file", () => {
    const body = renderTemplate(outreachTemplate.body, { ...FULL_VARS, phone: "" });
    expect(body).not.toContain("(586)");
    // Losing the phone must not take the ask with it. An earlier draft of this
    // body carried {{location_state}} in the same sentence as the ask, so an
    // opportunity with no state on it lost the reason for the email entirely.
    expect(body).toContain("Please review the complete scope");
    expect(body).toContain("would like your pricing for the scope below");
    expectReadsNaturally(body);
  });

  it("does not rely on prose repair to save a missing quote deadline", () => {
    /*
     * Worth stating plainly, because the repair is not enough here.
     *
     * {{quote_due_date}} sits mid-sentence in the initial template, so losing
     * it leaves "If your team can perform the complete trade scope,
     * availability, payment terms, and exclusions." That has no stray
     * punctuation and no visible hole, so every check in
     * expectReadsNaturally passes it, and a subcontractor reads a request
     * with no date in it.
     *
     * The repair is the wrong layer for this. The variable is declared
     * required, so resolveOutreachVars reports it missing and the send is
     * blocked before any of this prose is assembled. This test exists so that
     * nobody later "fixes" the awkward sentence and concludes the case is
     * handled.
     */
    const body = renderTemplate(outreachTemplate.body, { ...FULL_VARS, quote_due_date: "" });
    expect(body).not.toContain("{{");
    expect(body).not.toMatch(/reply by\s*[.,]/i);
  });

  it("handles several missing values at once", () => {
    const body = renderTemplate(followUpTemplate.body, {
      ...FULL_VARS,
      phone: "",
      deadline: "",
      location_state: "",
    });
    expectReadsNaturally(body);
    expect(body).toContain("Hi Marcus,");
  });

  it("treats a whitespace-only value as missing", () => {
    const body = renderTemplate(followUpTemplate.body, { ...FULL_VARS, phone: "   " });
    expect(body).not.toContain("call me at");
    expectReadsNaturally(body);
  });

  it("keeps a pipe-separated signature readable when one field is blank", () => {
    const line = renderTemplate("{{company_name}} | {{phone}} | {{email}}", {
      company_name: "BROSTCO Holdings LLC",
      email: "info@brostco.com",
    });
    expect(line).toBe("BROSTCO Holdings LLC | info@brostco.com");
  });
});

// ---------------------------------------------------------------------------
// repairOmissions — the shared engine
// ---------------------------------------------------------------------------

describe("repairOmissions", () => {
  it("returns text with no omission byte-for-byte unchanged", () => {
    const clean = "Line one.  Odd   spacing , kept as-is.\n\n\n\nEven blank runs.";
    expect(repairOmissions(clean)).toBe(clean);
  });

  it("drops a clause and keeps the rest of the sentence", () => {
    expect(repairOmissions(`Scope is fixed price, contact ${OMISSION} to confirm.`)).toBe(
      "Scope is fixed price."
    );
  });

  it("drops a sentence that was only there to carry the value", () => {
    expect(repairOmissions(`Bid by Friday. Call ${OMISSION}. Thanks for looking.`)).toBe(
      "Bid by Friday. Thanks for looking."
    );
  });

  it("removes a parenthetical built around the value", () => {
    expect(
      repairOmissions(`We need a partner (reach us at ${OMISSION}) before Friday.`)
    ).toBe("We need a partner before Friday.");
  });

  it("drops a line that reduces to punctuation only", () => {
    expect(repairOmissions(`Intro line.\n${OMISSION},\nClosing line.`)).toBe(
      "Intro line.\nClosing line."
    );
  });

  it("collapses the blank lines around a removed line", () => {
    expect(repairOmissions(`Above.\n\n${OMISSION}\n\nBelow.`)).toBe("Above.\n\nBelow.");
  });

  it("never lets the sentinel escape", () => {
    for (const input of [
      `${OMISSION}`,
      `a ${OMISSION} b`,
      `${OMISSION}${OMISSION}`,
      `Call ${OMISSION} or ${OMISSION} now.`,
    ]) {
      expect(repairOmissions(input)).not.toContain(OMISSION);
    }
  });
});

// ---------------------------------------------------------------------------
// Pre-send guard
// ---------------------------------------------------------------------------

describe("findEmailSafetyIssues", () => {
  it("passes a correctly rendered email", () => {
    expect(
      findEmailSafetyIssues({
        subject: "Re: Erosion control Quote Request, MI",
        text: renderTemplate(followUpTemplate.body, FULL_VARS),
      })
    ).toEqual([]);
  });

  it("passes an email rendered with a missing phone", () => {
    expect(
      findEmailSafetyIssues({
        text: renderTemplate(followUpTemplate.body, { ...FULL_VARS, phone: "" }),
      })
    ).toEqual([]);
  });

  it("catches an unresolved token", () => {
    const issues = findEmailSafetyIssues({ text: "Call me at {{phone}}." });
    expect(issues.map((i) => i.kind)).toContain("unresolved_token");
  });

  it("catches a redaction marker — the exact copy that reached a real sub", () => {
    const issues = findEmailSafetyIssues({
      text: "You can also call me at [CONTACT REDACTED].",
    });
    expect(issues.map((i) => i.kind)).toContain("placeholder_marker");
  });

  it("catches a sentence with a gap in it", () => {
    const issues = findEmailSafetyIssues({ text: "You can also call me at ." });
    expect(issues.map((i) => i.kind)).toContain("dangling_punctuation");
  });

  it("catches empty parentheses and blank list fields", () => {
    expect(
      findEmailSafetyIssues({ text: "Job in MI () and ready." }).map((i) => i.kind)
    ).toContain("empty_parens");
    expect(
      findEmailSafetyIssues({ text: "BROSTCO |  | info@brostco.com" }).map((i) => i.kind)
    ).toContain("empty_list_field");
  });

  it("inspects HTML bodies as prose, not markup", () => {
    const issues = findEmailSafetyIssues({
      html: "<p>Hi Marcus,</p><p>Call me at {{phone}}.</p>",
    });
    expect(issues.map((i) => i.kind)).toContain("unresolved_token");
  });

  it("does not flag well-formed HTML", () => {
    expect(
      findEmailSafetyIssues({
        html: '<p style="margin:0">Hi Marcus,</p><br><p>Call me at (586) 555-0142.</p>',
      })
    ).toEqual([]);
  });

  it("does not flag the editor's deliberate [TEST] subject prefix", () => {
    expect(
      findEmailSafetyIssues({
        subject: "[TEST] Erosion control Quote Request, MI",
        text: renderTemplate(followUpTemplate.body, FULL_VARS),
      })
    ).toEqual([]);
  });

  it("does not flag a sentence that legitimately ends in the word 'call'", () => {
    // A naive /call\s*\./ rule would block the real outreach template.
    expect(
      findEmailSafetyIssues({
        text: "If it looks like a fit, I would also like to set up a short call.",
      })
    ).toEqual([]);
  });

  it("does not flag an ellipsis", () => {
    expect(findEmailSafetyIssues({ text: "Still reviewing the scope ... more soon." })).toEqual(
      []
    );
  });

  it("reports the surface where the problem was found", () => {
    const issues = findEmailSafetyIssues({ subject: "Quote for {{trade}}", text: "All good." });
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toContain("subject");
  });

  // The boundary case of silent removal: everything got removed.
  it("catches a body that collapsed to nothing", () => {
    const body = renderTemplate("{{unknown_token}}", {});
    expect(body).toBe("");
    expect(findEmailSafetyIssues({ subject: "Quote request", text: body }).map((i) => i.kind))
      .toContain("empty_body");
  });

  it("catches a body of nothing but whitespace or punctuation", () => {
    for (const text of ["", "   ", "\n\n", " . "]) {
      expect(
        findEmailSafetyIssues({ subject: "Quote request", text }).map((i) => i.kind)
      ).toContain("empty_body");
    }
  });

  it("catches an empty or whitespace-only subject", () => {
    for (const subject of ["", "   "]) {
      expect(
        findEmailSafetyIssues({ subject, text: "Real body copy here." }).map((i) => i.kind)
      ).toContain("empty_subject");
    }
  });

  it("accepts a body carried only by HTML, with text empty", () => {
    expect(
      findEmailSafetyIssues({
        subject: "Quote request",
        text: "",
        html: "<p>Hi Marcus, we would like a price.</p>",
      })
    ).toEqual([]);
  });

  it("catches an HTML body that is markup with no readable content", () => {
    expect(
      findEmailSafetyIssues({
        subject: "Quote request",
        text: "",
        html: '<p style="margin:0"></p><br/>',
      }).map((i) => i.kind)
    ).toContain("empty_body");
  });

  it("only judges surfaces the caller actually supplied", () => {
    // Checking a body alone must not report a missing subject, and vice versa.
    expect(findEmailSafetyIssues({ text: "Real body copy here." })).toEqual([]);
    expect(findEmailSafetyIssues({ subject: "Quote request" })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The transport choke point actually refuses
// ---------------------------------------------------------------------------

describe("sendOutreachEmail refuses to send a broken email", () => {
  // These all assert on BLOCKED sends only. A valid email is deliberately never
  // exercised here — it would proceed to a real provider.

  it("blocks a body that collapsed to nothing, before touching any transport", async () => {
    const res = await sendOutreachEmail({
      to: "sub@example.com",
      subject: "Quote request",
      text: renderTemplate("{{unknown_token}}", {}),
      html: "",
    });
    expect(res.blocked).toBe(true);
    expect(res.provider).toBeNull();
    expect(res.error).toMatch(/nothing for the recipient to read/i);
  });

  it("blocks a subject that collapsed to nothing", async () => {
    const res = await sendOutreachEmail({
      to: "sub@example.com",
      subject: renderTemplate("{{trade}} Quote Request", {}),
      text: "Hi Marcus, we would like a price on the channel bank work.",
    });
    expect(res.blocked).toBe(true);
    expect(res.error).toMatch(/subject line is empty/i);
  });

  it("blocks an unresolved token", async () => {
    const res = await sendOutreachEmail({
      to: "sub@example.com",
      subject: "Quote request",
      text: "Hi Marcus, you can call me at {{phone}}.",
    });
    expect(res.blocked).toBe(true);
    expect(res.error).toMatch(/unfilled template field/i);
  });

  it("blocks the exact copy that reached a real subcontractor", async () => {
    const res = await sendOutreachEmail({
      to: "sub@example.com",
      subject: "Re: Quote Request",
      text: "If you can price it, reply with your quote. You can also call me at [CONTACT REDACTED].",
    });
    expect(res.blocked).toBe(true);
    expect(res.error).toMatch(/placeholder/i);
  });

  it("marks a refusal as blocked, not as a delivery failure", async () => {
    const res = await sendOutreachEmail({ to: "sub@example.com", subject: "", text: "" });
    expect(res.blocked).toBe(true);
    // `disabled` means "no transport configured" — a different operator problem.
    expect(res.disabled).toBeUndefined();
    expect(res.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Templates are operator-editable, so every solicitation-derived value must be
// clean BEFORE it enters the vars object
// ---------------------------------------------------------------------------

describe("custom templates cannot leak government contacts", () => {
  /**
   * Mirrors how lib/agents/outreach.ts builds `vars`. The rendered email is
   * deliberately never scrubbed (that is what censored Brost Co's own phone),
   * so every solicitation-derived value has to be clean on the way in.
   */
  function buildOutreachVars(opp: {
    title: string;
    agency: string;
    trade: string;
    scope: string;
  }): Record<string, string> {
    return {
      ...FULL_VARS,
      opportunity_title: scrubGovtContacts(opp.title).sanitised || "an upcoming opportunity",
      agency: scrubGovtContacts(opp.agency).sanitised,
      trade: scrubGovtContacts(opp.trade).sanitised,
      scope_summary: scrubGovtContacts(opp.scope).sanitised,
    };
  }

  const poisoned = {
    title: "HVAC Services — POC Jane Doe jane.doe@usace.army.mil",
    agency: "US Army Corps of Engineers, (910) 451-7000",
    trade: "HVAC (questions: co@army.mil)",
    scope: "Replace 4 rooftop units. Contracting Officer: Alice Example, (703) 555-0194.",
  };

  /** A template an operator could plausibly write using the documented tokens. */
  const customTemplate = [
    "Hi {{owner_name}},",
    "",
    "{{company_name}} is bidding {{opportunity_title}} for {{agency}}.",
    "",
    "Trade: {{trade}}",
    "Scope: {{scope_summary}}",
    "",
    "Call me at {{phone}}.",
    "{{sender_name}}",
  ].join("\n");

  it("keeps CO email, phone and name out of a custom template body", () => {
    const body = renderTemplate(customTemplate, buildOutreachVars(poisoned));

    expect(body).not.toContain("jane.doe@usace.army.mil");
    expect(body).not.toContain("co@army.mil");
    expect(body).not.toContain("Jane Doe");
    expect(body).not.toContain("Alice Example");
    expect(body).not.toContain("(910) 451-7000");
    expect(body).not.toContain("(703) 555-0194");
    expect(body).not.toMatch(/@\w+\.(?:mil|gov)/);
    expectReadsNaturally(body);
  });

  it("still delivers the operator's own phone number in that same email", () => {
    const body = renderTemplate(customTemplate, buildOutreachVars(poisoned));
    // The whole point: our contact survives while the government's does not.
    expect(body).toContain("Call me at (586) 555-0142.");
    expect(body).toContain("BROSTCO Holdings LLC");
  });

  it("keeps a custom subject line clean", () => {
    const subject = renderTemplate(
      "{{trade}} Quote Request — {{agency}}",
      buildOutreachVars(poisoned)
    );
    expect(subject).not.toMatch(/@|\(\d{3}\)/);
    expect(findEmailSafetyIssues({ subject })).toEqual([]);
  });

  it("leaves clean solicitation values completely untouched", () => {
    const vars = buildOutreachVars({
      title: "Erosion control/riprap placement",
      agency: "US Army Corps of Engineers",
      trade: "Erosion control/riprap placement",
      scope: "Place riprap along 1,200 linear feet of channel bank.",
    });
    expect(vars.opportunity_title).toBe("Erosion control/riprap placement");
    expect(vars.agency).toBe("US Army Corps of Engineers");
    expect(vars.trade).toBe("Erosion control/riprap placement");
    expect(vars.scope_summary).toBe("Place riprap along 1,200 linear feet of channel bank.");
  });

  it("keeps government contacts out of the decline thank-you email", () => {
    const mail = buildDeclineThankYouEmail({
      firstName: "Marcus",
      opportunityTitle: "HVAC Services — POC Jane Doe jane.doe@usace.army.mil",
      trade: "HVAC (questions: co@army.mil)",
    });
    for (const surface of [mail.subject, mail.text, mail.html]) {
      expect(surface).not.toContain("jane.doe@usace.army.mil");
      expect(surface).not.toContain("co@army.mil");
      expect(surface).not.toContain("Jane Doe");
      expect(surface).not.toMatch(/@\w+\.(?:mil|gov)/);
    }
    expect(mail.text).toContain("Hi Marcus,");
    expect(findEmailSafetyIssues(mail)).toEqual([]);
  });

  it("leaves a clean decline thank-you email untouched", () => {
    const mail = buildDeclineThankYouEmail({
      firstName: "Marcus",
      opportunityTitle: "Erosion control/riprap placement",
      trade: "Erosion control",
    });
    expect(mail.subject).toBe("Thank you, Erosion control/riprap placement");
    expect(mail.text).toContain(
      "Thank you for getting back to us about Erosion control/riprap placement (Erosion control)."
    );
    expect(findEmailSafetyIssues(mail)).toEqual([]);
  });

  it("falls back gracefully when the title is nothing but a contact", () => {
    const mail = buildDeclineThankYouEmail({
      firstName: "Marcus",
      opportunityTitle: "jane.doe@usace.army.mil",
      trade: "",
    });
    expect(mail.subject).toBe("Thank you, the opportunity");
    expect(findEmailSafetyIssues(mail)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Every seed template, under every missing-value combination
// ---------------------------------------------------------------------------

describe("sub-facing templates never produce broken copy", () => {
  const optionalTokens = [
    "phone",
    "company_name",
    "deadline",
    "questions",
    "scope_summary",
    "location_state",
    "trade",
    "solicitation_number",
    "agency",
    "opportunity_title",
  ];

  for (const tmpl of [outreachTemplate, followUpTemplate]) {
    it(`${tmpl.slug} reads naturally with every token present`, () => {
      expectReadsNaturally(renderTemplate(tmpl.body, FULL_VARS));
    });

    for (const token of optionalTokens) {
      it(`${tmpl.slug} reads naturally with ${token} missing`, () => {
        expectReadsNaturally(renderTemplate(tmpl.body, { ...FULL_VARS, [token]: "" }));
      });
    }

    it(`${tmpl.slug} reads naturally with every optional token missing at once`, () => {
      const stripped = { ...FULL_VARS };
      for (const token of optionalTokens) stripped[token] = "";
      expectReadsNaturally(renderTemplate(tmpl.body, stripped));
    });
  }
});

/**
 * Government-contact scrubbing.
 *
 * The contract these tests enforce: a contact is removed SILENTLY. The sub must
 * never see a redaction marker, an empty stub, or any other sign that something
 * was withheld — the copy simply reads as if the contact was never mentioned.
 */
import { describe, it, expect } from "vitest";
import { scrubGovtContacts, rewriteSamUrls } from "../lib/integrations/scrub-contacts";

/** Anything that would tell a reader "something was taken out here". */
function expectNoTraceOfRemoval(text: string) {
  expect(text).not.toMatch(/REDACTED/i);
  expect(text).not.toMatch(/\[[^\]\n]*\b(?:REMOVED|WITHHELD|HIDDEN|N\/A)\b[^\]\n]*\]/i);
  expect(text).not.toContain("\u0000");
  // "call me at ." — a space stranded before punctuation.
  expect(text).not.toMatch(/\s[.,;:!?](\s|$)/);
  expect(text).not.toMatch(/\(\s*\)/);
}

describe("scrubGovtContacts", () => {
  // ── Email addresses ──────────────────────────────────────────────────────
  it("removes a sentence whose only purpose was to give out a CO email", () => {
    const { sanitised, count } = scrubGovtContacts(
      "Contact the CO at jane.doe@army.mil for questions."
    );
    // Repairing this to "Contact the CO for questions." would actively tell the
    // sub to go around Brost Co, so the whole directive goes.
    expect(sanitised).toBe("");
    expect(count).toBe(1);
  });

  it("removes multiple email addresses without leaving a stub", () => {
    const { sanitised, count } = scrubGovtContacts(
      "Primary: john@navy.mil, alternate: contracting@dla.mil"
    );
    expect(sanitised).not.toContain("@");
    expect(sanitised).toBe("");
    expect(count).toBe(2);
    expectNoTraceOfRemoval(sanitised);
  });

  it("removes .gov and .mil addresses joined by 'or'", () => {
    const { sanitised } = scrubGovtContacts("Email: co@usace.army.mil or info@sam.gov");
    expect(sanitised).toBe("");
    expectNoTraceOfRemoval(sanitised);
  });

  // ── US phone numbers ─────────────────────────────────────────────────────
  it("removes a standard (NXX) format phone number", () => {
    const { sanitised, count } = scrubGovtContacts(
      "Call the contracting office at (703) 555-0194."
    );
    expect(sanitised).toBe("");
    expect(count).toBe(1);
  });

  it("removes dashed format: 555-867-5309", () => {
    const { sanitised } = scrubGovtContacts("Phone: 555-867-5309");
    expect(sanitised).toBe("");
  });

  it("removes dot-separated format with an extension", () => {
    const { sanitised } = scrubGovtContacts("Office: 703.555.0100 ext. 42");
    expect(sanitised).not.toMatch(/\d{3}[.\-]\d{3}/);
    expectNoTraceOfRemoval(sanitised);
  });

  it("removes a phone with +1 country code", () => {
    const { sanitised } = scrubGovtContacts("Call +1 703 555 0100");
    expect(sanitised).not.toMatch(/\d{3}/);
    expectNoTraceOfRemoval(sanitised);
  });

  it("removes multiple phone numbers", () => {
    const { sanitised, count } = scrubGovtContacts(
      "Main: (703) 555-0100, Fax: (703) 555-0199"
    );
    expect(count).toBe(2);
    expect(sanitised).not.toMatch(/\(\d{3}\)/);
    expectNoTraceOfRemoval(sanitised);
  });

  // ── Mixed content ────────────────────────────────────────────────────────
  it("strips phone, email, and contracting officer name patterns", () => {
    const input =
      "For technical questions, contact John Smith at john.smith@usace.army.mil " +
      "or call (910) 451-7000. Contracting Officer: Jane Doe, (910) 451-7001.";
    const { sanitised, count } = scrubGovtContacts(input);
    expect(sanitised).not.toContain("@");
    expect(sanitised).not.toMatch(/\(\d{3}\)/);
    expect(sanitised).not.toContain("Jane Doe");
    expect(sanitised).not.toContain("John Smith");
    expect(count).toBeGreaterThanOrEqual(3);
    expectNoTraceOfRemoval(sanitised);
  });

  it("removes Contracting Officer name introductions", () => {
    const { sanitised, count } = scrubGovtContacts(
      "Contracting Officer: Alice Example will answer questions."
    );
    expect(sanitised).not.toContain("Alice Example");
    expect(count).toBeGreaterThanOrEqual(1);
    expectNoTraceOfRemoval(sanitised);
  });

  // ── Surrounding scope is preserved ───────────────────────────────────────
  it("keeps the scope sentence and drops only the contact sentence", () => {
    const { sanitised } = scrubGovtContacts(
      "HVAC maintenance at Fort Bragg. Contact POC: jane.doe@usace.army.mil for specs."
    );
    expect(sanitised).toBe("HVAC maintenance at Fort Bragg.");
  });

  it("drops only the trailing clause when a contact is appended to real scope", () => {
    const { sanitised } = scrubGovtContacts(
      "The contractor shall provide quarterly HVAC inspections at Fort Bragg NC, " +
        "with questions directed to jane@army.mil."
    );
    expect(sanitised).toBe(
      "The contractor shall provide quarterly HVAC inspections at Fort Bragg NC."
    );
  });

  it("preserves priceable scope while removing a follow-on contact directive", () => {
    const { sanitised } = scrubGovtContacts(
      "Replace 4 rooftop units, roughly 120,000 sq ft. " +
        "Direct questions to co@army.mil or (910) 451-7000 before Aug 12."
    );
    expect(sanitised).toBe("Replace 4 rooftop units, roughly 120,000 sq ft.");
    expectNoTraceOfRemoval(sanitised);
  });

  // ── Clean text passthrough ───────────────────────────────────────────────
  it("leaves clean scope text byte-for-byte untouched", () => {
    const clean =
      "The contractor shall provide HVAC maintenance services at Fort Bragg, NC. " +
      "Work includes quarterly inspections and emergency repair response within 4 hours.";
    const { sanitised, count } = scrubGovtContacts(clean);
    expect(sanitised).toBe(clean);
    expect(count).toBe(0);
  });

  it("returns count 0 for empty string", () => {
    const { sanitised, count } = scrubGovtContacts("");
    expect(sanitised).toBe("");
    expect(count).toBe(0);
  });

  // ── Does not over-redact ─────────────────────────────────────────────────
  it("does not touch an alphanumeric solicitation number", () => {
    const { sanitised } = scrubGovtContacts("Solicitation W912JC26Q2715 is due Aug 17.");
    expect(sanitised).toBe("Solicitation W912JC26Q2715 is due Aug 17.");
  });

  it("never emits a redaction marker for any input", () => {
    const inputs = [
      "Contact the CO at jane.doe@army.mil for questions.",
      "Main: (703) 555-0100, Fax: (703) 555-0199",
      "Contracting Officer: Alice Example will answer questions.",
      "Questions to co@army.mil.",
      "Scope of work follows. POC (910) 451-7000.",
    ];
    for (const input of inputs) {
      expectNoTraceOfRemoval(scrubGovtContacts(input).sanitised);
    }
  });
});

describe("rewriteSamUrls", () => {
  it("rewrites a prod api.sam.gov noticedesc URL to the public sam.gov URL", () => {
    const input =
      "Scope: https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=57cdf3ebdd6d4ceb8c69dc9ffd2e8cec";
    const out = rewriteSamUrls(input);
    expect(out).toBe(
      "Scope: https://sam.gov/opp/57cdf3ebdd6d4ceb8c69dc9ffd2e8cec/view"
    );
    expect(out).not.toContain("api.sam.gov");
  });

  it("handles a URL with additional query params", () => {
    const out = rewriteSamUrls(
      "https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=abc123def456&index=1"
    );
    expect(out).toContain("sam.gov/opp/abc123def456/view");
  });

  it("leaves non-SAM URLs untouched", () => {
    const clean = "See https://www.usace.army.mil for more details.";
    expect(rewriteSamUrls(clean)).toBe(clean);
  });

  it("leaves clean text without URLs untouched", () => {
    const clean = "HVAC maintenance at Fort Bragg, NC.";
    expect(rewriteSamUrls(clean)).toBe(clean);
  });
});

/**
 * Outreach rendering safety — simulate the full variable-construction path to
 * assert that neither scope_summary nor questions_for_subs items leak contact
 * info into the rendered email body. This mirrors what lib/agents/outreach.ts
 * does before handing vars to the template renderer.
 */
describe("outreach variable sanitisation (end-to-end boundary)", () => {
  function buildOutreachVars(
    scopePlainLanguage: string,
    questionsForSubs: string[],
  ): { scope_summary: string; questions: string; contactsRedacted: number } {
    const rawScope = scopePlainLanguage.slice(0, 400);
    const { sanitised: scope_summary, count: scopeRedacted } = scrubGovtContacts(rawScope);
    let questionsRedacted = 0;
    const questions = questionsForSubs
      .map((q) => {
        const { sanitised, count } = scrubGovtContacts(String(q));
        questionsRedacted += count;
        return `- ${sanitised}`;
      })
      .join("\n");
    return { scope_summary, questions, contactsRedacted: scopeRedacted + questionsRedacted };
  }

  it("removes CO email from scope_summary before it enters template vars", () => {
    const { scope_summary } = buildOutreachVars(
      "HVAC maintenance at Fort Bragg. Contact POC: jane.doe@usace.army.mil for specs.",
      [],
    );
    expect(scope_summary).not.toContain("@");
    expect(scope_summary).toBe("HVAC maintenance at Fort Bragg.");
    expectNoTraceOfRemoval(scope_summary);
  });

  it("removes CO phone from questions_for_subs, keeping the useful question", () => {
    const { questions } = buildOutreachVars("Maintenance services required.", [
      "Can you meet the 4-hour response time? Call (910) 451-7000 to confirm schedule.",
      "Do you hold a current HVAC license in NC?",
    ]);
    expect(questions).not.toMatch(/\(\d{3}\)/);
    // The question survives; only the "call this number" sentence is dropped.
    expect(questions).toContain("Can you meet the 4-hour response time?");
    expect(questions).toContain("Do you hold a current HVAC license in NC?");
    expectNoTraceOfRemoval(questions);
  });

  it("accumulates redaction count across scope and questions", () => {
    const { contactsRedacted } = buildOutreachVars(
      "Contact CO at co@army.mil or (703) 555-0100.",
      ["Email specs to co@army.mil if interested."],
    );
    // 2 in scope (email + phone) + 1 in questions = 3
    expect(contactsRedacted).toBe(3);
  });

  it("produces a clean vars block when there is nothing to redact", () => {
    const { scope_summary, questions, contactsRedacted } = buildOutreachVars(
      "Provide quarterly HVAC inspections at Camp Lejeune, NC.",
      ["Do you have current HVAC certification?", "Can you start within 30 days of award?"],
    );
    expect(contactsRedacted).toBe(0);
    expect(scope_summary).toBe("Provide quarterly HVAC inspections at Camp Lejeune, NC.");
    expect(questions).toBe(
      "- Do you have current HVAC certification?\n- Can you start within 30 days of award?"
    );
  });
});

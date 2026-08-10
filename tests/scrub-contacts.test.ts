import { describe, it, expect } from "vitest";
import { scrubGovtContacts, rewriteSamUrls } from "../lib/integrations/scrub-contacts";

describe("scrubGovtContacts", () => {
  // ── Email addresses ──────────────────────────────────────────────────────
  it("redacts a plain government email address", () => {
    const { sanitised, count } = scrubGovtContacts(
      "Contact the CO at jane.doe@army.mil for questions."
    );
    expect(sanitised).toBe("Contact the CO at [CONTACT REDACTED] for questions.");
    expect(count).toBe(1);
  });

  it("redacts multiple email addresses", () => {
    const { sanitised, count } = scrubGovtContacts(
      "Primary: john@navy.mil, alternate: contracting@dla.mil"
    );
    expect(sanitised).not.toContain("@");
    expect(count).toBe(2);
  });

  it("redacts .gov and .mil addresses", () => {
    const { sanitised } = scrubGovtContacts("Email: co@usace.army.mil or info@sam.gov");
    expect(sanitised).toBe("Email: [CONTACT REDACTED] or [CONTACT REDACTED]");
  });

  // ── US phone numbers ─────────────────────────────────────────────────────
  it("redacts a standard (NXX) format phone number", () => {
    const { sanitised, count } = scrubGovtContacts(
      "Call the contracting office at (703) 555-0194."
    );
    expect(sanitised).toBe("Call the contracting office at [CONTACT REDACTED].");
    expect(count).toBe(1);
  });

  it("redacts dashed format: 555-867-5309", () => {
    const { sanitised } = scrubGovtContacts("Phone: 555-867-5309");
    expect(sanitised).toBe("Phone: [CONTACT REDACTED]");
  });

  it("redacts dot-separated format: 555.867.5309", () => {
    const { sanitised } = scrubGovtContacts("Office: 703.555.0100 ext. 42");
    expect(sanitised).toContain("[CONTACT REDACTED]");
    expect(sanitised).not.toMatch(/\d{3}[.\-]\d{3}/);
  });

  it("redacts a phone with +1 country code", () => {
    const { sanitised } = scrubGovtContacts("Call +1 703 555 0100");
    expect(sanitised).toContain("[CONTACT REDACTED]");
  });

  it("redacts multiple phone numbers", () => {
    const { sanitised, count } = scrubGovtContacts(
      "Main: (703) 555-0100, Fax: (703) 555-0199"
    );
    expect(count).toBe(2);
    expect(sanitised).not.toMatch(/\(\d{3}\)/);
  });

  // ── Mixed content ────────────────────────────────────────────────────────
  it("strips both phone and email from a realistic SOW snippet", () => {
    const input =
      "For technical questions, contact John Smith at john.smith@usace.army.mil " +
      "or call (910) 451-7000. Contracting Officer: Jane Doe, (910) 451-7001.";
    const { sanitised, count } = scrubGovtContacts(input);
    expect(sanitised).not.toContain("@");
    expect(sanitised).not.toMatch(/\(\d{3}\)/);
    expect(count).toBe(3); // 1 email + 2 phones
  });

  // ── Clean text passthrough ───────────────────────────────────────────────
  it("leaves clean scope text untouched", () => {
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
  it("does not redact a plain 10-digit number that is part of a contract number", () => {
    // Contract numbers like W912JC26Q2715 are alphanumeric and won't match
    const { sanitised } = scrubGovtContacts("Solicitation W912JC26Q2715 is due Aug 17.");
    expect(sanitised).toBe("Solicitation W912JC26Q2715 is due Aug 17.");
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
    expect(scope_summary).toContain("[CONTACT REDACTED]");
  });

  it("removes CO phone from questions_for_subs before it enters template vars", () => {
    const { questions } = buildOutreachVars("Maintenance services required.", [
      "Can you meet the 4-hour response time? Call (910) 451-7000 to confirm schedule.",
      "Do you hold a current HVAC license in NC?",
    ]);
    expect(questions).not.toMatch(/\(\d{3}\)/);
    expect(questions).toContain("[CONTACT REDACTED]");
    // Clean question passes through unchanged
    expect(questions).toContain("Do you hold a current HVAC license in NC?");
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
    expect(scope_summary).not.toContain("[CONTACT REDACTED]");
    expect(questions).not.toContain("[CONTACT REDACTED]");
  });
});

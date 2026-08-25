/**
 * The gate between a rendered email and a real inbox.
 *
 * Everything pinned here shares one property: the email reads perfectly. A
 * missing quote deadline does not leave a hole, it removes the sentence that
 * asked for a date. A sample solicitation number looks exactly like a real
 * one. That is why these checks are mechanical and run on the final text.
 */
import { describe, it, expect } from "vitest";
import {
  validateTemplate,
  validateOutboundEmail,
  describeProblems,
} from "@/lib/domain/outreach-validation";

describe("validateTemplate", () => {
  it("passes a template using only real variables", () => {
    expect(
      validateTemplate({
        subject: "Pricing request: {{trade}} | {{location_city_state}}",
        body: "Hi {{owner_name}}, please reply by {{quote_due_date}}.",
      })
    ).toEqual([]);
  });

  it("blocks a variable the system cannot fill", () => {
    const p = validateTemplate({ body: "Hi {{first_name}}," });
    expect(p[0].kind).toBe("unknown_variable");
    expect(p[0].message).toMatch(/raw text/);
  });

  it("names the replacement for a retired variable", () => {
    const p = validateTemplate({ body: "Hi {{contact_first_name_or_there}}," });
    expect(p[0].useInstead).toBe("owner_name");
  });

  it("checks the subject as well as the body", () => {
    // A broken subject line is the first thing the recipient sees.
    const p = validateTemplate({ subject: "Re: {{job_name}}", body: "Hi {{owner_name}}," });
    expect(p.some((x) => x.message.includes("job_name"))).toBe(true);
  });

  it("reports each unknown variable once however often it is used", () => {
    const p = validateTemplate({ body: "{{nope}} and {{nope}} again" });
    expect(p.length).toBe(1);
  });

  it("catches asking a sub to reply by our bid deadline", () => {
    /*
     * The mistake this product actually shipped. It reads like a deadline, so
     * it survived every review; the quote then arrives on the day the bid is
     * already gone.
     */
    const p = validateTemplate({
      body: "Please reply with your price by {{deadline}}.",
    });
    expect(p[0].kind).toBe("deadline_confusion");
    expect(p[0].message).toContain("{{quote_due_date}}");
  });

  it("allows the bid deadline when it is presented as ours", () => {
    // Stating our own deadline is useful context, and is not the bug.
    expect(
      validateTemplate({
        body: "Our bid to the agency is due {{deadline}}. Please send pricing by {{quote_due_date}}.",
      })
    ).toEqual([]);
  });

  it("rejects an empty body", () => {
    expect(validateTemplate({ body: "   " })[0].kind).toBe("empty_body");
  });
});

const OK = {
  subject: "Pricing request: HVAC | Richmond, Virginia",
  body: "Hi Marcus, please reply by August 22, 2026 at 3:00 PM MDT.",
  vars: { owner_name: "Marcus", trade: "HVAC" },
  missingRequired: [],
  attachedNames: ["Statement of Work.pdf"],
  documentsExpected: true,
  quoteDueAt: "2026-08-22T21:00:00Z",
  deadlineAt: "2026-08-29T18:00:00Z",
};

describe("validateOutboundEmail", () => {
  it("passes a complete email", () => {
    expect(validateOutboundEmail(OK)).toEqual([]);
  });

  it("refuses an email with a token still in it", () => {
    const p = validateOutboundEmail({ ...OK, body: "Hi {{owner_name}}," });
    expect(p[0].kind).toBe("unresolved_token");
    expect(p[0].message).toContain("{{owner_name}}");
  });

  it("refuses when a required value never resolved", () => {
    const p = validateOutboundEmail({ ...OK, missingRequired: ["quote_due_date", "phone"] });
    expect(p[0].kind).toBe("missing_required");
    // Named in the operator's words, not as variable keys.
    expect(p[0].message).toContain("Subcontractor quote due");
    expect(p[0].message).toContain("Your phone");
  });

  it("catches a leaked null or undefined", () => {
    for (const bad of [
      "Hi null, here is the scope.",
      "Reply by undefined.",
      "Total: NaN",
      "Contact [object Object] for details",
    ]) {
      expect(validateOutboundEmail({ ...OK, body: bad })[0]?.kind).toBe("placeholder_text");
    }
  });

  it("does not trip on ordinary words containing null", () => {
    // "annulled" and "Nullarbor" are not leaked values.
    expect(
      validateOutboundEmail({ ...OK, body: "The prior award was annulled in June." })
    ).toEqual([]);
  });

  it("refuses to post the editor's example data to a real inbox", () => {
    /*
     * The sample values are realistic on purpose, so nobody notices the
     * solicitation number is fictional until a subcontractor asks about a
     * procurement that does not exist.
     */
    const p = validateOutboundEmail({
      ...OK,
      body: "Solicitation: W912DR-26-R-0042",
      vars: { ...OK.vars, solicitation_number: "N6247026R1234" },
      sampleValues: { solicitation_number: "W912DR-26-R-0042" },
    });
    expect(p[0].kind).toBe("sample_data");
  });

  it("allows a real value that happens to equal the example", () => {
    const p = validateOutboundEmail({
      ...OK,
      body: "Solicitation: W912DR-26-R-0042",
      vars: { ...OK.vars, solicitation_number: "W912DR-26-R-0042" },
      sampleValues: { solicitation_number: "W912DR-26-R-0042" },
    });
    expect(p).toEqual([]);
  });

  it("refuses when the quote deadline is not before the bid deadline", () => {
    for (const quoteDueAt of ["2026-08-29T18:00:00Z", "2026-08-30T18:00:00Z"]) {
      const p = validateOutboundEmail({ ...OK, quoteDueAt });
      expect(p[0].kind).toBe("deadline_order");
    }
  });

  it("refuses to send a document-bearing solicitation with nothing attached", () => {
    const p = validateOutboundEmail({ ...OK, attachedNames: [] });
    expect(p[0].kind).toBe("no_attachments");
    expect(p[0].message).toMatch(/pricing blind/);
  });

  it("accepts a link when the package was too large to attach", () => {
    expect(
      validateOutboundEmail({
        ...OK,
        attachedNames: [],
        linkNames: ["Full bid document package"],
      })
    ).toEqual([]);
  });

  it("does not demand attachments for a solicitation that has none", () => {
    expect(
      validateOutboundEmail({ ...OK, attachedNames: [], documentsExpected: false })
    ).toEqual([]);
  });

  it("reports every problem, not just the first", () => {
    const p = validateOutboundEmail({
      ...OK,
      body: "Hi {{owner_name}}, undefined",
      missingRequired: ["phone"],
      attachedNames: [],
    });
    expect(p.map((x) => x.kind).sort()).toEqual(
      ["missing_required", "no_attachments", "placeholder_text", "unresolved_token"].sort()
    );
  });
});

describe("describeProblems", () => {
  it("joins the messages for a log line", () => {
    expect(describeProblems([{ message: "One." }, { message: "Two." }])).toBe("One. Two.");
  });
});

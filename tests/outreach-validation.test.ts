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
import { DEFAULT_TEMPLATES } from "@/db/seedData";

describe("an example pasted into a template", () => {
  /*
   * The one way the editor's sample data actually reaches a subcontractor.
   *
   * It cannot arrive through the variables: a real send builds those from the
   * opportunity's own records, and the only code that renders with the samples
   * is the preview, which draws to a screen, and the test send, which is
   * addressed to the operator. What happens is somebody copying
   * "W912DR-26-R-0042" out of the palette into the body instead of
   * {{solicitation_number}}.
   *
   * Caught while editing, where it can be fixed, rather than only inside the
   * outreach agent at 3am where the same email is refused again every night
   * and nobody is told which template to edit.
   */
  const flags = (body: string, subject?: string) =>
    validateTemplate({ body, subject }).filter((p) => p.kind === "sample_data");

  it("refuses a solicitation number copied out of the variable list", () => {
    const p = flags("Hi {{owner_name}}, quoting W912DR-26-R-0042.");
    expect(p).toHaveLength(1);
    expect(p[0].useInstead).toBe("{{solicitation_number}}");
  });

  it("names the variable in the message, because that is all the editor shows", () => {
    // The editor renders p.message live as you type and reads nothing else,
    // so a suggestion only in useInstead would never be seen.
    expect(flags("Quoting W912DR-26-R-0042.")[0].message).toContain("{{solicitation_number}}");
  });

  it("catches a fixed date, which no reusable template can carry", () => {
    expect(flags("Please reply by August 22, 2099 at 3:00 PM MDT.")).toHaveLength(1);
  });

  it("catches one bullet out of a multi-line example, not just the whole block", () => {
    // The palette shows those as a block, and one line is as copyable as all
    // of it.
    expect(flags("Scope:\n- Test and balance before closeout")).toHaveLength(1);
  });

  it("catches it in the subject as well as the body", () => {
    expect(flags("Hi {{owner_name}}.", "Pricing: HVAC Maintenance Services, Building 36C")).toHaveLength(1);
  });

  it("leaves the sender's own constants alone", () => {
    /*
     * The exempt category, and the reason this check is keyed to the variable
     * rather than to a guess about the author. A company name and a phone
     * number are the operator's own, unchanging across every solicitation, and
     * writing them out instead of using the variable is a legitimate way to
     * author a template. The example for company_name is a real company's real
     * name.
     */
    expect(flags("This is BROSTCO Holdings LLC. Call (800) 555-0199.")).toEqual([]);
  });

  it("does not fire on a sentence somebody wrote themselves", () => {
    // The match is the exact example string. Prose about the same subject is
    // not evidence of anything, which is the mistake the send-side version of
    // this check made before it was fixed.
    expect(flags("We work across the Richmond area and bid federal jobs.")).toEqual([]);
    expect(flags("- Test and balance before handover")).toEqual([]);
  });

  it("leaves every template this product ships with saveable", () => {
    /*
     * A check that refuses a shipped template would be met by every new
     * account on its first edit. Asserted over the real seed data rather than
     * a copy of it, and the count is asserted too: an import that resolved to
     * undefined would make an empty loop pass while testing nothing.
     */
    expect(DEFAULT_TEMPLATES.length).toBeGreaterThan(0);
    for (const t of DEFAULT_TEMPLATES) {
      expect(flags(t.body, t.subject), `${t.slug} would be refused`).toEqual([]);
    }
  });
});

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

  it("allows sample text that arrived through a different variable", () => {
    /*
     * The defect this replaces. The check asked, per key, "is this sample in
     * the email and is THIS key's value not it", which is the wrong question
     * whenever the text arrived legitimately through another variable -- and
     * every one of these samples is a phrase that can.
     *
     * Live example: the sample for `estimated_start_date` was
     * "October 1, 2026". A solicitation whose site visit fell on that date put
     * the string into `special_conditions`, and the send was refused for
     * carrying example data in a variable that was empty. The refusal happens
     * overnight inside the outreach agent, where nobody sees it.
     */
    const p = validateOutboundEmail({
      ...OK,
      body: "Special conditions:\n- Site visit: October 1, 2026 (required)",
      vars: {
        ...OK.vars,
        estimated_start_date: "",
        special_conditions: "- Site visit: October 1, 2026 (required)",
      },
      sampleValues: { estimated_start_date: "October 1, 2026" },
    });
    expect(p).toEqual([]);
  });

  it("still refuses when no real value on the email accounts for the sample", () => {
    // The rule is "unexplained", not "absent". Nothing here carries the text,
    // so it was typed into the template and is about to be sent as fact.
    const p = validateOutboundEmail({
      ...OK,
      body: "Site visit: October 1, 2026 (required)",
      vars: { ...OK.vars, estimated_start_date: "March 3, 2027" },
      sampleValues: { estimated_start_date: "October 1, 2026" },
    });
    expect(p[0].kind).toBe("sample_data");
    expect(p[0].message).toContain("estimated_start_date");
  });

  it("ignores a sample too short to be evidence", () => {
    // An eight-character floor, because a shorter phrase collides with
    // ordinary prose often enough that firing on it is noise.
    const p = validateOutboundEmail({
      ...OK,
      body: "The site is in Denver.",
      vars: { ...OK.vars },
      sampleValues: { city: "Denver" },
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

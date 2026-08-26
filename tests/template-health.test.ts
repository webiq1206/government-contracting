import { describe, it, expect } from "vitest";
import {
  deliverabilityFindings,
  templateMetrics,
  formatMetric,
  openRateLabel,
  metricsSummary,
  MIN_SENDS_FOR_RATE,
  OPEN_RATE_CAVEAT,
  type TemplateCounts,
} from "@/lib/domain/template-health";

const GOOD_BODY =
  "Hello {{sub_owner_name}}, we are pricing {{opportunity_title}} in {{location}} and would like a number " +
  "for the {{trade}} scope. The drawings and the scope sheet are attached. We need your price by " +
  "{{quote_due_date}} so there is time to review it before the bid goes in. Ring me if anything is unclear " +
  "and I will walk you through it. Thanks very much for taking a look at this one for us today.";

describe("deliverabilityFindings", () => {
  it("passes a plain, well-formed request", () => {
    expect(
      deliverabilityFindings({
        subject: "Electrical quote needed, Meridian ID school",
        body: GOOD_BODY,
      })
    ).toEqual([]);
  });

  it("flags a subject that gets cut off on a phone", () => {
    const f = deliverabilityFindings({
      subject:
        "Request for a subcontractor quotation covering the complete electrical scope at the Meridian facility",
      body: GOOD_BODY,
    });
    expect(f.some((x) => x.message.includes("cut off"))).toBe(true);
  });

  it("flags a subject too short to say anything", () => {
    const f = deliverabilityFindings({ subject: "Quote", body: GOOD_BODY });
    expect(f.some((x) => x.message.includes("mass mailing"))).toBe(true);
  });

  it("measures a placeholder as its value, not as its literal length", () => {
    // Six placeholders of about twenty characters each would blow the limit if
    // counted literally, and the operator would be told to shorten a subject
    // that renders to nothing of the sort.
    const f = deliverabilityFindings({
      subject: "{{trade}} quote for {{location}}",
      body: GOOD_BODY,
    });
    expect(f.some((x) => x.message.includes("cut off"))).toBe(false);
  });

  it("flags a shouting subject", () => {
    const f = deliverabilityFindings({ subject: "URGENT QUOTE NEEDED NOW", body: GOOD_BODY });
    expect(f.some((x) => x.message.includes("capital letters"))).toBe(true);
  });

  it("does not read a solicitation number as shouting", () => {
    const f = deliverabilityFindings({
      subject: "Quote for RFQ 47-2291 in Meridian",
      body: GOOD_BODY,
    });
    expect(f.some((x) => x.message.includes("capital letters"))).toBe(false);
  });

  it("flags stacked exclamation marks", () => {
    const f = deliverabilityFindings({ subject: "Quote needed today!!", body: GOOD_BODY });
    expect(f.some((x) => x.message.includes("exclamation"))).toBe(true);
  });

  it("allows one", () => {
    const f = deliverabilityFindings({ subject: "Quote needed today, please!", body: GOOD_BODY });
    expect(f.some((x) => x.message.includes("exclamation"))).toBe(false);
  });

  it("flags a body too short to answer", () => {
    const f = deliverabilityFindings({ subject: "Electrical quote, Meridian ID", body: "Send price." });
    expect(f.some((x) => x.message.includes("short enough"))).toBe(true);
  });

  it("flags a body nobody finishes", () => {
    const f = deliverabilityFindings({
      subject: "Electrical quote, Meridian ID",
      body: Array(420).fill("word").join(" "),
    });
    expect(f.some((x) => x.message.includes("on a phone between jobs"))).toBe(true);
  });

  it("flags bulk-mail wording and names it", () => {
    const f = deliverabilityFindings({
      subject: "Electrical quote, Meridian ID",
      body: `${GOOD_BODY} Act now, this is a limited time offer.`,
    });
    const hit = f.find((x) => x.message.includes("bulk-mail wording"));
    expect(hit?.message).toContain("act now");
    expect(hit?.message).toContain("limited time");
  });

  it("does not flag ordinary construction language", () => {
    const f = deliverabilityFindings({
      subject: "Electrical quote, Meridian ID",
      body: `${GOOD_BODY} Free issue material will be supplied by the government.`,
    });
    expect(f.some((x) => x.message.includes("bulk-mail"))).toBe(false);
  });

  it("flags a link-heavy first contact", () => {
    const f = deliverabilityFindings({
      subject: "Electrical quote, Meridian ID",
      body: `${GOOD_BODY} https://a.test https://b.test https://c.test https://d.test`,
    });
    expect(f.some((x) => x.message.includes("links in the body"))).toBe(true);
  });

  it("says nothing about a subject that was never supplied", () => {
    // The in-thread follow-up has no subject of its own; it inherits one.
    const f = deliverabilityFindings({ subject: null, body: GOOD_BODY });
    expect(f).toEqual([]);
  });

  it("does not flag an empty body as too short, since the editor already refuses it", () => {
    expect(deliverabilityFindings({ subject: null, body: "" })).toEqual([]);
  });
});

describe("templateMetrics", () => {
  function counts(over: Partial<TemplateCounts> = {}): TemplateCounts {
    return { sent: 0, delivered: 0, opened: 0, replied: 0, bounced: 0, lastSentAt: null, ...over };
  }

  it("has no rates at all for a template nobody has sent", () => {
    const m = templateMetrics(counts());
    expect(m.openRate).toBeNull();
    expect(m.replyRate).toBeNull();
    expect(m.bounceRate).toBeNull();
    expect(formatMetric(m.replyRate, m.sent)).toBe("Never sent");
    expect(metricsSummary(m)).toContain("nothing to judge it by");
  });

  it("counts opens against what was delivered, not against what was sent", () => {
    // Counting a bounce as an unopened message blames the wording for an
    // address that never existed.
    const m = templateMetrics(counts({ sent: 100, delivered: 80, opened: 40, bounced: 20 }));
    expect(m.openRate).toBe(50);
    expect(m.bounceRate).toBe(20);
  });

  it("counts replies against everything sent", () => {
    const m = templateMetrics(counts({ sent: 50, delivered: 50, replied: 9 }));
    expect(m.replyRate).toBe(18);
  });

  it("marks a thin history as thin rather than reporting it as a rate", () => {
    const m = templateMetrics(counts({ sent: 3, delivered: 3, opened: 3, replied: 1 }));
    expect(m.thin).toBe(true);
    expect(metricsSummary(m)).toContain("arithmetic rather than evidence");
    expect(m.sent).toBeLessThan(MIN_SENDS_FOR_RATE);
  });

  it("stops calling it thin once there is enough of it", () => {
    expect(templateMetrics(counts({ sent: MIN_SENDS_FOR_RATE, delivered: 10 })).thin).toBe(false);
  });

  it("has no open rate when nothing was delivered, even though something was sent", () => {
    const m = templateMetrics(counts({ sent: 12, delivered: 0, bounced: 12 }));
    expect(m.openRate).toBeNull();
    expect(formatMetric(m.openRate, m.sent)).toBe("Not measurable");
    expect(m.bounceRate).toBe(100);
  });

  it("says nothing bounced rather than leaving the reader to infer it", () => {
    const m = templateMetrics(counts({ sent: 40, delivered: 40, replied: 8, bounced: 0 }));
    expect(metricsSummary(m)).toContain("nothing bounced");
  });

  it("keeps a caveat on the open rate, because a pixel is not a reader", () => {
    expect(OPEN_RATE_CAVEAT).toContain("floor with noise");
  });
});

describe("openRateLabel", () => {
  function counts(over: Partial<TemplateCounts> = {}): TemplateCounts {
    return { sent: 0, delivered: 0, opened: 0, replied: 0, bounced: 0, lastSentAt: null, ...over };
  }

  it("says a zero was recorded as nothing rather than measured as nought", () => {
    // An account whose tracking never fires, whose recipients block images,
    // and one nobody opens all produce the same zero. Printing 0% sends
    // somebody to rewrite wording that may be working perfectly well.
    const m = templateMetrics(counts({ sent: 54, delivered: 33, opened: 0 }));
    expect(m.openRate).toBe(0);
    expect(openRateLabel(m)).toBe("None recorded");
  });

  it("reports a real open rate as a rate", () => {
    expect(openRateLabel(templateMetrics(counts({ sent: 40, delivered: 40, opened: 10 })))).toBe(
      "25%"
    );
  });

  it("distinguishes never sent from nothing delivered", () => {
    expect(openRateLabel(templateMetrics(counts()))).toBe("Never sent");
    expect(
      openRateLabel(templateMetrics(counts({ sent: 12, delivered: 0, bounced: 12 })))
    ).toBe("Not measurable");
  });

  it("still reports a zero reply rate as a rate, because a reply is not a pixel", () => {
    // Replies arrive through the inbox poll, so nought replies means nought
    // people wrote back, which is exactly what somebody rewriting wants to know.
    const m = templateMetrics(counts({ sent: 54, delivered: 33, replied: 0 }));
    expect(formatMetric(m.replyRate, m.sent)).toBe("0%");
  });
});

import { describe, it, expect } from "vitest";
import { buildDeclineThankYouEmail } from "../lib/domain/decline-closeout";
import {
  isDeclineIntent,
  shouldAutoDecline,
} from "../lib/reply-matching";

describe("isDeclineIntent / shouldAutoDecline", () => {
  it("recognizes decline and cant_fulfill", () => {
    expect(isDeclineIntent("decline")).toBe(true);
    expect(isDeclineIntent("cant_fulfill")).toBe(true);
    expect(isDeclineIntent("quote")).toBe(false);
    expect(isDeclineIntent("interested")).toBe(false);
    expect(isDeclineIntent("other")).toBe(false);
  });

  it("auto-declines only when sender-verified and AI decline intent", () => {
    expect(
      shouldAutoDecline({ senderVerified: true, intent: "cant_fulfill" })
    ).toBe(true);
    expect(shouldAutoDecline({ senderVerified: true, intent: "decline" })).toBe(
      true
    );
    expect(
      shouldAutoDecline({ senderVerified: false, intent: "cant_fulfill" })
    ).toBe(false);
    expect(shouldAutoDecline({ senderVerified: true, intent: "quote" })).toBe(
      false
    );
    expect(shouldAutoDecline({ senderVerified: true, intent: "other" })).toBe(
      false
    );
  });
});

describe("buildDeclineThankYouEmail", () => {
  it("builds a short thank-you without em dashes", () => {
    const mail = buildDeclineThankYouEmail({
      firstName: "Mike Alvarez",
      companyName: "Alvarez Electric",
      opportunityTitle: "Base HVAC Upgrade",
      trade: "electrical",
    });
    expect(mail.subject).toContain("Thank you");
    expect(mail.text).toContain("Hi Mike,");
    expect(mail.text).toContain("Base HVAC Upgrade");
    expect(mail.text).toContain("electrical");
    expect(mail.text.toLowerCase()).toContain("thank you");
    expect(mail.text.includes("\u2014")).toBe(false);
    expect(mail.html.includes("\u2014")).toBe(false);
    expect(mail.subject.includes("\u2014")).toBe(false);
  });

  it("falls back when first name is missing", () => {
    const mail = buildDeclineThankYouEmail({
      firstName: null,
      opportunityTitle: null,
    });
    expect(mail.text).toContain("Hi there,");
    expect(mail.text).toContain("the opportunity");
  });
});

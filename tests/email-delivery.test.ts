/**
 * Delivery state: what we actually know about an email, and nothing more.
 *
 * The rule these tests hold: never claim a message reached somebody without
 * evidence, and never let a bounce pass as a reply. Bounce bodies below are
 * real-shaped DSNs from Gmail, Outlook and a bare SMTP relay, because the
 * formatting varies and a parser that only handles Gmail's is a parser that
 * silently misses two thirds of bounces.
 */
import { describe, it, expect } from "vitest";
import {
  looksLikeBounce,
  parseBounce,
  deliveryStateFor,
  describeDeliveryState,
} from "../lib/domain/email-delivery";

const GMAIL_HARD = `Delivery to the following recipient failed permanently:

     joe@deadcompany.com

Technical details of permanent failure:
Google tried to deliver your message, but it was rejected by the server for the recipient domain deadcompany.com.

----- Original message -----
Message-ID: <CAF7x9abc123@mail.gmail.com>

Reporting-MTA: dns; googlemail.com
Final-Recipient: rfc822; joe@deadcompany.com
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach does not exist.`;

const OUTLOOK_SOFT = `Your message couldn't be delivered.

Final-Recipient: rfc822; sarah@builderco.com
Action: delayed
Status: 4.2.2
Diagnostic-Code: smtp; 452 4.2.2 The recipient's mailbox is full.`;

const BARE_RELAY = `The following message could not be delivered:

550 5.1.1 <mike@gone.example>: Recipient address rejected: User unknown in local recipient table`;

describe("looksLikeBounce", () => {
  it("recognises a bounce by report type, sender, subject, or DSN body", () => {
    expect(looksLikeBounce({ contentType: 'multipart/report; report-type="delivery-status"' })).toBe(true);
    expect(looksLikeBounce({ from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" })).toBe(true);
    expect(looksLikeBounce({ from: "postmaster@corp.example" })).toBe(true);
    expect(looksLikeBounce({ subject: "Delivery Status Notification (Failure)" })).toBe(true);
    expect(looksLikeBounce({ subject: "Undeliverable: Quote request" })).toBe(true);
    expect(looksLikeBounce({ body: GMAIL_HARD })).toBe(true);
  });

  /**
   * The subjects that got through.
   *
   * Every line here is a real provider's wording, and every one of them was
   * recorded as an inbound REPLY: it marked the outreach responsive, satisfied
   * trade coverage nobody had, and left the operator waiting for a quote that
   * could never arrive. The old list matched "undeliverable" but not Postfix's
   * own "Undelivered Mail Returned to Sender", and "delivery has failed" but
   * not "Delivery Failure".
   */
  it.each([
    "Message blocked",
    "Undelivered Mail Returned to Sender",
    "Delivery Failure",
    "Delivery incomplete",
    "Your message was not delivered",
    "Message rejected by recipient server",
    "Warning: could not be delivered",
    "Unable to deliver your message",
    "Quarantine Notification",
    "Recipient address rejected",
  ])("recognises %j as a delivery report, not a reply", (subject) => {
    expect(looksLikeBounce({ subject })).toBe(true);
  });

  it("recognises the automated senders that carry no @ and the gateways that reject on a recipient's behalf", () => {
    // A bare MAILER-DAEMON with no domain: requiring the sigil let it through.
    expect(looksLikeBounce({ from: "MAILER-DAEMON" })).toBe(true);
    expect(looksLikeBounce({ from: "Mail Delivery System <MAILER DAEMON>" })).toBe(true);
    // Security appliances sign the notice themselves, so no daemon address appears.
    expect(looksLikeBounce({ from: "noreply@eu-central.mimecast.com" })).toBe(true);
    expect(looksLikeBounce({ from: "quarantine@corp.example" })).toBe(true);
  });

  it("reads an SMTP rejection quoted in a gateway notice with no DSN part", () => {
    // A reply code followed by an enhanced status code is SMTP's own grammar;
    // prose does not produce it by accident.
    expect(
      looksLikeBounce({
        from: "security@gateway.example",
        subject: "Notification",
        body: "The message to joe@deadco.com was refused: 550 5.7.1 Message blocked by policy.",
      })
    ).toBe(true);
    // Or an enhanced status code introduced the way mail systems introduce one.
    expect(
      looksLikeBounce({
        from: "noreply@relay.example",
        subject: "Notification",
        body: "The remote server returned 5.2.2 while we were trying to reach the recipient.",
      })
    ).toBe(true);
  });

  it("does not mistake a real subcontractor reply for a bounce", () => {
    // The consequence of a false positive is a genuine quote being discarded.
    expect(
      looksLikeBounce({
        from: "Sarah <sarah@builderco.com>",
        subject: "Re: Quote request: electrical",
        body: "We can do it for $42,000. Can start in March. Our mailbox for docs is docs@builderco.com.",
      })
    ).toBe(false);
    // Mentions of failure in ordinary prose must not trip it either.
    expect(
      looksLikeBounce({
        from: "mike@roofco.com",
        subject: "Re: Roof replacement",
        body: "Sorry for the delay, our last delivery failed to show up on site.",
      })
    ).toBe(false);
    // A number that looks like an SMTP code is not one. Widening the detector
    // must not start eating quotes.
    expect(
      looksLikeBounce({
        from: "dana@pavingco.com",
        subject: "Re: Asphalt overlay",
        body: "Our unit price is 550 per ton and we can hold it for 5.2.1 weeks.",
      })
    ).toBe(false);
    /*
     * The one that got through, and cost a real quote.
     *
     * "550 per square" plus "delivery in 3 weeks" satisfied a rule that asked
     * only for an SMTP-looking number near a delivery-ish word. Every term in
     * that sentence is ordinary trade language. Found by running the history
     * repair against realistic data rather than by reading the regex, which is
     * why it is pinned here by its exact wording.
     */
    expect(
      looksLikeBounce({
        from: "sam@realbidder.test",
        subject: "Re: Quote request: roofing",
        body: "Our price is 550 per square, delivery in 3 weeks.",
      })
    ).toBe(false);
    // Nor may a sub quoting a rejection they were told about become one.
    expect(
      looksLikeBounce({
        from: "sam@realbidder.test",
        subject: "Re: Quote request",
        body: "We had 554 failures on the last job and the block delivery was refused twice.",
      })
    ).toBe(false);
  });
});

describe("parseBounce", () => {
  it("reads a Gmail hard bounce in full", () => {
    const r = parseBounce(GMAIL_HARD);
    expect(r.recipient).toBe("joe@deadcompany.com");
    expect(r.status).toBe("5.1.1");
    expect(r.permanent).toBe(true);
    expect(r.originalMessageId).toBe("<CAF7x9abc123@mail.gmail.com>");
    expect(r.reason).toMatch(/does not exist/i);
  });

  it("treats a full mailbox as transient, not a dead address", () => {
    // Suppressing on this would permanently lose a live subcontractor over a
    // mailbox that was full for an afternoon.
    const r = parseBounce(OUTLOOK_SOFT);
    expect(r.recipient).toBe("sarah@builderco.com");
    expect(r.status).toBe("4.2.2");
    expect(r.permanent).toBe(false);
    expect(r.reason).toMatch(/mailbox is full/i);
  });

  it("still extracts what it can from a bare SMTP relay bounce", () => {
    const r = parseBounce(BARE_RELAY);
    expect(r.permanent).toBe(true);
    expect(r.status).toBe("5.1.1");
    expect(r.reason).toMatch(/user unknown|rejected/i);
  });

  it("defaults to transient when the code cannot be read", () => {
    // A parsing miss must never suppress a real address on a guess.
    const r = parseBounce("Something went wrong delivering your message.");
    expect(r.permanent).toBe(false);
    expect(r.status).toBeNull();
  });

  it("honours an explicit delayed action over a permanent-looking code", () => {
    const r = parseBounce(`Final-Recipient: rfc822; a@b.com\nAction: delayed\nStatus: 5.4.7`);
    expect(r.permanent).toBe(false);
  });
});

describe("deliveryStateFor", () => {
  it("never promotes a plain send to delivered", () => {
    // "The API did not throw" is not evidence anyone received it.
    expect(deliveryStateFor({ delivery_state: "sent" })).toBe("sent");
    expect(describeDeliveryState("sent").detail).toMatch(/not confirmation/i);
  });

  it("promotes to delivered only on evidence a human saw it", () => {
    expect(deliveryStateFor({ delivery_state: "sent", opened_at: "2026-01-01" })).toBe("delivered");
    expect(deliveryStateFor({ delivery_state: "sent", clicked_at: "2026-01-01" })).toBe("delivered");
    expect(deliveryStateFor({ delivery_state: "sent", replied_at: "2026-01-01" })).toBe("delivered");
  });

  it("keeps a bounce bounced even if something registered an open", () => {
    // An open can be a scanner or a proxy prefetch; the bounce is the fact the
    // operator has to act on.
    expect(
      deliveryStateFor({ delivery_state: "bounced", opened_at: "2026-01-01" })
    ).toBe("bounced");
  });

  it("flags exactly the states needing attention", () => {
    expect(describeDeliveryState("bounced").attention).toBe(true);
    expect(describeDeliveryState("deferred").attention).toBe(true);
    expect(describeDeliveryState("failed").attention).toBe(true);
    expect(describeDeliveryState("sent").attention).toBe(false);
    expect(describeDeliveryState("delivered").attention).toBe(false);
  });
});

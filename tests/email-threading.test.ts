/**
 * The headers that decide whether a follow-up joins a conversation or starts a
 * new one.
 *
 * Worth stating plainly because it is the part that was wrong in production
 * and the part that looked right from the inside: a Gmail threadId groups
 * messages in OUR mailbox, which is what the in-app conversation view reads,
 * so a follow-up with a threadId and nothing else looks perfectly threaded to
 * us. The subcontractor's mail client never sees a threadId. It threads on
 * In-Reply-To and References, and without them every follow-up arrives as a
 * fresh, context-free email.
 */
import { describe, it, expect } from "vitest";
import { buildGmailRawMessage, referencesHeader } from "../lib/integrations/gmail";

const decode = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");

const base = {
  to: "dana@example-sub.test",
  subject: "Re: Quote request: electrical",
  html: "<p>Just following up.</p>",
};

describe("referencesHeader", () => {
  it("carries the whole chain, oldest first, parent last", () => {
    expect(
      referencesHeader({ references: ["<a@x>", "<b@x>"], inReplyTo: "<c@x>" })
    ).toBe("<a@x> <b@x> <c@x>");
  });

  it("does not repeat the parent when it is already in the chain", () => {
    // References on the parent already ends with the parent's own ancestors;
    // appending blindly produced a header that grew a duplicate every hop.
    expect(referencesHeader({ references: ["<a@x>", "<c@x>"], inReplyTo: "<c@x>" })).toBe(
      "<a@x> <c@x>"
    );
  });

  it("works from the parent alone, which is the two-message case", () => {
    expect(referencesHeader({ inReplyTo: "<c@x>" })).toBe("<c@x>");
  });

  it("is empty for a genuinely new conversation", () => {
    expect(referencesHeader({})).toBe("");
    expect(referencesHeader({ references: [] })).toBe("");
  });
});

describe("buildGmailRawMessage threading headers", () => {
  it("sets In-Reply-To and a full References chain on a follow-up", () => {
    const msg = decode(
      buildGmailRawMessage(
        {
          ...base,
          inReplyTo: "<second@mail.gmail.com>",
          references: ["<first@mail.gmail.com>"],
        },
        "BROSTCO <info@brostco.com>"
      )
    );
    expect(msg).toContain("In-Reply-To: <second@mail.gmail.com>");
    // The third message in a conversation is exactly where a parent-only
    // References stops being enough: a client that has not seen the middle
    // message has nothing connecting this to the first.
    expect(msg).toContain("References: <first@mail.gmail.com> <second@mail.gmail.com>");
  });

  it("still threads when only the parent is known", () => {
    const msg = decode(
      buildGmailRawMessage({ ...base, inReplyTo: "<only@mail.gmail.com>" }, "info@brostco.com")
    );
    expect(msg).toContain("In-Reply-To: <only@mail.gmail.com>");
    expect(msg).toContain("References: <only@mail.gmail.com>");
  });

  it("writes neither header on a first contact", () => {
    // A References header on a message that answers nothing is a lie about the
    // conversation, and some clients will hide it under an unrelated thread.
    const msg = decode(
      buildGmailRawMessage(
        { to: base.to, subject: "Quote request: electrical", html: base.html },
        "info@brostco.com"
      )
    );
    expect(msg).not.toContain("In-Reply-To:");
    expect(msg).not.toContain("References:");
  });

  it("keeps the threading headers when the follow-up carries attachments", () => {
    // The header block is built twice, once for multipart/alternative and once
    // for multipart/mixed. They drifted apart before; a follow-up with the
    // drawings attached must thread exactly like one without.
    const msg = decode(
      buildGmailRawMessage(
        {
          ...base,
          inReplyTo: "<second@mail.gmail.com>",
          references: ["<first@mail.gmail.com>"],
          attachments: [{ filename: "drawings.pdf", content: Buffer.from("%PDF-1.4") }],
        },
        "info@brostco.com"
      )
    );
    expect(msg).toContain("In-Reply-To: <second@mail.gmail.com>");
    expect(msg).toContain("References: <first@mail.gmail.com> <second@mail.gmail.com>");
    expect(msg).toContain("drawings.pdf");
  });
});

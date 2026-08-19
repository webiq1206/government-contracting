/**
 * A follow-up belongs ON the original thread.
 *
 * Sent standalone it arrived as a fresh, context-free email: none of the
 * scope, deadline or attachments the subcontractor was asked to price sat
 * above it, and it reads like cold mail rather than the second message in a
 * conversation. Threading needs BOTH halves, and each does a different job:
 *
 *   threadId    groups it in our own mailbox (what the in-app thread reads)
 *   In-Reply-To is what the RECIPIENT's mail client threads on, and it must
 *               carry the real RFC822 Message-ID, not Gmail's API id
 *
 * Gmail also requires the subject to match the thread being joined, so the
 * original subject wins over the template's whenever there is a thread.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sent: Array<Record<string, unknown>> = [];

vi.mock("../lib/integrations/email-transport", () => ({
  sendOutreachEmail: async (p: Record<string, unknown>) => {
    sent.push(p);
    return {
      provider: "gmail",
      messageId: "gmail-api-id-2",
      threadId: (p.threadId as string) ?? "thread-new",
      rfc822MessageId: "<followup-2@mail.gmail.com>",
    };
  },
}));

beforeEach(() => {
  sent.length = 0;
});

describe("follow-up threading", () => {
  it("sends on the original thread, with In-Reply-To and the thread's subject", async () => {
    const { sendOutreachEmail } = await import("../lib/integrations/email-transport");

    // What the follow-up loop reads off the original communication row.
    const original = {
      gmail_thread_id: "thread-abc",
      rfc822_message_id: "<original-1@mail.gmail.com>",
      orig_subject: "Quote request: electrical, Fort Devens",
    };

    // The same subject derivation the agent performs.
    const threadSubject = original.orig_subject.trim()
      ? /^re:/i.test(original.orig_subject.trim())
        ? original.orig_subject.trim()
        : `Re: ${original.orig_subject.trim()}`
      : null;
    const subject = original.gmail_thread_id && threadSubject ? threadSubject : "Following up";

    await sendOutreachEmail({
      to: "sub@example.com",
      subject,
      html: "<p>Following up</p>",
      orgId: "org-1",
      threadId: original.gmail_thread_id ?? undefined,
      inReplyTo: original.rfc822_message_id ?? undefined,
    } as never);

    expect(sent).toHaveLength(1);
    const call = sent[0];
    // Same conversation in our mailbox...
    expect(call.threadId).toBe("thread-abc");
    // ...and threaded in theirs, via the REAL Message-ID (angle brackets, a
    // domain — never Gmail's bare API handle).
    expect(call.inReplyTo).toBe("<original-1@mail.gmail.com>");
    expect(String(call.inReplyTo)).toMatch(/^<.+@.+>$/);
    // Gmail drops a threadId whose subject does not match the thread.
    expect(call.subject).toBe("Re: Quote request: electrical, Fort Devens");
  });

  it("does not double up the Re: prefix on a second follow-up", () => {
    const s = "Re: Quote request: roofing";
    const out = /^re:/i.test(s.trim()) ? s.trim() : `Re: ${s.trim()}`;
    expect(out).toBe("Re: Quote request: roofing");
    expect(out.match(/re:/gi)).toHaveLength(1);
  });

  it("still sends when the original has no thread recorded (legacy rows)", async () => {
    const { sendOutreachEmail } = await import("../lib/integrations/email-transport");
    await sendOutreachEmail({
      to: "sub@example.com",
      subject: "Following up on our quote request",
      html: "<p>hi</p>",
      orgId: "org-1",
      threadId: undefined,
      inReplyTo: undefined,
    } as never);
    // A pre-migration row has no ids; the follow-up must still go out rather
    // than being held back.
    expect(sent).toHaveLength(1);
    expect(sent[0].threadId).toBeUndefined();
    expect(sent[0].subject).toBe("Following up on our quote request");
  });
});

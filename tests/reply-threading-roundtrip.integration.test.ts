/**
 * The subcontractor email round trip, end to end, against a real database.
 *
 * Two failures were reported from production and both are represented here as
 * the thing that actually goes wrong, not as a unit of the code that was
 * changed:
 *
 *   1. Replies stopped registering. The first reply on a conversation was
 *      captured and every reply after it vanished -- which in a real
 *      negotiation means the "can you send the drawings?" is kept and the
 *      message carrying the price is thrown away.
 *
 *   2. Follow-ups arrived as new conversations. Threading looked perfect from
 *      our side, because a Gmail threadId groups our own mailbox correctly;
 *      what was missing was the part the RECIPIENT's mail client reads.
 *
 * Every row is created and removed by the test.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("subcontractor email round trip (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let cap: typeof import("../lib/reply-capture");

  const ids = {
    org: "",
    orgName: `roundtrip-${randomUUID()}`,
    opp: "",
    sub: "",
    firstComm: "",
    subEmail: `rt-${randomUUID().slice(0, 8)}@example-sub.test`,
    thread: `thread-${randomUUID().slice(0, 8)}`,
    /** The RFC822 Message-ID of the outreach we sent. */
    outreachMessageId: `<outreach-${randomUUID()}@mail.gmail.com>`,
  };

  const baseExtracted = {
    intent: "other" as const,
    isQuote: false,
    quoteAmount: null as number | null,
    paymentTerms: null as string | null,
    notes: null as string | null,
    companyName: null as string | null,
    canPerform: null as boolean | null,
    capabilityNotes: null as string | null,
    tradesMentioned: [] as string[],
    scopeSummary: null as string | null,
    laborCost: null as number | null,
    materialCost: null as number | null,
    exclusions: [] as string[],
    qualifications: [] as string[],
    leadTimeDays: null as number | null,
    availabilityNotes: null as string | null,
    quoteValidUntil: null as string | null,
    missingFields: [] as string[],
    conflicts: [] as string[],
    confidence: 0.9,
    method: "ai" as const,
  };

  /** "Can you send the drawings?" -- keeps them open and waiting. */
  const asksForInfo = async () => ({
    ...baseExtracted,
    intent: "question" as const,
    companyName: "Roundtrip Electric",
    canPerform: true,
    notes: "Can you send the drawings and the wage determination?",
  });

  /** The actual bid, which is what the old matching rule threw away. */
  const quotes = async () => ({
    ...baseExtracted,
    intent: "quote" as const,
    isQuote: true,
    quoteAmount: 121_951.22,
    paymentTerms: "net 30",
    companyName: "Roundtrip Electric",
    canPerform: true,
    scopeSummary: "electrical rough-in and fixtures",
    exclusions: ["permits", "temporary power"],
    qualifications: ["price held 30 days"],
    leadTimeDays: 21,
    availabilityNotes: "can mobilise the first week of April",
  });

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    cap = await import("../lib/reply-capture");

    const org = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
      [ids.orgName]
    );
    ids.org = org!.id;

    const opp = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, title, stage, source)
       values ($1,'TEST roundtrip opp','outreach','manual') returning id`,
      [ids.org]
    );
    ids.opp = opp!.id;

    const sub = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, email, email_verified)
       values ($2,'TEST Roundtrip Electric',$1,true) returning id`,
      [ids.subEmail, ids.org]
    );
    ids.sub = sub!.id;

    await query(
      `insert into opportunity_subs (opportunity_id, subcontractor_id, trade, outreach_state)
       values ($1,$2,'electrical','sent')`,
      [ids.opp, ids.sub]
    );

    // A Gmail-style outreach: real thread id AND a real Message-ID, which is
    // what a healthy send records.
    const comm = await queryOne<{ id: string }>(
      `insert into communications
         (org_id, subcontractor_id, opportunity_id, channel, direction, subject, body,
          gmail_thread_id, rfc822_message_id, provider, recipient_email)
       values ($1,$2,$3,'email','outbound','Quote request: electrical','scope...',
               $4,$5,'gmail',$6)
       returning id`,
      [ids.org, ids.sub, ids.opp, ids.thread, ids.outreachMessageId, ids.subEmail]
    );
    ids.firstComm = comm!.id;
  });

  afterAll(async () => {
    if (!ids.org) return;
    await query(`delete from quotes where opportunity_id=$1`, [ids.opp]);
    await query(`delete from call_cards where opportunity_id=$1`, [ids.opp]);
    await query(`delete from communications where org_id=$1`, [ids.org]);
    await query(`delete from opportunity_subs where opportunity_id=$1`, [ids.opp]);
    await query(`delete from opportunities where id=$1`, [ids.opp]);
    await query(`delete from subcontractors where org_id=$1`, [ids.org]);
    await query(`delete from agent_logs where org_id=$1`, [ids.org]);
    await query(`delete from organizations where id=$1`, [ids.org]);
  });

  it("captures the first reply and leaves the subcontractor open and waiting", async () => {
    const { comm, strongMatch } = await cap.matchInboundReply({
      orgId: ids.org,
      threadId: ids.thread,
      referenceIds: [ids.outreachMessageId],
      fromEmail: ids.subEmail,
    });
    expect(comm?.id).toBe(ids.firstComm);
    expect(strongMatch).toBe(true);

    const result = await cap.captureReply({
      orgId: ids.org,
      comm: comm!,
      strongMatch,
      fromEmail: ids.subEmail,
      replyText: "Thanks - can you send the drawings and the wage determination?",
      threadId: ids.thread,
      messageId: `gmail-in-1-${randomUUID().slice(0, 8)}`,
      rfc822MessageId: `<reply-1-${randomUUID()}@example-sub.test>`,
      subject: "Re: Quote request: electrical",
      fromAddress: `Dana <${ids.subEmail}>`,
      toAddresses: "info@brostco.com",
      ccAddresses: "estimating@example-sub.test",
      sentAt: "Tue, 25 Aug 2026 09:14:00 -0600",
      attachmentNames: [],
      extract: asksForInfo,
    });

    expect(result.bounce).toBeFalsy();
    expect(result.duplicate).toBe(false);
    // Asking a question is not a decline and not a bid: they stay open.
    expect(result.declined).toBe(false);

    const state = await queryOne<{ outreach_state: string }>(
      `select outreach_state from opportunity_subs
        where opportunity_id=$1 and subcontractor_id=$2`,
      [ids.opp, ids.sub]
    );
    expect(["responsive", "responded", "sent"]).toContain(state!.outreach_state);
  });

  it("still captures the SECOND reply, the one carrying the bid", async () => {
    /*
     * The regression, stated as a fact about the product: by now the outreach
     * row has replied_at set by the first reply. Matching used to require
     * `replied_at is null`, so this returned nothing, the poller's
     * `if (!comm) continue` dropped it, and the quote never existed.
     */
    const { comm, strongMatch } = await cap.matchInboundReply({
      orgId: ids.org,
      threadId: ids.thread,
      referenceIds: [ids.outreachMessageId],
      fromEmail: ids.subEmail,
    });
    expect(comm).not.toBeNull();
    expect(strongMatch).toBe(true);

    const result = await cap.captureReply({
      orgId: ids.org,
      comm: comm!,
      strongMatch,
      fromEmail: ids.subEmail,
      replyText: "Our number is $121,951.22, net 30. Excludes permits and temp power.",
      threadId: ids.thread,
      messageId: `gmail-in-2-${randomUUID().slice(0, 8)}`,
      rfc822MessageId: `<reply-2-${randomUUID()}@example-sub.test>`,
      subject: "Re: Quote request: electrical",
      fromAddress: `Dana <${ids.subEmail}>`,
      toAddresses: "info@brostco.com",
      sentAt: "Wed, 26 Aug 2026 11:02:00 -0600",
      attachmentNames: ["Roundtrip-Electric-Bid.pdf"],
      extract: quotes,
    });

    expect(result.duplicate).toBe(false);
    expect(result.quoteSaved).toBe(true);

    const quote = await queryOne<{ quote_amount: string; payment_terms: string | null }>(
      `select quote_amount, payment_terms from quotes
        where opportunity_id=$1 and subcontractor_id=$2
        order by created_at desc limit 1`,
      [ids.opp, ids.sub]
    );
    expect(quote).not.toBeNull();
    expect(Number(quote!.quote_amount)).toBeCloseTo(121_951.22, 2);
    expect(quote!.payment_terms).toBe("net 30");

    // And the pairing now says a bid is in, not merely that they answered.
    const state = await queryOne<{ outreach_state: string }>(
      `select outreach_state from opportunity_subs
        where opportunity_id=$1 and subcontractor_id=$2`,
      [ids.opp, ids.sub]
    );
    expect(["quoted", "responsive", "responded"]).toContain(state!.outreach_state);
  });

  it("keeps the whole message, not a summary of it", async () => {
    const row = await queryOne<{
      subject: string;
      recipient_email: string | null;
      rfc822_message_id: string | null;
      meta: { envelope?: Record<string, unknown> };
    }>(
      `select subject, recipient_email, rfc822_message_id, meta from communications
        where org_id=$1 and direction='inbound'
        order by created_at desc limit 1`,
      [ids.org]
    );
    expect(row).not.toBeNull();
    // The real subject, not the "Re: outreach" placeholder every inbound row
    // used to share, which made one solicitation's thread unreadable from
    // another's in the conversation view.
    expect(row!.subject).toBe("Re: Quote request: electrical");
    // Their Message-ID, so our next message can cite it and a later reply
    // naming it matches straight back here.
    expect(row!.rfc822_message_id).toMatch(/^<reply-2-/);

    const env = row!.meta.envelope as Record<string, unknown>;
    expect(env).toBeTruthy();
    expect(String(env.from)).toContain(ids.subEmail);
    expect(env.sentAt).toBe("Wed, 26 Aug 2026 11:02:00 -0600");
    // The attachment is the bid. A record that forgets it cannot answer
    // "where did this number come from" later.
    expect(env.attachments).toEqual(["Roundtrip-Electric-Bid.pdf"]);
  });

  it("matches on In-Reply-To even when the thread id is unknown to us", async () => {
    /*
     * The case a threadId cannot serve: a subcontractor forwards our request
     * to a colleague who answers from their own mailbox, so the sender is
     * unknown and the conversation was never grouped under our thread. The
     * reference chain still names the exact email being answered.
     */
    const { comm, strongMatch } = await cap.matchInboundReply({
      orgId: ids.org,
      threadId: null,
      referenceIds: [ids.outreachMessageId],
      fromEmail: "someone-else@example-sub.test",
    });
    expect(comm?.id).toBe(ids.firstComm);
    expect(strongMatch).toBe(true);
  });

  it("never reaches across organizations, whatever the reference says", async () => {
    // The same Message-ID, asked for by a different tenant. A match here would
    // attach one customer's subcontractor to another customer's solicitation.
    const other = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
      [`roundtrip-other-${randomUUID()}`]
    );
    try {
      const { comm } = await cap.matchInboundReply({
        orgId: other!.id,
        threadId: ids.thread,
        referenceIds: [ids.outreachMessageId],
        fromEmail: ids.subEmail,
      });
      expect(comm).toBeNull();
    } finally {
      await query(`delete from organizations where id=$1`, [other!.id]);
    }
  });

  it("does not queue a follow-up once the subcontractor has answered", async () => {
    /*
     * The selection rule the follow-up sweep uses, asserted directly against
     * the database. An inbound message exists for this pair from the tests
     * above, so no amount of pending follow_up_at may produce a nudge: a
     * "have you had a chance to price this?" landing after the price did is
     * the most conspicuous way for software to look like nobody is reading.
     */
    await query(
      `update communications set follow_up_at = now() - interval '1 hour', replied_at = null
        where id = $1`,
      [ids.firstComm]
    );

    const due = await query<{ id: string }>(
      `select c.id
         from communications c
        where c.org_id = $1
          and c.channel='email' and c.direction='outbound'
          and c.follow_up_at is not null and c.follow_up_at <= now()
          and c.replied_at is null
          and not exists (
            select 1 from communications r
             where r.org_id = c.org_id and r.direction='inbound'
               and r.subcontractor_id = c.subcontractor_id
               and r.opportunity_id is not distinct from c.opportunity_id
          )
          and not exists (
            select 1 from opportunity_subs os2
             where os2.opportunity_id = c.opportunity_id
               and os2.subcontractor_id = c.subcontractor_id
               and os2.outreach_state in
                   ('responsive','quoted','responded','declined','not_a_fit','unavailable')
          )`,
      [ids.org]
    );
    expect(due.map((r) => r.id)).not.toContain(ids.firstComm);
  });

  it("a delivery report on the thread is never recorded as a reply", async () => {
    const { comm, strongMatch } = await cap.matchInboundReply({
      orgId: ids.org,
      threadId: ids.thread,
      fromEmail: ids.subEmail,
    });
    const before = await queryOne<{ n: number }>(
      `select count(*)::int as n from communications where org_id=$1 and direction='inbound'`,
      [ids.org]
    );

    const result = await cap.captureReply({
      orgId: ids.org,
      comm: comm!,
      strongMatch,
      fromEmail: "MAILER-DAEMON",
      // Postfix's own wording, which the narrow detector used to miss entirely.
      subject: "Undelivered Mail Returned to Sender",
      replyText: "550 5.1.1 The email account that you tried to reach does not exist.",
      threadId: ids.thread,
      messageId: `gmail-dsn-${randomUUID().slice(0, 8)}`,
      extract: quotes,
    });

    expect(result.bounce).toBe(true);
    const after = await queryOne<{ n: number }>(
      `select count(*)::int as n from communications where org_id=$1 and direction='inbound'`,
      [ids.org]
    );
    expect(after!.n).toBe(before!.n);
  });
});

/**
 * Integration test of the inbound-reply capture pipeline against the dev
 * database: a Resend-style outreach (tracking token, no Gmail thread) through
 * an inbound reply, verified sender, quote creation, and the no-overwrite
 * rule. All rows are created and removed by the test.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("reply capture pipeline (Resend inbound path)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let cap: typeof import("../lib/reply-capture");

  const ids = {
    opp: "",
    sub: "",
    comm: "",
    tracking: randomUUID(),
    subEmail: `test-${randomUUID().slice(0, 8)}@example-sub.test`,
  };

  const fakeExtract = async () => ({
    isQuote: true,
    quoteAmount: 98765,
    paymentTerms: "net 30",
    notes: "test extraction",
    companyName: "Test Sub LLC",
    method: "ai" as const,
  });

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    cap = await import("../lib/reply-capture");

    const opp = await queryOne<{ id: string }>(
      `insert into opportunities (title, stage, source) values ('TEST reply-capture opp', 'outreach', 'manual') returning id`
    );
    ids.opp = opp!.id;
    const sub = await queryOne<{ id: string }>(
      `insert into subcontractors (company_name, email, email_verified)
       values ('TEST Reply Capture Sub', $1, true) returning id`,
      [ids.subEmail]
    );
    ids.sub = sub!.id;
    await query(
      `insert into opportunity_subs (opportunity_id, subcontractor_id, trade, outreach_state)
       values ($1,$2,'electrical','sent')`,
      [ids.opp, ids.sub]
    );
    // Resend-style outbound: tracking id set, no gmail thread.
    const comm = await queryOne<{ id: string }>(
      `insert into communications (subcontractor_id, opportunity_id, channel, direction, subject, body, tracking_id, provider)
       values ($1,$2,'email','outbound','TEST outreach','body',$3,'resend') returning id`,
      [ids.sub, ids.opp, ids.tracking]
    );
    ids.comm = comm!.id;
  });

  afterAll(async () => {
    await query(`delete from quotes where opportunity_id=$1`, [ids.opp]);
    await query(`delete from communications where opportunity_id=$1`, [ids.opp]);
    await query(`delete from opportunity_subs where opportunity_id=$1`, [ids.opp]);
    await query(`delete from opportunities where id=$1`, [ids.opp]);
    await query(`delete from subcontractors where id=$1`, [ids.sub]);
  });

  it("correlates by tracking token, verifies sender, and saves the quote", async () => {
    const token = cap.parseCorrelationToken([`info+t${ids.tracking}@brostco.com`]);
    expect(token).toBe(ids.tracking);

    const { comm, strongMatch } = await cap.matchInboundReply({
      trackingToken: token,
      fromEmail: ids.subEmail,
    });
    expect(comm?.id).toBe(ids.comm);
    expect(strongMatch).toBe(true);

    const result = await cap.captureReply({
      comm: comm!,
      strongMatch,
      fromEmail: ids.subEmail,
      replyText: "We can do it for $98,765 net 30.",
      messageId: "resend-msg-1",
      extract: fakeExtract,
    });
    expect(result.senderVerified).toBe(true);
    expect(result.quoteSaved).toBe(true);

    const quote = await queryOne<{ quote_amount: string; trade: string }>(
      `select quote_amount::text, trade from quotes where opportunity_id=$1 and subcontractor_id=$2`,
      [ids.opp, ids.sub]
    );
    expect(Number(quote?.quote_amount)).toBe(98765);
    expect(quote?.trade).toBe("electrical");

    const os = await queryOne<{ outreach_state: string }>(
      `select outreach_state from opportunity_subs where opportunity_id=$1 and subcontractor_id=$2`,
      [ids.opp, ids.sub]
    );
    expect(os?.outreach_state).toBe("responsive");
  });

  it("is idempotent: redelivering the same message id repeats no side effects", async () => {
    const { comm, strongMatch } = await cap.matchInboundReply({
      trackingToken: ids.tracking,
      fromEmail: ids.subEmail,
    });
    // Same messageId as the first capture ("resend-msg-1").
    const result = await cap.captureReply({
      comm: comm!,
      strongMatch,
      fromEmail: ids.subEmail,
      replyText: "We can do it for $98,765 net 30.",
      messageId: "resend-msg-1",
      extract: fakeExtract,
    });
    expect(result.duplicate).toBe(true);
    expect(result.quoteSaved).toBe(false);
    expect(result.subId).toBe(ids.sub);
    const inboundCount = await queryOne<{ n: string }>(
      `select count(*)::text as n from communications
        where direction='inbound' and gmail_message_id='resend-msg-1'`
    );
    expect(Number(inboundCount?.n)).toBe(1);
  });

  it("never overwrites the existing quote on a second reply", async () => {
    const { comm, strongMatch } = await cap.matchInboundReply({
      trackingToken: ids.tracking,
      fromEmail: ids.subEmail,
    });
    const result = await cap.captureReply({
      comm: comm!,
      strongMatch,
      fromEmail: ids.subEmail,
      replyText: "Correction: $50,000.",
      messageId: "resend-msg-2",
      extract: async () => ({
        isQuote: true,
        quoteAmount: 50000,
        paymentTerms: null,
        notes: null,
        companyName: null,
        method: "ai" as const,
      }),
    });
    expect(result.quoteSaved).toBe(false);
    expect(result.quoteSkippedExisting).toBe(true);
    const quote = await queryOne<{ quote_amount: string }>(
      `select quote_amount::text from quotes where opportunity_id=$1 and subcontractor_id=$2`,
      [ids.opp, ids.sub]
    );
    expect(Number(quote?.quote_amount)).toBe(98765); // unchanged
  });

  it("never auto-saves on a weak (sender-only) match", async () => {
    // New outbound comm without tracking/thread; reply matches only by sender.
    const comm2 = await queryOne<{ id: string }>(
      `insert into communications (subcontractor_id, opportunity_id, channel, direction, subject, body, provider)
       values ($1,$2,'email','outbound','TEST outreach 2','body','resend') returning id`,
      [ids.sub, ids.opp]
    );
    const { comm, strongMatch } = await cap.matchInboundReply({
      trackingToken: null,
      fromEmail: ids.subEmail,
    });
    expect(comm).not.toBeNull();
    expect(strongMatch).toBe(false);

    await query(`delete from quotes where opportunity_id=$1`, [ids.opp]); // clear so only the gate blocks
    const result = await cap.captureReply({
      comm: comm!,
      strongMatch,
      fromEmail: ids.subEmail,
      replyText: "Quoting $77,000 for the job.",
      messageId: "resend-msg-3",
      extract: fakeExtract,
    });
    expect(result.quoteSaved).toBe(false);
    const quote = await queryOne<{ id: string }>(
      `select id from quotes where opportunity_id=$1`,
      [ids.opp]
    );
    expect(quote).toBeNull();
    await query(`delete from communications where id=$1`, [comm2!.id]);
  });

  it("blocks auto-save when a different participant replies in the same thread", async () => {
    const { comm, strongMatch } = await cap.matchInboundReply({
      trackingToken: ids.tracking,
      fromEmail: "someone-else@another-company.test",
    });
    expect(strongMatch).toBe(true); // token matches the thread
    const result = await cap.captureReply({
      comm: comm!,
      strongMatch,
      fromEmail: "someone-else@another-company.test",
      replyText: "We quote $12,345.",
      messageId: "resend-msg-4",
      extract: fakeExtract,
    });
    // Sender is not the sub on record: no auto-save.
    expect(result.senderVerified).toBe(false);
    expect(result.quoteSaved).toBe(false);
    // Cleanup the auto-created sub from the unknown sender, if any.
    await query(
      `delete from opportunity_subs where subcontractor_id in (select id from subcontractors where email='someone-else@another-company.test')`
    );
    await query(
      `delete from communications where subcontractor_id in (select id from subcontractors where email='someone-else@another-company.test')`
    );
    await query(`delete from subcontractors where email='someone-else@another-company.test'`);
  });
});

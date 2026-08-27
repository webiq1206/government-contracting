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
    // Capture takes the organization as an argument and every lookup names it,
    // so the fixtures need a real one to belong to. A reply to a conversation
    // owned by nobody is matched by nobody.
    org: "",
    orgName: `reply-capture-${randomUUID()}`,
    opp: "",
    sub: "",
    comm: "",
    tracking: randomUUID(),
    subEmail: `test-${randomUUID().slice(0, 8)}@example-sub.test`,
  };

  /**
   * A complete extraction, spread over per-test overrides.
   *
   * tsconfig excludes tests, so a fake missing a field typechecks and then
   * fails at runtime: these fakes had drifted past confidence, conflicts and
   * missingFields, which is exactly what capture now reads to decide whether
   * it may act. Building from one base keeps the next added field from
   * quietly reaching only production.
   */
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
    // Well above MIN_ACT_CONFIDENCE: these tests are about the ownership
    // rules, so the reading itself must not be what blocks them.
    confidence: 0.9,
    method: "ai" as const,
  };

  const fakeExtract = async () => ({
    ...baseExtracted,
    intent: "quote" as const,
    isQuote: true,
    quoteAmount: 98765,
    paymentTerms: "net 30",
    notes: "test extraction",
    companyName: "Test Sub LLC",
    canPerform: true,
    scopeSummary: "electrical rough-in",
  });

  const fakeDeclineExtract = async () => ({
    ...baseExtracted,
    intent: "cant_fulfill" as const,
    companyName: "Test Sub LLC",
    canPerform: false,
    capabilityNotes: "We do not perform electrical work",
    tradesMentioned: ["plumbing"],
  });

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    cap = await import("../lib/reply-capture");

    const org = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1, 'active') returning id`,
      [ids.orgName]
    );
    ids.org = org!.id;

    const opp = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, title, stage, source)
       values ($1, 'TEST reply-capture opp', 'outreach', 'manual') returning id`,
      [ids.org]
    );
    ids.opp = opp!.id;
    const sub = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, email, email_verified)
       values ($2, 'TEST Reply Capture Sub', $1, true) returning id`,
      [ids.subEmail, ids.org]
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
    await query(`delete from call_cards where opportunity_id=$1`, [ids.opp]);
    await query(`delete from quotes where opportunity_id=$1`, [ids.opp]);
    await query(`delete from communications where opportunity_id=$1`, [ids.opp]);
    await query(`delete from opportunity_subs where opportunity_id=$1`, [ids.opp]);
    await query(`delete from opportunities where id=$1`, [ids.opp]);
    await query(`delete from subcontractors where org_id=$1`, [ids.org]);
    await query(`delete from agent_logs where org_id=$1`, [ids.org]);
    await query(`delete from organizations where id=$1`, [ids.org]);
  });

  it("correlates by tracking token, verifies sender, and saves the quote", async () => {
    const token = cap.parseCorrelationToken([`info+t${ids.tracking}@brostco.com`]);
    expect(token).toBe(ids.tracking);

    const { comm, strongMatch } = await cap.matchInboundReply({
      orgId: ids.org,
      trackingToken: token,
      fromEmail: ids.subEmail,
    });
    expect(comm?.id).toBe(ids.comm);
    expect(strongMatch).toBe(true);

    const result = await cap.captureReply({
      orgId: ids.org,
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

    /*
     * And the pricing row, which is where the reply's own answers live.
     *
     * Everything the extractor read used to be flattened into a `notes`
     * string on the quote, so the estimator got an amount and a paragraph and
     * had to re-derive every fact the paragraph contained.
     */
    const row = await queryOne<{
      base_quote: string;
      payment_terms: string | null;
      confidence: string;
      selected_sub_id: string | null;
      source_quote_id: string | null;
    }>(
      `select base_quote::text, payment_terms, confidence, selected_sub_id, source_quote_id
         from trade_pricing_rows where opportunity_id=$1 and scope_key='electrical'`,
      [ids.opp]
    );
    expect(Number(row?.base_quote)).toBe(98765);
    expect(row?.payment_terms).toBe("net 30");
    expect(row?.selected_sub_id).toBe(ids.sub);
    // The reply never said whether the number was firm, so the row does not
    // say it either. Silence is never upgraded.
    expect(row?.confidence).toBe("unknown");
    // Linked back to the quote it came from, so the two surfaces cannot show
    // two different prices for the same reply.
    expect(row?.source_quote_id).toBeTruthy();
  });

  it("is idempotent: redelivering the same message id repeats no side effects", async () => {
    const { comm, strongMatch } = await cap.matchInboundReply({
      orgId: ids.org,
      trackingToken: ids.tracking,
      fromEmail: ids.subEmail,
    });
    // Same messageId as the first capture ("resend-msg-1").
    const result = await cap.captureReply({
      orgId: ids.org,
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
      orgId: ids.org,
      trackingToken: ids.tracking,
      fromEmail: ids.subEmail,
    });
    const result = await cap.captureReply({
      orgId: ids.org,
      comm: comm!,
      strongMatch,
      fromEmail: ids.subEmail,
      replyText: "Correction: $50,000.",
      messageId: "resend-msg-2",
      extract: async () => ({
        ...baseExtracted,
        intent: "quote" as const,
        isQuote: true,
        quoteAmount: 50000,
        canPerform: true,
        scopeSummary: "electrical rough-in",
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
      orgId: ids.org,
      trackingToken: null,
      fromEmail: ids.subEmail,
    });
    expect(comm).not.toBeNull();
    expect(strongMatch).toBe(false);

    await query(`delete from quotes where opportunity_id=$1`, [ids.opp]); // clear so only the gate blocks
    const result = await cap.captureReply({
      orgId: ids.org,
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
      orgId: ids.org,
      trackingToken: ids.tracking,
      fromEmail: "someone-else@another-company.test",
    });
    expect(strongMatch).toBe(true); // token matches the thread
    const result = await cap.captureReply({
      orgId: ids.org,
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

  it("soft-closes on cant_fulfill, skips quote save, and records thank-you outbound", async () => {
    // Fresh outbound so matchInboundReply can find an unreplied send.
    const outbound = await queryOne<{ id: string }>(
      `insert into communications (subcontractor_id, opportunity_id, channel, direction, subject, body, tracking_id, provider)
       values ($1,$2,'email','outbound','TEST decline outreach','body',$3,'resend') returning id`,
      [ids.sub, ids.opp, randomUUID()]
    );
    await query(
      `update opportunity_subs set outreach_state='sent', responded_at=null
        where opportunity_id=$1 and subcontractor_id=$2`,
      [ids.opp, ids.sub]
    );
    await query(
      `insert into call_cards (opportunity_id, subcontractor_id, card_json, status)
       values ($1,$2,'{}'::jsonb,'pending')
       on conflict (opportunity_id, subcontractor_id) do update
         set status='pending', response_json=null`,
      [ids.opp, ids.sub]
    );

    const { comm, strongMatch } = await cap.matchInboundReply({
      orgId: ids.org,
      trackingToken: null,
      fromEmail: ids.subEmail,
    });
    expect(comm?.id).toBe(outbound!.id);

    const closeOutCalls: unknown[] = [];
    const result = await cap.captureReply({
      orgId: ids.org,
      comm: comm!,
      strongMatch,
      fromEmail: ids.subEmail,
      replyText: "Sorry, we cannot fulfill electrical requests.",
      messageId: "resend-msg-decline-1",
      extract: fakeDeclineExtract,
      closeOut: async (opts) => {
        closeOutCalls.push(opts);
        // Run the real close-out but stub the email send so CI needs no transport.
        const { closeOutDeclinedSub } = await import("../lib/domain/decline-closeout");
        return closeOutDeclinedSub({
          ...opts,
          sendEmail: async () => ({
            provider: "resend",
            messageId: "thank-you-msg-1",
            threadId: null,
          }),
        });
      },
    });

    expect(result.declined).toBe(true);
    expect(result.quoteSaved).toBe(false);
    expect(result.thankYouSent).toBe(true);
    expect(closeOutCalls).toHaveLength(1);

    const os = await queryOne<{ outreach_state: string }>(
      `select outreach_state from opportunity_subs where opportunity_id=$1 and subcontractor_id=$2`,
      [ids.opp, ids.sub]
    );
    expect(os?.outreach_state).toBe("declined");

    const card = await queryOne<{ status: string; response_json: { skip_reason?: string } }>(
      `select status, response_json from call_cards where opportunity_id=$1 and subcontractor_id=$2`,
      [ids.opp, ids.sub]
    );
    expect(card?.status).toBe("skipped");
    expect(card?.response_json?.skip_reason).toBe("email_declined");

    const thankYou = await queryOne<{ subject: string; meta: { kind?: string } }>(
      `select subject, meta from communications
        where opportunity_id=$1 and subcontractor_id=$2
          and direction='outbound' and meta->>'kind'='decline_thank_you'
        order by created_at desc limit 1`,
      [ids.opp, ids.sub]
    );
    expect(thankYou?.meta?.kind).toBe("decline_thank_you");
    expect(thankYou?.subject).toMatch(/Thank you/i);

    const notes = await queryOne<{ notes: string | null }>(
      `select notes from subcontractors where id=$1`,
      [ids.sub]
    );
    expect(notes?.notes ?? "").toMatch(/cannot fulfill|electrical|plumbing/i);
  });
});

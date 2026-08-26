/**
 * A price from a subcontractor who is on more than one trade here.
 *
 * The capture path used to insert straight into `quotes` with whatever trade
 * happened to be resolved, and that resolution is null when a subcontractor is
 * paired to several trades and the reply names none of them. So a firm on
 * electrical and low voltage, asked about both in one email and answering with
 * one number, had that number filed under no trade at all: coverage could not
 * see it, the bid could not use it, and nothing on any screen said so.
 *
 * The rule is that such a price is not filed and the refusal is recorded.
 * Filing it under a guessed trade would be worse, because a wrong trade is
 * invisible everywhere and a missing one is not.
 *
 * Against the real handler and a real database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const LIVE = !!process.env.DATABASE_URL && !!process.env.ALLOW_TESTS_AGAINST_DATABASE_URL;
const d = LIVE ? describe : describe.skip;

d("a price from a subcontractor on several trades", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let cap: typeof import("../lib/reply-capture");

  const org = randomUUID();
  const subEmail = `multi-${randomUUID().slice(0, 8)}@example-sub.test`;
  let oppId = "";
  let subId = "";
  let commId = "";
  const token = randomUUID();

  const extracted = {
    intent: "quote" as const,
    isQuote: true,
    quoteAmount: 88_000,
    paymentTerms: "net 30",
    notes: null as string | null,
    companyName: "Multi Trade LLC",
    canPerform: true,
    capabilityNotes: null as string | null,
    tradesMentioned: [] as string[],
    scopeSummary: "the work as described",
    laborCost: null as number | null,
    materialCost: null as number | null,
    taxesAmount: null as number | null,
    freightAmount: null as number | null,
    mobilizationAmount: null as number | null,
    bondingAmount: null as number | null,
    exclusions: [] as string[],
    qualifications: [] as string[],
    leadTimeDays: null as number | null,
    availabilityNotes: null as string | null,
    earliestStart: null as string | null,
    quoteValidUntil: "30 days" as string | null,
    priceIsFirm: true as boolean | null,
    taxesIncluded: true as boolean | null,
    alternates: [] as string[],
    coversFullScope: null as boolean | null,
    uncoveredScope: null as string | null,
    referredTo: null as string | null,
    missingFields: [] as string[],
    conflicts: [] as string[],
    confidence: 0.9,
    method: "ai" as const,
  };

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    cap = await import("../lib/reply-capture");

    await query(
      `insert into organizations (id, name, subscription_status, billing_exempt)
       values ($1,$2,'active',true) on conflict (id) do nothing`,
      [org, `multi-trade-${randomUUID()}`]
    );
    const opp = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, solicitation_analysis)
       values ($1,'test','Two trade job','outreach','open',$2::jsonb) returning id`,
      [org, JSON.stringify({ required_trades: ["Electrical", "Low voltage"] })]
    );
    oppId = opp!.id;
    const sub = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories, email, email_verified)
       values ($1,'Multi Trade LLC',$2,$3,true) returning id`,
      [org, ["Electrical", "Low voltage"], subEmail]
    );
    subId = sub!.id;
    // Paired to BOTH trades on this one opportunity: the case the rule is for.
    for (const trade of ["Electrical", "Low voltage"]) {
      await query(
        `insert into opportunity_subs (opportunity_id, subcontractor_id, trade, outreach_state)
         values ($1,$2,$3,'sent')`,
        [oppId, subId, trade]
      );
    }
    // The outbound email names no trade, which is how a one-email-two-trades
    // ask reaches the inbox in the first place.
    const comm = await queryOne<{ id: string }>(
      `insert into communications
         (org_id, opportunity_id, subcontractor_id, direction, channel, subject, body,
          tracking_id, provider)
       values ($1,$2,$3,'outbound','email','Pricing request','Please quote.',$4,'resend')
       returning id`,
      [org, oppId, subId, token]
    );
    commId = comm!.id;
  });

  afterAll(async () => {
    await query(`delete from organizations where id=$1`, [org]).catch(() => {});
    const { closePool } = await import("../lib/db");
    await closePool().catch(() => {});
  });

  it("does not file the price, and does not guess a trade for it", async () => {
    const { comm, strongMatch } = await cap.matchInboundReply({
      orgId: org,
      trackingToken: token,
      fromEmail: subEmail,
    });
    expect(comm?.id).toBe(commId);
    expect(strongMatch).toBe(true);

    const result = await cap.captureReply({
      orgId: org,
      comm: comm!,
      strongMatch,
      fromEmail: subEmail,
      replyText: "We can do it for $88,000, net 30, firm for 30 days.",
      messageId: `multi-${randomUUID()}`,
      extract: async () => extracted,
    });

    expect(result.senderVerified).toBe(true);
    expect(result.quoteSaved).toBe(false);
    expect(result.quoteRefusal).toBe("ambiguous_trade");

    // Nothing written under either trade, and nothing written under none.
    const quotes = await query<{ trade: string | null }>(
      `select trade from quotes where opportunity_id=$1`,
      [oppId]
    );
    expect(quotes).toHaveLength(0);
    const rows = await query<{ scope_key: string }>(
      `select scope_key from trade_pricing_rows where opportunity_id=$1`,
      [oppId]
    );
    expect(rows).toHaveLength(0);
  });

  it("records the refusal where somebody will see it", async () => {
    const logged = await query<{ action: string; message: string }>(
      `select action, message from agent_logs
        where opportunity_id=$1 and action='quote-not-filed'`,
      [oppId]
    );
    expect(logged.length).toBeGreaterThan(0);
    // Not "nothing happened": a real price arrived and is waiting on a person.
    expect(logged[0]?.message).toContain("not filed");
  });

  it("files it once the reply is about one named trade", async () => {
    /*
     * The same email, on a conversation that names the trade it was about.
     * The trade is not a column on `communications`; it is stamped into the
     * outbound record's meta at send time and reaches capture on the matched
     * comm, which is why it is set on the object here rather than in the row.
     */
    const comm2 = await queryOne<{ id: string }>(
      `insert into communications
         (org_id, opportunity_id, subcontractor_id, direction, channel, subject, body,
          tracking_id, provider)
       values ($1,$2,$3,'outbound','email','Pricing request','Please quote.',$4,'resend')
       returning id`,
      [org, oppId, subId, randomUUID()]
    );
    const matched = await queryOne<{ id: string }>(`select id from communications where id=$1`, [
      comm2!.id,
    ]);
    expect(matched).toBeTruthy();

    const result = await cap.captureReply({
      orgId: org,
      comm: {
        id: comm2!.id,
        subcontractor_id: subId,
        opportunity_id: oppId,
        company_name: "Multi Trade LLC",
        sub_email: subEmail,
        opportunity_title: "Two trade job",
        trade: "Electrical",
      },
      strongMatch: true,
      fromEmail: subEmail,
      replyText: "We can do it for $88,000, net 30, firm for 30 days.",
      messageId: `multi-named-${randomUUID()}`,
      sentAt: "2026-03-01T09:00:00Z",
      extract: async () => extracted,
    });

    expect(result.quoteSaved).toBe(true);
    expect(result.quoteRefusal).toBeNull();

    const row = await queryOne<{
      trade: string;
      base_quote: string;
      confidence: string;
      quote_expires_on: Date | null;
    }>(
      `select trade, base_quote::text, confidence, quote_expires_on
         from trade_pricing_rows where opportunity_id=$1 and scope_key='electrical'`,
      [oppId]
    );
    expect(row?.trade).toBe("Electrical");
    expect(Number(row?.base_quote)).toBe(88_000);
    // They called it firm, so the row does.
    expect(row?.confidence).toBe("firm");
    // "firm for 30 days" from a reply written on the first of March.
    expect(row?.quote_expires_on?.toISOString().slice(0, 10)).toBe("2026-03-31");

    // And the other trade is still unpriced, which is the true state.
    const lowVoltage = await query<{ id: string }>(
      `select id from trade_pricing_rows where opportunity_id=$1 and scope_key='low-voltage'`,
      [oppId]
    );
    expect(lowVoltage).toHaveLength(0);
  });
});

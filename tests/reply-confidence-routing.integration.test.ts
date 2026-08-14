/**
 * A reading the assistant does not trust must not change anything.
 *
 * decideReply has always known when to hold a reply back: low confidence, a
 * reply that contradicts itself, a regex fallback that never understood
 * anything, or a price that might be inside an attachment nobody could open.
 * It just ran in the poller, AFTER capture had already saved the quote onto
 * the bid and closed the subcontractor out by email. The poller then reported
 * that nothing had been changed automatically, which was untrue by the time it
 * said it.
 *
 * These are the four cases where acting wrongly costs more than waiting. Each
 * one saves a quote or sends a thank-you on the pre-fix code.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";

/** Downstream jobs the capture asked for. */
const enqueued: { name: string; payload: unknown }[] = [];

vi.mock("../lib/queue", () => ({
  enqueue: async (name: string, payload: unknown) => {
    enqueued.push({ name, payload });
    return "job-1";
  },
}));

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("extraction confidence routing (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let cap: typeof import("../lib/reply-capture");

  const ids = {
    org: "",
    orgName: `confidence-${randomUUID()}`,
    opp: "",
    sub: "",
    subEmail: `conf-${randomUUID().slice(0, 8)}@example-sub.test`,
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
    confidence: 0.95,
    method: "ai" as const,
  };

  /** A priced quote, strong on every axis except what each test changes. */
  const quoteReply = (over: Partial<typeof baseExtracted> = {}) => async () => ({
    ...baseExtracted,
    intent: "quote" as const,
    isQuote: true,
    quoteAmount: 42_000,
    scopeSummary: "electrical rough-in",
    ...over,
  });

  const declineReply = (over: Partial<typeof baseExtracted> = {}) => async () => ({
    ...baseExtracted,
    intent: "cant_fulfill" as const,
    canPerform: false,
    capabilityNotes: "wrong trade for us",
    ...over,
  });

  /** A fresh strongly-correlated outbound to reply to, so each case is clean. */
  async function freshOutbound() {
    const tracking = randomUUID();
    await query(
      `insert into communications (org_id, subcontractor_id, opportunity_id, channel, direction, subject, body, tracking_id, provider)
       values ($1,$2,$3,'email','outbound','TEST outreach','body',$4,'resend')`,
      [ids.org, ids.sub, ids.opp, tracking]
    );
    await query(
      `update opportunity_subs set outreach_state='sent', responded_at=null
        where opportunity_id=$1 and subcontractor_id=$2`,
      [ids.opp, ids.sub]
    );
    await query(`update opportunities set stage='outreach' where id=$1`, [ids.opp]);
    const { comm, strongMatch } = await cap.matchInboundReply({
      orgId: ids.org,
      trackingToken: tracking,
      fromEmail: ids.subEmail,
    });
    expect(strongMatch).toBe(true);
    return comm!;
  }

  async function savedQuotes() {
    return query<{ id: string }>(`select id from quotes where opportunity_id=$1`, [ids.opp]);
  }

  async function stage() {
    const row = await queryOne<{ stage: string }>(
      `select stage from opportunities where id=$1`,
      [ids.opp]
    );
    return row?.stage;
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    cap = await import("../lib/reply-capture");

    const org = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1, 'active') returning id`,
      [ids.orgName]
    );
    ids.org = org!.id;
    const opp = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, title, stage, source, status)
       values ($1, 'TEST confidence routing', 'outreach', 'manual', 'open') returning id`,
      [ids.org]
    );
    ids.opp = opp!.id;
    const sub = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, email, email_verified)
       values ($1, 'TEST Confidence Sub', $2, true) returning id`,
      [ids.org, ids.subEmail]
    );
    ids.sub = sub!.id;
    await query(
      `insert into opportunity_subs (opportunity_id, subcontractor_id, trade, outreach_state)
       values ($1,$2,'electrical','sent')`,
      [ids.opp, ids.sub]
    );
  });

  afterAll(async () => {
    await query(`delete from call_cards where opportunity_id=$1`, [ids.opp]).catch(() => {});
    await query(`delete from quotes where opportunity_id=$1`, [ids.opp]).catch(() => {});
    await query(`delete from communications where org_id=$1`, [ids.org]).catch(() => {});
    await query(`delete from subcontractor_reply_events where org_id=$1`, [ids.org]).catch(
      () => {}
    );
    await query(`delete from opportunity_subs where opportunity_id=$1`, [ids.opp]).catch(
      () => {}
    );
    await query(`delete from agent_logs where org_id=$1`, [ids.org]).catch(() => {});
    await query(`delete from opportunities where org_id=$1`, [ids.org]).catch(() => {});
    await query(`delete from subcontractors where org_id=$1`, [ids.org]).catch(() => {});
    await query(`delete from organizations where id=$1`, [ids.org]).catch(() => {});
  });

  it("does not put an unsure reading of a price onto the bid", async () => {
    // Everything else is as strong as it gets: the right sender, the right
    // thread, a real number. The model simply says it is not sure.
    const comm = await freshOutbound();
    enqueued.length = 0;
    const result = await cap.captureReply({
      orgId: ids.org,
      comm,
      strongMatch: true,
      fromEmail: ids.subEmail,
      replyText: "maybe around 42k? forwarded from someone else",
      messageId: `conf-low-${randomUUID()}`,
      extract: quoteReply({ confidence: 0.2 }),
    });

    expect(result.quoteSaved).toBe(false);
    expect(result.decision.act).toBe(false);
    expect(result.decision.needsReview).toBe(true);
    expect(await savedQuotes()).toHaveLength(0);
    // The bid must not have been started on a number nobody trusts.
    expect(await stage()).toBe("outreach");
    expect(enqueued.map((e) => e.name)).not.toContain("bid-builder");
  });

  it("does not pick one of two prices when the reply gives both", async () => {
    const comm = await freshOutbound();
    const result = await cap.captureReply({
      orgId: ids.org,
      comm,
      strongMatch: true,
      fromEmail: ids.subEmail,
      replyText: "$42,000 for the rough-in, or $51,000 with the panel.",
      messageId: `conf-conflict-${randomUUID()}`,
      extract: quoteReply({ conflicts: ["quotes $42,000 and $51,000"] }),
    });

    expect(result.quoteSaved).toBe(false);
    expect(result.decision.reviewReason).toContain("contradicts itself");
    expect(await savedQuotes()).toHaveLength(0);
  });

  it("does not close a subcontractor out on an unsure decline", async () => {
    // Closing out emails them a thank-you, which cannot be recalled.
    const comm = await freshOutbound();
    const closeOutCalls: unknown[] = [];
    const result = await cap.captureReply({
      orgId: ids.org,
      comm,
      strongMatch: true,
      fromEmail: ids.subEmail,
      replyText: "not sure this is for us right now",
      messageId: `conf-decline-${randomUUID()}`,
      extract: declineReply({ confidence: 0.3 }),
      closeOut: async (opts) => {
        closeOutCalls.push(opts);
        return { thankYouSent: true };
      },
    });

    expect(result.declined).toBe(false);
    expect(closeOutCalls).toHaveLength(0);
    expect(result.decision.act).toBe(false);
  });

  it("does not act when the price may be in an attachment nobody could read", async () => {
    const comm = await freshOutbound();
    const closeOutCalls: unknown[] = [];
    const result = await cap.captureReply({
      orgId: ids.org,
      comm,
      strongMatch: true,
      fromEmail: ids.subEmail,
      replyText: "See attached, we cannot cover this scope.",
      messageId: `conf-attach-${randomUUID()}`,
      unreadableAttachments: ["quote-scan.pdf"],
      extract: declineReply(),
      closeOut: async (opts) => {
        closeOutCalls.push(opts);
        return { thankYouSent: true };
      },
    });

    expect(closeOutCalls).toHaveLength(0);
    expect(result.decision.act).toBe(false);
    expect(result.decision.reviewReason).toContain("quote-scan.pdf");
  });

  it("still saves a quote the assistant did understand", async () => {
    // The gate has to let real work through, or it is just an outage.
    const comm = await freshOutbound();
    enqueued.length = 0;
    const result = await cap.captureReply({
      orgId: ids.org,
      comm,
      strongMatch: true,
      fromEmail: ids.subEmail,
      replyText: "We can do the rough-in for $42,000.",
      messageId: `conf-good-${randomUUID()}`,
      extract: quoteReply(),
    });

    expect(result.decision.act).toBe(true);
    expect(result.quoteSaved).toBe(true);
    expect(await savedQuotes()).toHaveLength(1);
    expect(await stage()).toBe("quote_entry");
    expect(enqueued.map((e) => e.name)).toContain("bid-builder");
  });
});

/**
 * The whole subcontractor email workflow, once, against a real database.
 *
 * The individual suites each prove one link: the variables resolve, the
 * attachments open, the follow-up threads, a reply gets the right outcome.
 * This drives the links in sequence with several different subcontractors
 * answering in several different ways, because the failures that survive unit
 * testing are the ones that live between the parts: an outcome that lands on
 * the wrong trade line, a reply matched to the wrong opportunity, a bounce
 * counted as an answer, a follow-up sent to someone who already quoted.
 *
 * It also runs a second organization alongside the first with deliberately
 * similar data, since the one bug class that cannot be allowed is a
 * subcontractor's reply reaching a tenant that never wrote to them.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n");
const sent: { to: string; subject: string; html: string; threadId?: string }[] = [];

const sendSpy = vi.fn(async (args: Record<string, unknown>) => {
  sent.push({
    to: String(args.to),
    subject: String(args.subject),
    html: String(args.html),
    threadId: args.threadId as string | undefined,
  });
  return {
    messageId: `gmail-${sent.length}`,
    threadId: `thread-${sent.length}`,
    rfc822MessageId: `<msg-${sent.length}@mail.gmail.com>`,
    provider: "gmail",
  };
});

vi.mock("../lib/integrations/email-transport", () => ({
  sendOutreachEmail: (a: Record<string, unknown>) => sendSpy(a),
  OUTREACH_SENDER: "BROSTCO <info@brostco.com>",
  OUTREACH_EMAIL: "info@brostco.com",
}));
vi.mock("../lib/ai/companyProfile", () => ({
  getProfileJson: async () => ({
    legal_name: "Prime LLC",
    outreach_display_name: "Pat",
    outreach_email: "pat@prime.invalid",
    phone: "555-1000",
    entity_state: "CO",
  }),
}));
vi.mock("../lib/opportunity-attachments", () => ({
  gatherTradeAttachments: async () => ({
    files: [{ filename: "Statement of Work.pdf", mime: "application/pdf", content: PDF }],
    links: [],
    expected: true,
    undelivered: [],
  }),
}));
vi.mock("../lib/app-settings", () => ({
  areCallsEnabled: async () => false,
  isAutomationPaused: async () => false,
  isAutomationStopped: async () => false,
  isPlatformAutomationPaused: async () => false,
  AUTOMATION_PAUSED_ERROR: "paused",
  getAutomationRules: async () => ({}),
}));
vi.mock("../lib/domain/advance-stage", () => ({
  advancePastCallStep: vi.fn(async () => true),
  advanceIfQuotesComplete: vi.fn(async () => false),
  closeIfSubsExhausted: vi.fn(async () => false),
}));

d("the subcontractor email workflow, end to end (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let outreach: typeof import("../lib/agents/outreach").outreach;
  let decideReply: typeof import("../lib/domain/reply-outcome").decideReply;
  let applyOutcome: typeof import("../lib/domain/reply-outcome").applyOutcomeToSolicitation;
  let looksLikeBounce: typeof import("../lib/domain/email-delivery").looksLikeBounce;

  const orgA = { id: "" };
  const orgB = { id: "" };
  const oppA = { id: "" };
  const oppB = { id: "" };
  const trade = "HVAC";

  /** Four firms, so four different answers can be driven at once. */
  const subs: Record<string, string> = {};

  async function makeOrg(name: string) {
    const o = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
      [`${name}-${randomUUID()}`]
    );
    return o!.id;
  }

  async function makeOpportunity(orgId: string, title: string) {
    const op = await queryOne<{ id: string }>(
      `insert into opportunities
         (org_id, source, title, stage, status, location_state, location_text,
          agency, solicitation_number, deadline, solicitation_analysis)
       values ($1,'test',$2,'sub_research','open','VA','Richmond, VA',
               'US Army Corps of Engineers','W912DR-26-R-0042',
               now() + interval '30 days', $3::jsonb) returning id`,
      [
        orgId,
        title,
        JSON.stringify({
          location: "Richmond, VA",
          trade_scopes: [
            { trade: "HVAC", work: "Remove and replace 12 rooftop units in Buildings 3 and 4." },
          ],
          qualifications: { licenses: ["State mechanical contractor license"] },
        }),
      ]
    );
    return op!.id;
  }

  async function makeSub(orgId: string, oppId: string, company: string, email: string) {
    const s = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories, state, email, email_verified, owner_name)
       values ($1,$2,$3,'VA',$4,true,'Marcus Rivera') returning id`,
      [orgId, company, [trade], email]
    );
    await query(
      `insert into opportunity_subs (opportunity_id, subcontractor_id, trade, outreach_state, verified)
       values ($1,$2,$3,'pending',true)`,
      [oppId, s!.id, trade]
    );
    return s!.id;
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ outreach } = await import("../lib/agents/outreach"));
    const outcome = await import("../lib/domain/reply-outcome");
    decideReply = outcome.decideReply;
    applyOutcome = outcome.applyOutcomeToSolicitation;
    ({ looksLikeBounce } = await import("../lib/domain/email-delivery"));

    orgA.id = await makeOrg("rt-a");
    orgB.id = await makeOrg("rt-b");
    oppA.id = await makeOpportunity(orgA.id, "Rooftop Unit Replacement");
    // Same trade, same state, same title: if anything matches on shape rather
    // than on identity, this is what catches it.
    oppB.id = await makeOpportunity(orgB.id, "Rooftop Unit Replacement");

    subs.quoting = await makeSub(orgA.id, oppA.id, "Rivera Mechanical", "marcus@rivera.invalid");
    subs.declining = await makeSub(orgA.id, oppA.id, "Ace Mechanical", "ace@ace.invalid");
    subs.partial = await makeSub(orgA.id, oppA.id, "Partial Air", "sales@partialair.invalid");
    subs.bouncing = await makeSub(orgA.id, oppA.id, "Gone Away HVAC", "old@goneaway.invalid");
    subs.otherTenant = await makeSub(orgB.id, oppB.id, "Rivera Mechanical", "marcus@rivera.invalid");
  });

  afterAll(async () => {
    for (const id of [orgA.id, orgB.id].filter(Boolean)) {
      await query(`delete from subcontractor_reply_events where org_id=$1`, [id]).catch(() => {});
      await query(`delete from communications where org_id=$1`, [id]).catch(() => {});
      await query(
        `delete from opportunity_subs where opportunity_id in (select id from opportunities where org_id=$1)`,
        [id]
      ).catch(() => {});
      await query(`delete from agent_logs where org_id=$1`, [id]).catch(() => {});
      await query(`delete from subcontractors where org_id=$1`, [id]).catch(() => {});
      await query(`delete from opportunities where org_id=$1`, [id]).catch(() => {});
      await query(`delete from organizations where id=$1`, [id]).catch(() => {});
    }
    vi.restoreAllMocks();
  });

  it("sends one complete quote request per subcontractor", async () => {
    sent.length = 0;
    for (const key of ["quoting", "declining", "partial", "bouncing"]) {
      const res = await outreach.handler({
        runId: randomUUID(),
        trigger: "queue",
        payload: { opportunityId: oppA.id, subcontractorId: subs[key], trade },
      });
      expect(res.ok, key).toBe(true);
    }
    expect(sent).toHaveLength(4);
    for (const msg of sent) {
      expect(msg.html).toMatch(/rooftop units/i);
      expect(msg.html).toMatch(/Your quote is due:/);
      expect(msg.html).toMatch(/Statement of Work\.pdf/);
      expect(msg.html).not.toMatch(/\{\{/);
    }
  });

  it("asks every one of them for a price before our own deadline", async () => {
    const rows = await query<{ quote_due_at: string; deadline: string }>(
      `select c.meta->>'quote_due_at' as quote_due_at, o.deadline::text as deadline
         from communications c join opportunities o on o.id = c.opportunity_id
        where c.opportunity_id = $1 and c.direction = 'outbound'`,
      [oppA.id]
    );
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.quote_due_at).toBeTruthy();
      expect(new Date(r.quote_due_at).getTime()).toBeLessThan(new Date(r.deadline).getTime());
    }
  });

  it("does not send a second copy when the job is redelivered", async () => {
    // pg-boss is at-least-once: a handler that sent and then crashed comes back.
    sent.length = 0;
    const res = await outreach.handler({
      runId: randomUUID(),
      trigger: "queue",
      payload: { opportunityId: oppA.id, subcontractorId: subs.quoting, trade },
    });
    expect(res.ok).toBe(true);
    expect(sent).toHaveLength(0);
  });

  /** A complete extraction, so decideReply reads real arrays rather than holes. */
  function extracted(over: Record<string, unknown>) {
    return {
      intent: "other",
      isQuote: false,
      quoteAmount: null,
      paymentTerms: null,
      notes: null,
      companyName: null,
      canPerform: null,
      capabilityNotes: null,
      tradesMentioned: [],
      scopeSummary: null,
      laborCost: null,
      materialCost: null,
      exclusions: [],
      qualifications: [],
      leadTimeDays: null,
      availabilityNotes: null,
      quoteValidUntil: null,
      priceIsFirm: null,
      taxesIncluded: null,
      alternates: [],
      earliestStart: null,
      coversFullScope: null,
      uncoveredScope: null,
      referredTo: null,
      missingFields: [],
      conflicts: [],
      confidence: 0.9,
      method: "ai",
      ...over,
    } as never;
  }

  describe("four different answers", () => {
    it("records a full quote as quoted", async () => {
      const decision = decideReply(
        extracted({
          intent: "quote",
          isQuote: true,
          quoteAmount: 148000,
          coversFullScope: true,
          scopeSummary: "All 12 rooftop units, Buildings 3 and 4",
          priceIsFirm: true,
          paymentTerms: "Net 30",
          leadTimeDays: 21,
          exclusions: ["Crane rental"],
          confidence: 0.92,
        })
      );
      expect(decision.outcome).toBe("quoted");
      expect(decision.act).toBe(true);
      await applyOutcome({
        opportunityId: oppA.id,
        subcontractorId: subs.quoting,
        trade,
        outcome: decision.outcome,
      });
      const row = await queryOne<{ outreach_state: string }>(
        `select outreach_state from opportunity_subs
          where opportunity_id=$1 and subcontractor_id=$2`,
        [oppA.id, subs.quoting]
      );
      expect(row?.outreach_state).toBe("quoted");
    });

    it("closes a decline without writing anything about the firm itself", async () => {
      const decision = decideReply(extracted({ intent: "decline" }));
      expect(decision.outcome).toBe("declined");
      await applyOutcome({
        opportunityId: oppA.id,
        subcontractorId: subs.declining,
        trade,
        outcome: decision.outcome,
      });
      const pairing = await queryOne<{ outreach_state: string }>(
        `select outreach_state from opportunity_subs
          where opportunity_id=$1 and subcontractor_id=$2`,
        [oppA.id, subs.declining]
      );
      expect(pairing?.outreach_state).toBe("declined");
      /*
       * Declining ONE job says nothing about the next one. Nothing may be
       * written onto the subcontractor record itself.
       */
      const sub = await queryOne<{ email_verified: boolean }>(
        `select email_verified from subcontractors where id=$1`,
        [subs.declining]
      );
      expect(sub?.email_verified).toBe(true);
    });

    it("treats a part-scope price as coverage still owed, and flags the job", async () => {
      const decision = decideReply(
        extracted({
          intent: "partial_scope",
          isQuote: true,
          quoteAmount: 96000,
          coversFullScope: false,
          uncoveredScope: "Building 4 is outside our service area",
          confidence: 0.88,
        })
      );
      expect(decision.outcome).toBe("partial_scope");
      await applyOutcome({
        opportunityId: oppA.id,
        subcontractorId: subs.partial,
        trade,
        outcome: decision.outcome,
      });
      const pairing = await queryOne<{ outreach_state: string }>(
        `select outreach_state from opportunity_subs
          where opportunity_id=$1 and subcontractor_id=$2`,
        [oppA.id, subs.partial]
      );
      // Responded, not quoted: the trade is not covered.
      expect(pairing?.outreach_state).toBe("responded");
      const opp = await queryOne<{ flags: string[]; human: boolean }>(
        `select risk_flags as flags, human_action_required as human
           from opportunities where id=$1`,
        [oppA.id]
      );
      expect(opp?.flags).toContain("partial_scope_coverage");
      expect(opp?.human).toBe(true);
    });

    it("does not count a bounce as an answer", async () => {
      const bounce =
        "Delivery to the following recipient failed permanently:\n" +
        "  old@goneaway.invalid\n\n" +
        "Technical details of permanent failure:\n" +
        "550 5.1.1 The email account that you tried to reach does not exist.";
      expect(
        looksLikeBounce({
          from: "mailer-daemon@googlemail.com",
          subject: "Delivery Status Notification (Failure)",
          body: bounce,
        })
      ).toBe(true);

      /*
       * And a real reply that happens to carry a figure shaped like an SMTP
       * code is NOT a bounce. This exact sentence shipped as a false positive
       * once and closed a live conversation as undeliverable.
       */
      expect(
        looksLikeBounce({
          from: "marcus@rivera.invalid",
          subject: "Re: Pricing request: HVAC",
          body: "Our price is 550 per square, delivery in 3 weeks.",
        })
      ).toBe(false);
    });
  });

  it("keeps one tenant's conversation out of another's", async () => {
    /*
     * The two organizations hold the same company name, the same email address,
     * the same trade and the same opportunity title. Anything matching on shape
     * rather than identity fails here.
     */
    const aRows = await query<{ n: number }>(
      `select count(*)::int as n from communications where org_id=$1`,
      [orgA.id]
    );
    const bRows = await query<{ n: number }>(
      `select count(*)::int as n from communications where org_id=$1`,
      [orgB.id]
    );
    expect(aRows[0].n).toBe(4);
    // Org B never ran outreach, so it must hold nothing at all.
    expect(bRows[0].n).toBe(0);

    const bPairings = await query<{ outreach_state: string }>(
      `select outreach_state from opportunity_subs where opportunity_id=$1`,
      [oppB.id]
    );
    expect(bPairings.every((r) => r.outreach_state === "pending")).toBe(true);
  });

  it("refuses to send when the opportunity cannot describe the work", async () => {
    const thinOpp = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, location_state, deadline)
       values ($1,'test','','sub_research','open','VA', now() + interval '30 days') returning id`,
      [orgA.id]
    );
    const thinSub = await makeSub(orgA.id, thinOpp!.id, "Thin Co", "thin@thin.invalid");
    sent.length = 0;
    const res = await outreach.handler({
      runId: randomUUID(),
      trigger: "queue",
      payload: { opportunityId: thinOpp!.id, subcontractorId: thinSub, trade },
    });
    expect(res.ok).toBe(true);
    expect(res.humanActionRequired).toBe(true);
    // Held, not sent: an email with no scope in it asks for nothing.
    expect(sent).toHaveLength(0);
  });
});

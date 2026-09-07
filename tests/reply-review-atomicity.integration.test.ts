import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const LIVE =
  !!process.env.DATABASE_URL && !!process.env.ALLOW_TESTS_AGAINST_DATABASE_URL;
const d = LIVE ? describe : describe.skip;

d("reply review rollback boundary", () => {
  let query: typeof import("@/lib/db").query;
  let queryOne: typeof import("@/lib/db").queryOne;
  let transaction: typeof import("@/lib/db").transaction;
  let applyOutcomeToSolicitation: typeof import("@/lib/domain/reply-outcome").applyOutcomeToSolicitation;
  let closeOutDeclinedSub: typeof import("@/lib/domain/decline-closeout").closeOutDeclinedSub;
  let saveProposedRow: typeof import("@/lib/pricing-rows").saveProposedRow;

  const orgId = randomUUID();
  let opportunityId = "";
  let subcontractorId = "";

  beforeAll(async () => {
    ({ query, queryOne, transaction } = await import("@/lib/db"));
    ({ applyOutcomeToSolicitation } =
      await import("@/lib/domain/reply-outcome"));
    ({ closeOutDeclinedSub } = await import("@/lib/domain/decline-closeout"));
    ({ saveProposedRow } = await import("@/lib/pricing-rows"));

    await query(
      `insert into organizations (id, name, subscription_status, billing_exempt)
       values ($1,$2,'active',true)`,
      [orgId, `Reply review transaction ${orgId}`],
    );
    const opportunity = await queryOne<{ id: string }>(
      `insert into opportunities
         (org_id, source, title, solicitation_number, stage, status, pursuit_state)
       values ($1,'test','Reply review rollback',$2,'quote_entry','open','active')
       returning id`,
      [orgId, `reply-review-${randomUUID()}`],
    );
    opportunityId = opportunity!.id;
    const subcontractor = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories, notes)
       values ($1,'Rollback Electric','{Electrical}','Original note')
       returning id`,
      [orgId],
    );
    subcontractorId = subcontractor!.id;
    await query(
      `insert into opportunity_subs
         (opportunity_id, subcontractor_id, trade, outreach_state, verified)
       values ($1,$2,'Electrical','pending',true)`,
      [opportunityId, subcontractorId],
    );
  });

  afterAll(async () => {
    if (opportunityId) {
      await query(`delete from trade_pricing_rows where opportunity_id=$1`, [
        opportunityId,
      ]).catch(() => {});
      await query(`delete from quotes where opportunity_id=$1`, [
        opportunityId,
      ]).catch(() => {});
      await query(`delete from opportunity_subs where opportunity_id=$1`, [
        opportunityId,
      ]).catch(() => {});
      await query(`delete from opportunities where id=$1`, [
        opportunityId,
      ]).catch(() => {});
    }
    if (subcontractorId) {
      await query(`delete from subcontractors where id=$1`, [
        subcontractorId,
      ]).catch(() => {});
    }
    await query(`delete from organizations where id=$1`, [orgId]).catch(
      () => {},
    );
    const { closePool } = await import("@/lib/db");
    await closePool().catch(() => {});
  });

  it("rolls quote, structured pricing, and status back when finalization fails", async () => {
    await expect(
      transaction(async (client) => {
        const quote = await client.query<{ id: string }>(
          `insert into quotes
             (org_id, opportunity_id, subcontractor_id, trade, quote_amount, notes)
           values ($1,$2,$3,'Electrical',42000,'rollback probe')
           returning id`,
          [orgId, opportunityId, subcontractorId],
        );
        await saveProposedRow(
          {
            orgId,
            opportunityId,
            subcontractorId,
            sourceQuoteId: quote.rows[0]!.id,
            proposal: {
              trade: "Electrical",
              scopeKey: "electrical",
              baseQuote: 42_000,
              taxes: null,
              freight: null,
              mobilization: null,
              bonding: null,
              pendingComponents: [],
              alternates: [],
              exclusions: [],
              paymentTerms: null,
              quoteExpiresOn: null,
              availability: null,
              leadTimeDays: null,
              confidence: "firm",
              missing: [],
              notes: [],
            },
            onlyIfAbsent: true,
          },
          client,
        );
        await applyOutcomeToSolicitation(
          {
            opportunityId,
            subcontractorId,
            trade: "Electrical",
            outcome: "quoted",
          },
          client,
        );
        throw new Error("simulated event finalization failure");
      }),
    ).rejects.toThrow(/finalization failure/);

    expect(
      await query(`select id from quotes where opportunity_id=$1`, [
        opportunityId,
      ]),
    ).toEqual([]);
    expect(
      await query(`select id from trade_pricing_rows where opportunity_id=$1`, [
        opportunityId,
      ]),
    ).toEqual([]);
    const pair = await queryOne<{ outreach_state: string }>(
      `select outreach_state from opportunity_subs
        where opportunity_id=$1 and subcontractor_id=$2 and trade='Electrical'`,
      [opportunityId, subcontractorId],
    );
    expect(pair?.outreach_state).toBe("pending");
  });

  it("rolls decline state and capability notes back with the same failure", async () => {
    await expect(
      transaction(async (client) => {
        await closeOutDeclinedSub(
          {
            orgId,
            opportunityId,
            subcontractorId,
            trade: "Electrical",
            source: "email_reply",
            capabilityNotes: "Cannot staff this scope.",
            sendThankYou: false,
          },
          { client, deferActivityLog: true },
        );
        throw new Error("simulated event finalization failure");
      }),
    ).rejects.toThrow(/finalization failure/);

    const pair = await queryOne<{ outreach_state: string }>(
      `select outreach_state from opportunity_subs
        where opportunity_id=$1 and subcontractor_id=$2 and trade='Electrical'`,
      [opportunityId, subcontractorId],
    );
    const subcontractor = await queryOne<{ notes: string | null }>(
      `select notes from subcontractors where id=$1 and org_id=$2`,
      [subcontractorId, orgId],
    );
    expect(pair?.outreach_state).toBe("pending");
    expect(subcontractor?.notes).toBe("Original note");
  });
});

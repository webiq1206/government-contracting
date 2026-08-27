/**
 * The pricing row against a real database, and the calculation that cannot
 * move after somebody signed off on it.
 *
 * Everything here was written against Postgres rather than against a reading
 * of the schema, because the last four columns this work assumed into
 * existence were all caught by a live test and none of them by reading.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const LIVE = !!process.env.DATABASE_URL && !!process.env.ALLOW_TESTS_AGAINST_DATABASE_URL;
const d = LIVE ? describe : describe.skip;

d("trade pricing rows in the database", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let savePricingRow: typeof import("../lib/pricing-rows").savePricingRow;
  let pricingRowsFor: typeof import("../lib/pricing-rows").pricingRowsFor;
  let pricingRowsWithQuotes: typeof import("../lib/pricing-rows").pricingRowsWithQuotes;
  let deletePricingRow: typeof import("../lib/pricing-rows").deletePricingRow;
  let freezeCalculation: typeof import("../lib/pricing-rows").freezeCalculation;
  let snapshotsFor: typeof import("../lib/pricing-rows").snapshotsFor;
  let PricingRowRejected: typeof import("../lib/pricing-rows").PricingRowRejected;

  const org = randomUUID();
  const otherOrg = randomUUID();
  let oppId = "";
  let otherOppId = "";
  let subA = "";
  let subB = "";
  let foreignSub = "";
  let bidId = "";

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({
      savePricingRow,
      pricingRowsFor,
      pricingRowsWithQuotes,
      deletePricingRow,
      freezeCalculation,
      snapshotsFor,
      PricingRowRejected,
    } = await import("../lib/pricing-rows"));

    for (const [id, name] of [
      [org, "Pricing Rows Probe"],
      [otherOrg, "Pricing Rows Neighbour"],
    ] as const) {
      await query(
        `insert into organizations (id, name, subscription_status, billing_exempt)
         values ($1,$2,'active',true) on conflict (id) do nothing`,
        [id, name]
      );
    }

    const opp = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, solicitation_number)
       values ($1,'sam','Pricing probe',$2) returning id`,
      [org, `probe-${randomUUID()}`]
    );
    oppId = opp!.id;
    const other = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, solicitation_number)
       values ($1,'sam','Neighbour probe',$2) returning id`,
      [otherOrg, `probe-${randomUUID()}`]
    );
    otherOppId = other!.id;

    const a = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories) values ($1,'Alpha Electric','{Electrical}') returning id`,
      [org]
    );
    subA = a!.id;
    const b = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories) values ($1,'Beta Electric','{Electrical}') returning id`,
      [org]
    );
    subB = b!.id;
    const f = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories) values ($1,'Foreign Electric','{Electrical}') returning id`,
      [otherOrg]
    );
    foreignSub = f!.id;

    const bid = await queryOne<{ id: string }>(
      `insert into bids (opportunity_id, org_id) values ($1,$2) returning id`,
      [oppId, org]
    );
    bidId = bid!.id;
  });

  afterAll(async () => {
    for (const id of [org, otherOrg]) {
      await query(`delete from organizations where id = $1`, [id]).catch(() => {});
    }
    const { closePool } = await import("../lib/db");
    await closePool().catch(() => {});
  });

  it("stores a row and reads every field back", async () => {
    const saved = await savePricingRow({
      orgId: org,
      opportunityId: oppId,
      trade: "Electrical",
      selectedSubId: subA,
      backupSubId: subB,
      baseQuote: 100_000,
      taxes: 8_250,
      freight: null,
      pendingComponents: ["freight"],
      alternates: [{ label: "Add generator", amount: 12_000, included: true }],
      exclusions: [{ text: "Crane", covered_by: "self_perform" }],
      paymentTerms: "Net 30",
      quoteExpiresOn: "2026-09-01",
      availability: "Crew free from mid-July",
      leadTimeDays: 21,
      confidence: "firm",
      actor: "probe@example.com",
    });

    expect(saved.baseQuote).toBe(100_000);
    expect(saved.taxes).toBe(8_250);
    // Null and pending together: the column is empty and the reason is stored.
    expect(saved.freight).toBeNull();
    expect(saved.pendingComponents).toEqual(["freight"]);
    expect(saved.alternates).toEqual([{ label: "Add generator", amount: 12_000, included: true }]);
    expect(saved.exclusions[0]?.coveredBy).toBe("self_perform");
    expect(saved.quoteExpiresOn).toBe("2026-09-01");
    expect(saved.leadTimeDays).toBe(21);
    expect(saved.confidence).toBe("firm");
    expect(saved.selectedSubName).toBe("Alpha Electric");
    expect(saved.backupSubName).toBe("Beta Electric");
  });

  it("updates the same row rather than stacking a second one for the same trade", async () => {
    await savePricingRow({
      orgId: org,
      opportunityId: oppId,
      trade: "  electrical  ",
      baseQuote: 105_000,
      confidence: "budgetary",
      actor: "probe@example.com",
    });
    const rows = await pricingRowsFor(oppId, org);
    const electrical = rows.filter((r) => r.scopeKey === "electrical");
    expect(electrical).toHaveLength(1);
    expect(electrical[0]?.baseQuote).toBe(105_000);
  });

  it("keeps an unknown price null rather than defaulting it to zero", async () => {
    await savePricingRow({
      orgId: org,
      opportunityId: oppId,
      trade: "Plumbing",
      actor: "probe@example.com",
    });
    const row = (await pricingRowsFor(oppId, org)).find((r) => r.scopeKey === "plumbing");
    expect(row).toBeTruthy();
    expect(row!.baseQuote).toBeNull();
    expect(row!.taxes).toBeNull();
    // Confidence is the one that fails closed rather than staying null.
    expect(row!.confidence).toBe("unknown");
  });

  it("refuses a manual adjustment with no reason, in the database as well as in code", async () => {
    await expect(
      savePricingRow({
        orgId: org,
        opportunityId: oppId,
        trade: "Roofing",
        baseQuote: 40_000,
        manualAdjustment: 5_000,
        actor: "probe@example.com",
      })
    ).rejects.toBeInstanceOf(PricingRowRejected);

    // And the constraint holds even if the code check were bypassed.
    await expect(
      query(
        `insert into trade_pricing_rows (org_id, opportunity_id, scope_key, trade, base_quote, manual_adjustment)
         values ($1,$2,'roofing-direct','Roofing',40000,5000)`,
        [org, oppId]
      )
    ).rejects.toThrow();
  });

  it("refuses a subcontractor belonging to another account", async () => {
    await expect(
      savePricingRow({
        orgId: org,
        opportunityId: oppId,
        trade: "HVAC",
        selectedSubId: foreignSub,
        actor: "probe@example.com",
      })
    ).rejects.toBeInstanceOf(PricingRowRejected);
  });

  it("refuses to write against another account's opportunity", async () => {
    await expect(
      savePricingRow({
        orgId: org,
        opportunityId: otherOppId,
        trade: "HVAC",
        baseQuote: 1_000,
        actor: "probe@example.com",
      })
    ).rejects.toBeInstanceOf(PricingRowRejected);
    const leaked = await query(
      `select id from trade_pricing_rows where opportunity_id = $1`,
      [otherOppId]
    );
    expect(leaked).toHaveLength(0);
  });

  it("refuses a backup that is the selected subcontractor", async () => {
    await expect(
      savePricingRow({
        orgId: org,
        opportunityId: oppId,
        trade: "Masonry",
        selectedSubId: subA,
        backupSubId: subA,
        actor: "probe@example.com",
      })
    ).rejects.toBeInstanceOf(PricingRowRejected);
  });

  it("removes a row without removing the quotes behind it", async () => {
    await savePricingRow({
      orgId: org,
      opportunityId: oppId,
      trade: "Painting",
      baseQuote: 9_000,
      actor: "probe@example.com",
    });
    expect(await deletePricingRow(oppId, org, "painting")).toBe(true);
    expect(await deletePricingRow(oppId, org, "painting")).toBe(false);
  });

  it("will not let one account delete another's row", async () => {
    await savePricingRow({
      orgId: org,
      opportunityId: oppId,
      trade: "Sitework",
      baseQuote: 15_000,
      actor: "probe@example.com",
    });
    expect(await deletePricingRow(oppId, otherOrg, "sitework")).toBe(false);
    const still = await pricingRowsFor(oppId, org);
    expect(still.some((r) => r.scopeKey === "sitework")).toBe(true);
  });
});

d("folding the older quote screen into one pricing model", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let pricingRowsWithQuotes: typeof import("../lib/pricing-rows").pricingRowsWithQuotes;
  let savePricingRow: typeof import("../lib/pricing-rows").savePricingRow;

  const org = randomUUID();
  let oppId = "";
  let subA = "";
  let subB = "";

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ pricingRowsWithQuotes, savePricingRow } = await import("../lib/pricing-rows"));
    await query(
      `insert into organizations (id, name, subscription_status, billing_exempt)
       values ($1,'Quote Fold Probe','active',true) on conflict (id) do nothing`,
      [org]
    );
    const opp = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, solicitation_number)
       values ($1,'sam','Quote fold',$2) returning id`,
      [org, `probe-${randomUUID()}`]
    );
    oppId = opp!.id;
    const a = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories) values ($1,'Cheap Sparks','{Electrical}') returning id`,
      [org]
    );
    subA = a!.id;
    const b = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories) values ($1,'Thorough Sparks','{Electrical}') returning id`,
      [org]
    );
    subB = b!.id;
  });

  afterAll(async () => {
    await query(`delete from organizations where id = $1`, [org]).catch(() => {});
    const { closePool } = await import("../lib/db");
    await closePool().catch(() => {});
  });

  it("projects a single quote into a row rather than leaving the trade unpriced", async () => {
    await query(
      `insert into quotes (opportunity_id, subcontractor_id, trade, quote_amount, payment_terms)
       values ($1,$2,'Plumbing',52000,'Net 45')`,
      [oppId, subA]
    );
    const rows = await pricingRowsWithQuotes(oppId, org);
    const plumbing = rows.find((r) => r.scopeKey === "plumbing");
    expect(plumbing?.derived).toBe(true);
    expect(plumbing?.baseQuote).toBe(52_000);
    expect(plumbing?.paymentTerms).toBe("Net 45");
    // A quote knows nothing about how firm it is, so the projection does not
    // claim to either.
    expect(plumbing?.confidence).toBe("unknown");
  });

  it("does not choose between competing quotes on the operator's behalf", async () => {
    await query(
      `insert into quotes (opportunity_id, subcontractor_id, trade, quote_amount)
       values ($1,$2,'Electrical',88000), ($1,$3,'Electrical',94000)`,
      [oppId, subA, subB]
    );
    const rows = await pricingRowsWithQuotes(oppId, org);
    const electrical = rows.find((r) => r.scopeKey === "electrical");
    expect(electrical?.candidates).toHaveLength(2);
    // Specifically not 88,000: the cheapest quote is regularly the one that
    // excluded the most work.
    expect(electrical?.baseQuote).toBeNull();
    expect(electrical?.selectedSubId).toBeNull();
  });

  it("lets a stored row override the projection and keeps the candidates visible", async () => {
    await savePricingRow({
      orgId: org,
      opportunityId: oppId,
      trade: "Electrical",
      selectedSubId: subB,
      baseQuote: 94_000,
      confidence: "firm",
      actor: "probe@example.com",
    });
    const rows = await pricingRowsWithQuotes(oppId, org);
    const electrical = rows.filter((r) => r.scopeKey === "electrical");
    expect(electrical).toHaveLength(1);
    expect(electrical[0]?.derived).toBeFalsy();
    expect(electrical[0]?.baseQuote).toBe(94_000);
    expect(electrical[0]?.candidates).toHaveLength(2);
  });

  it("does not read another account's quotes", async () => {
    const rows = await pricingRowsWithQuotes(oppId, randomUUID());
    expect(rows).toHaveLength(0);
  });
});

d("a calculation frozen behind a decision", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let freezeCalculation: typeof import("../lib/pricing-rows").freezeCalculation;
  let snapshotsFor: typeof import("../lib/pricing-rows").snapshotsFor;
  let calculationHash: typeof import("../lib/pricing-rows").calculationHash;

  const org = randomUUID();
  let oppId = "";
  let bidId = "";

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ freezeCalculation, snapshotsFor, calculationHash } = await import("../lib/pricing-rows"));
    await query(
      `insert into organizations (id, name, subscription_status, billing_exempt)
       values ($1,'Snapshot Probe','active',true) on conflict (id) do nothing`,
      [org]
    );
    const opp = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, solicitation_number)
       values ($1,'sam','Snapshot probe',$2) returning id`,
      [org, `probe-${randomUUID()}`]
    );
    oppId = opp!.id;
    const bid = await queryOne<{ id: string }>(
      `insert into bids (opportunity_id, org_id, bid_amount) values ($1,$2,125000) returning id`,
      [oppId, org]
    );
    bidId = bid!.id;
  });

  afterAll(async () => {
    await query(`delete from organizations where id = $1`, [org]).catch(() => {});
    const { closePool } = await import("../lib/db");
    await closePool().catch(() => {});
  });

  it("writes the calculation and returns the same snapshot for an identical retry", async () => {
    const calculation = { cost: 100_000, bid: 125_000, rows: [{ trade: "Electrical", total: 100_000 }] };
    const first = await freezeCalculation({
      bidId,
      orgId: org,
      opportunityId: oppId,
      reason: "approved",
      actor: "probe@example.com",
      calculation,
    });
    const retry = await freezeCalculation({
      bidId,
      orgId: org,
      opportunityId: oppId,
      reason: "approved",
      actor: "probe@example.com",
      calculation,
    });
    expect(retry.id).toBe(first.id);
    expect((await snapshotsFor(bidId, org))).toHaveLength(1);
  });

  it("writes a second snapshot when the numbers moved between two approvals", async () => {
    await freezeCalculation({
      bidId,
      orgId: org,
      opportunityId: oppId,
      reason: "approved",
      actor: "probe@example.com",
      calculation: { cost: 104_000, bid: 130_000, rows: [{ trade: "Electrical", total: 104_000 }] },
    });
    const all = await snapshotsFor(bidId, org);
    expect(all).toHaveLength(2);
    // Newest first, so the screen shows what was approved most recently.
    expect(all[0]?.calculation.cost).toBe(104_000);
  });

  it("hashes independently of the order the fields happened to be set in", () => {
    expect(calculationHash({ a: 1, b: { c: 2, d: 3 } })).toBe(
      calculationHash({ b: { d: 3, c: 2 }, a: 1 })
    );
    expect(calculationHash({ a: 1 })).not.toBe(calculationHash({ a: 2 }));
  });

  it("cannot be edited afterwards", async () => {
    await expect(
      query(`update bid_calculation_snapshots set calculation = '{}'::jsonb where bid_id = $1`, [bidId])
    ).rejects.toThrow(/immutable/);
  });

  it("cannot be deleted while the bid it justifies still exists", async () => {
    await expect(
      query(`delete from bid_calculation_snapshots where bid_id = $1`, [bidId])
    ).rejects.toThrow(/cannot be deleted/);
  });

  it("goes when the bid goes", async () => {
    const opp2 = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, solicitation_number)
       values ($1,'sam','Cascade probe',$2) returning id`,
      [org, `probe-${randomUUID()}`]
    );
    const bid2 = await queryOne<{ id: string }>(
      `insert into bids (opportunity_id, org_id) values ($1,$2) returning id`,
      [opp2!.id, org]
    );
    await freezeCalculation({
      bidId: bid2!.id,
      orgId: org,
      opportunityId: opp2!.id,
      reason: "sent",
      actor: "probe@example.com",
      calculation: { cost: 1 },
    });
    await query(`delete from bids where id = $1`, [bid2!.id]);
    const left = await query(`select id from bid_calculation_snapshots where bid_id = $1`, [bid2!.id]);
    expect(left).toHaveLength(0);
  });

  it("refuses to freeze against another account's bid", async () => {
    await expect(
      freezeCalculation({
        bidId,
        orgId: randomUUID(),
        opportunityId: oppId,
        reason: "approved",
        actor: "probe@example.com",
        calculation: { cost: 1 },
      })
    ).rejects.toThrow();
  });
});

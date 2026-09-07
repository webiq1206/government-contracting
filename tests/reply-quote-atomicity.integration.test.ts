import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { ProposedRow } from "@/lib/domain/quote-fields";

const d = process.env.DATABASE_URL ? describe : describe.skip;

d("automatic reply quote transaction", () => {
  let query: typeof import("@/lib/db").query;
  let queryOne: typeof import("@/lib/db").queryOne;
  let persist: typeof import("@/lib/reply-quote").persistReplyQuote;
  const org = randomUUID(), opp = randomUUID(), sub = randomUUID();
  const probe = `audit_quote_${randomUUID().replaceAll("-", "")}`;
  const proposal: ProposedRow = {
    trade: "Electrical", scopeKey: "electrical", baseQuote: 42_000,
    taxes: null, freight: null, mobilization: null, bonding: null,
    pendingComponents: [], alternates: [], exclusions: [], paymentTerms: "net 30",
    quoteExpiresOn: null, availability: null, leadTimeDays: null,
    confidence: "firm", missing: [], notes: [],
  };
  const input = { orgId: org, opportunityId: opp, subcontractorId: sub,
    proposal, notes: "Synthetic reply transaction test", receivedAt: new Date() };

  beforeAll(async () => {
    ({ query, queryOne } = await import("@/lib/db"));
    ({ persistReplyQuote: persist } = await import("@/lib/reply-quote"));
    await query(`insert into organizations (id,name,subscription_status,billing_exempt)
      values ($1,$2,'active',true)`, [org, `Quote atomicity ${org}`]);
    await query(`insert into opportunities (id,org_id,title,source,stage,status,pursuit_state)
      values ($1,$2,'Synthetic quote','test','outreach','open','active')`, [opp, org]);
    await query(`insert into subcontractors (id,org_id,company_name)
      values ($1,$2,'Synthetic Electric')`, [sub, org]);
    await query(`insert into opportunity_subs (opportunity_id,subcontractor_id,trade,outreach_state)
      values ($1,$2,'Electrical','sent')`, [opp, sub]);
  });

  afterAll(async () => {
    await query(`drop trigger if exists ${probe} on opportunity_subs`);
    await query(`drop function if exists ${probe}()`);
    await query(`delete from organizations where id=$1`, [org]);
    await (await import("@/lib/db")).closePool();
  });

  it("rolls both quote and pricing back if the following coverage write fails", async () => {
    // UUID-derived identifiers and a fixture-only trigger leave other suites alone.
    await query(`create function ${probe}() returns trigger language plpgsql as $$
      begin raise exception 'synthetic coverage failure'; end $$`);
    await query(`create trigger ${probe} before update on opportunity_subs
      for each row when (new.opportunity_id='${opp}'::uuid)
      execute function ${probe}()`);
    try {
      await expect(persist(input)).rejects.toThrow("synthetic coverage failure");
      expect(await query(`select id from quotes where opportunity_id=$1`, [opp])).toHaveLength(0);
      expect(await query(`select id from trade_pricing_rows where opportunity_id=$1`, [opp])).toHaveLength(0);
      expect(await queryOne(`select stage from opportunities where id=$1`, [opp])).toEqual({ stage: "outreach" });
    } finally {
      await query(`drop trigger ${probe} on opportunity_subs`);
      await query(`drop function ${probe}()`);
    }
  });

  it("allows a clean retry and serializes concurrent duplicate prices", async () => {
    const results = await Promise.all([persist(input), persist(input)]);
    expect(results.sort()).toEqual(["kept_existing", "saved"]);
    expect(await query(`select id from quotes where opportunity_id=$1`, [opp])).toHaveLength(1);
    expect(await query(`select base_quote from trade_pricing_rows where opportunity_id=$1`, [opp]))
      .toEqual([{ base_quote: 42_000 }]);
    expect(await queryOne(`select stage from opportunities where id=$1`, [opp])).toEqual({ stage: "quote_entry" });
  });

  it("does not accept an automatic price after the pursuit has paused", async () => {
    await query(`update opportunities set pursuit_state='paused' where id=$1`, [opp]);
    expect(await persist({ ...input, proposal: { ...proposal, baseQuote: 99_000 } })).toBe("not_editable");
    expect(await query(`select base_quote from trade_pricing_rows where opportunity_id=$1`, [opp]))
      .toEqual([{ base_quote: 42_000 }]);
  });
});

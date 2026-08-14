/**
 * Two-organization isolation proof for the Compliance Monitor.
 *
 * Every decision this agent makes is per customer: their UEI, their
 * certifications, their contracts, their thresholds, their alert number. It
 * ran with no tenant context, so it read one profile, swept everyone's
 * contracts against it, and deduped compliance items on (category, label),
 * keys that are identical across tenants. Every organization has exactly one
 * item called "SAM.gov registration", so they were all fighting over one row.
 *
 * SAM, SMS, and the FAR feed are stubbed: the agent's own request volume is
 * not what is under test, and SAM quota is not something a test may spend.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";

const A_UEI = "ORGAUEI000A1";
const B_UEI = "ORGBUEI000B1";

/** Alert texts the run attempted, so we can prove none crosses tenants. */
const alerts: string[] = [];

vi.mock("../lib/integrations/sam", () => ({
  sam: {
    // Expiry mirrors the UEI so each org's item is identifiable on sight.
    getEntityRegistration: async (uei: string) => ({
      disabled: false,
      status: "Active",
      expiresAt: uei === "ORGAUEI000A1" ? "2030-01-01T00:00:00Z" : "2031-01-01T00:00:00Z",
    }),
  },
}));

vi.mock("../lib/integrations/twilio", () => ({
  sms: {
    alert: async (body: string) => {
      alerts.push(body);
      return { disabled: true };
    },
  },
}));

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("compliance monitor checks each organization separately (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let complianceMonitor: typeof import("../lib/agents/compliance-monitor").complianceMonitor;

  const orgA = { id: "", name: `comp-a-${randomUUID()}`, uei: A_UEI, contract: "" };
  const orgB = { id: "", name: `comp-b-${randomUUID()}`, uei: B_UEI, contract: "" };
  const realFetch = globalThis.fetch;

  async function makeOrg(o: typeof orgA, contractNumber: string) {
    const org = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1, 'active') returning id`,
      [o.name]
    );
    o.id = org!.id;

    await query(
      `insert into company_profile (org_id, version, is_active, profile_json, profile_text)
       values ($1, 1, true, $2::jsonb, $3)`,
      [o.id, JSON.stringify({ uei: o.uei, certifications: [] }), `Profile for ${o.name}`]
    );

    const contract = await queryOne<{ id: string }>(
      `insert into contracts (org_id, contract_number, status, non_ss_sub_pct)
       values ($1, $2, 'active', 95) returning id`,
      [o.id, contractNumber]
    );
    o.contract = contract!.id;
  }

  /** This organization's monitor-written compliance items, by category. */
  async function itemsFor(orgId: string, category: string) {
    return query<{ label: string; detail: Record<string, unknown> | null; org_id: string | null }>(
      `select label, detail, org_id from compliance_items
        where org_id = $1 and category = $2`,
      [orgId, category]
    );
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ complianceMonitor } = await import("../lib/agents/compliance-monitor"));
    // The FAR feed is a live RSS fetch, and a test has no business making it.
    globalThis.fetch = (async () => {
      throw new Error("network disabled in tests");
    }) as typeof fetch;

    await makeOrg(orgA, "ORGA-CONTRACT-001");
    await makeOrg(orgB, "ORGB-CONTRACT-001");
    await complianceMonitor.handler({ runId: randomUUID(), trigger: "cron", payload: {} });
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    for (const o of [orgA, orgB]) {
      if (!o.id) continue;
      await query(`delete from compliance_items where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from agent_logs where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from contracts where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from company_profile where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from organizations where id = $1`, [o.id]).catch(() => {});
    }
  });

  it("gives each organization its own SAM registration item", async () => {
    // The dedupe key (category, label) is identical for every tenant, so
    // unscoped the second org's check overwrote the first org's row with its
    // own UEI and expiry instead of creating one of its own.
    const a = await itemsFor(orgA.id, "sam_registration");
    const b = await itemsFor(orgB.id, "sam_registration");
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
    expect(a[0].detail?.uei).toBe(A_UEI);
    expect(b[0].detail?.uei).toBe(B_UEI);
  });

  it("checks the sub spend cap only against the organization's own contracts", async () => {
    const a = await itemsFor(orgA.id, "non_ss_cap");
    const b = await itemsFor(orgB.id, "non_ss_cap");
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
    expect(a[0].label).toContain("ORGA-CONTRACT-001");
    expect(a[0].label).not.toContain("ORGB-CONTRACT-001");
    expect(b[0].label).toContain("ORGB-CONTRACT-001");
  });

  it("files every item under an organization", async () => {
    // An item with no org is invisible on the compliance page that exists to
    // show it, so writing one is the same as not writing it at all.
    const orphans = await query<{ count: string }>(
      `select count(*)::int as count from compliance_items
        where org_id is null and label like '%ORG_-CONTRACT-001%'`
    );
    expect(Number(orphans[0].count)).toBe(0);
    for (const o of [orgA, orgB]) {
      const all = await query<{ org_id: string | null }>(
        `select org_id from compliance_items where org_id = $1`,
        [o.id]
      );
      expect(all.length).toBeGreaterThan(0);
      for (const row of all) expect(row.org_id).toBe(o.id);
    }
  });

  it("does not put one organization's contract in another's alert", () => {
    for (const body of alerts) {
      const mentionsA = body.includes("ORGA-CONTRACT-001");
      const mentionsB = body.includes("ORGB-CONTRACT-001");
      expect(mentionsA && mentionsB, `alert mixes both tenants: ${body}`).toBe(false);
    }
  });
});

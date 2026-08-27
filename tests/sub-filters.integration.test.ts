/**
 * The roster filters, against a real database.
 *
 * These are the filters that decide which firms an operator ever looks at, so
 * the interesting question is not whether the SQL parses. It is whether a firm
 * nobody has emailed is excluded from a response-rate filter rather than
 * scored at zero, and whether the reachability predicate here says the same
 * thing as the badge on the record page.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

const org = { id: "" };
vi.mock("@/lib/tenant", () => ({
  tryResolveTenantOrgId: async () => org.id,
  resolveTenantOrgId: async () => org.id,
}));

d("roster filters (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let data: typeof import("../lib/data");

  const ids: Record<string, string> = {};
  let oppId = "";

  async function makeSub(key: string, cols: Record<string, unknown>) {
    const names = Object.keys(cols);
    const row = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name${names.length ? ", " + names.join(", ") : ""})
       values ($1, $2${names.map((_, i) => `, $${i + 3}`).join("")}) returning id`,
      [org.id, `${key}-${randomUUID().slice(0, 8)}`, ...names.map((n) => cols[n])]
    );
    ids[key] = row!.id;
    return row!.id;
  }

  async function sends(subId: string, total: number, replied: number) {
    for (let i = 0; i < total; i++) {
      await query(
        `insert into communications (org_id, subcontractor_id, opportunity_id, channel, direction, subject, body, replied_at)
         values ($1,$2,$3,'email','outbound','Pricing request','body', $4)`,
        [org.id, subId, oppId, i < replied ? new Date() : null]
      );
    }
  }

  /*
   * One quote per opportunity, because the table holds one per (opportunity,
   * subcontractor, trade). Three quotes means three bids, which is what the
   * rate is measuring anyway.
   */
  async function quotes(subId: string, n: number) {
    for (let i = 0; i < n; i++) {
      const op = await queryOne<{ id: string }>(
        `insert into opportunities (org_id, source, title, stage, status, deadline)
         values ($1,'test',$2,'outreach','open', now() + interval '30 days') returning id`,
        [org.id, `Quote fixture ${i}-${randomUUID().slice(0, 8)}`]
      );
      await query(
        `insert into quotes (org_id, subcontractor_id, opportunity_id, trade, quote_amount)
         values ($1,$2,$3,'Electrical', 1000.00)`,
        [org.id, subId, op!.id]
      );
    }
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    const o = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
      [`filters-${randomUUID()}`]
    );
    org.id = o!.id;
    data = await import("../lib/data");

    const op = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, deadline)
       values ($1,'test','Filter fixture','outreach','open', now() + interval '30 days') returning id`,
      [org.id]
    );
    oppId = op!.id;

    await makeSub("reachable", { email: "a@example.test", email_verified: true, phone: "5125550100" });
    await makeSub("phoneOnly", { phone: "5125550101" });
    await makeSub("unreachable", { email: "b@example.test", email_verified: false });
    await makeSub("nothing", {});
    await makeSub("travels", {
      phone: "5125550102", state: "TX", service_area_states: ["NM", "AZ"],
    });
    await makeSub("localOnly", { phone: "5125550103", state: "NM" });
    await makeSub("certified", { phone: "5125550104", certifications: ["hubzone", "sdvosb"] });
    await makeSub("bonded", { phone: "5125550105", bonded: true, bond_single_cents: 500_000_00 });
    await makeSub("bondUnknown", { phone: "5125550106", bonded: true });
    await makeSub("bigCrew", { phone: "5125550107", crew_size: 20 });
    await makeSub("crewUnknown", { phone: "5125550108" });

    // Rate fixtures: a responsive firm, a silent one, and a stranger.
    await makeSub("responsive", { phone: "5125550110" });
    await sends(ids.responsive, 4, 3);
    await quotes(ids.responsive, 3);
    await makeSub("silent", { phone: "5125550111" });
    await sends(ids.silent, 4, 0);
    await makeSub("stranger", { phone: "5125550112" });
  });

  afterAll(async () => {
    if (!org.id) return;
    await query(`delete from quotes where org_id=$1`, [org.id]).catch(() => {});
    await query(`delete from communications where org_id=$1`, [org.id]).catch(() => {});
    await query(`delete from opportunities where org_id=$1`, [org.id]).catch(() => {});
    await query(`delete from subcontractors where org_id=$1`, [org.id]).catch(() => {});
    await query(`delete from organizations where id=$1`, [org.id]).catch(() => {});
  });

  async function idsFor(filters: Parameters<typeof data.subDatabase>[0]) {
    const rows = await data.subDatabase(filters, { limit: 200 });
    return new Set(rows.map((r) => r.id));
  }

  it("counts a phone number as reachable and an unverified address as not", async () => {
    const yes = await idsFor({ contactable: "yes" });
    expect(yes.has(ids.reachable)).toBe(true);
    expect(yes.has(ids.phoneOnly)).toBe(true);
    // The same call the record header makes: an address that has not passed
    // verification is an outreach that will not go out.
    expect(yes.has(ids.unreachable)).toBe(false);
    expect(yes.has(ids.nothing)).toBe(false);

    const no = await idsFor({ contactable: "no" });
    expect(no.has(ids.unreachable)).toBe(true);
    expect(no.has(ids.reachable)).toBe(false);
  });

  it("splits the roster on award-blocking paperwork", async () => {
    const short = await idsFor({ paperwork: "short" });
    // Nothing in this fixture has any documents at all, so every firm is short.
    expect(short.has(ids.reachable)).toBe(true);
    const ready = await idsFor({ paperwork: "ready" });
    expect(ready.size).toBe(0);
  });

  it("uses the recorded service area, and the firm's own state when there is none", async () => {
    const nm = await idsFor({ worksIn: "nm" });
    expect(nm.has(ids.travels)).toBe(true);
    // No service area recorded, but they are in NM, so they are a candidate
    // rather than being excluded for a question nobody asked them.
    expect(nm.has(ids.localOnly)).toBe(true);
    // Recorded as working NM and AZ, so their home state does not add TX.
    const tx = await idsFor({ worksIn: "TX" });
    expect(tx.has(ids.travels)).toBe(false);
  });

  it("filters on a certification without matching a firm that holds a different one", async () => {
    const hub = await idsFor({ certification: "hubzone" });
    expect(hub.has(ids.certified)).toBe(true);
    expect(hub.has(ids.reachable)).toBe(false);
    expect((await idsFor({ certification: "8a" })).has(ids.certified)).toBe(false);
  });

  it("does not pass a bond nobody has put a figure on", async () => {
    const big = await idsFor({ minBondCents: 400_000_00 });
    expect(big.has(ids.bonded)).toBe(true);
    // Bonded is a claim; this filter asks for an amount, and there is none.
    expect(big.has(ids.bondUnknown)).toBe(false);
  });

  it("excludes a crew size nobody has asked about rather than treating it as zero", async () => {
    const crew = await idsFor({ minCrew: 5 });
    expect(crew.has(ids.bigCrew)).toBe(true);
    expect(crew.has(ids.crewUnknown)).toBe(false);
  });

  describe("rates, and the denominator they need", () => {
    it("sets aside a firm nobody has emailed instead of scoring it at zero", async () => {
      const responsive = await idsFor({ minResponseRate: 50 });
      expect(responsive.has(ids.responsive)).toBe(true);
      expect(responsive.has(ids.silent)).toBe(false);
      /*
       * The case this rule exists for. A stranger's response rate is not 0%,
       * it is unknown, and the firms most in need of a first touch must not
       * be ranked below the ones that have ignored four emails.
       */
      expect(responsive.has(ids.stranger)).toBe(false);
    });

    it("respects a caller who wants more evidence before a rate counts", async () => {
      // Four sends clears a floor of three and does not clear a floor of five.
      expect((await idsFor({ minResponseRate: 50, rateEvidence: 3 })).has(ids.responsive)).toBe(true);
      expect((await idsFor({ minResponseRate: 50, rateEvidence: 5 })).has(ids.responsive)).toBe(false);
    });

    it("measures quoting against what was asked of them", async () => {
      const quoting = await idsFor({ minQuoteRate: 50 });
      expect(quoting.has(ids.responsive)).toBe(true);
      expect(quoting.has(ids.silent)).toBe(false);
    });

    it("measures awards against quotes given, not emails sent", async () => {
      // Nothing has been awarded in this fixture, so nobody clears the bar,
      // and in particular the firm with three quotes does not read as 0/4.
      const awarded = await idsFor({ minAwardRate: 1 });
      expect(awarded.size).toBe(0);
    });
  });

  it("keeps the count and the page in agreement", async () => {
    for (const f of [
      { contactable: "yes" as const },
      { minCrew: 5 },
      { certification: "hubzone" },
      { minResponseRate: 50 },
    ]) {
      const n = await data.subDatabaseCount(f);
      const rows = await data.subDatabase(f, { limit: 200 });
      // A header that says 12 over a list of 9 is a filter somebody stops
      // trusting, and the two go through the same builder to prevent it.
      expect(n).toBe(rows.length);
    }
  });
});

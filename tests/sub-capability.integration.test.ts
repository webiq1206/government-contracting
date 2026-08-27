/**
 * What a firm can take on, written to a real database.
 *
 * The interesting cases are the ones a unit test cannot reach: that the
 * constraints agree with the domain constants, that a partial save does not
 * wipe a field a different tab wrote, and that one organization cannot write
 * capability onto another's record.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  CONTACT_ROLES,
  PREFERRED_CONTACT,
  SOURCE_CONFIDENCE,
} from "@/lib/domain/sub-capability";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("subcontractor capability (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let store: typeof import("../lib/sub-capability-store");

  const mine = { id: "" };
  const theirs = { id: "" };
  let sub = "";
  let theirSub = "";

  async function makeSub(orgId: string, name: string) {
    const row = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories)
       values ($1,$2,'{Electrical}') returning id`,
      [orgId, `${name}-${randomUUID().slice(0, 8)}`]
    );
    return row!.id;
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    store = await import("../lib/sub-capability-store");
    for (const org of [mine, theirs]) {
      const o = await queryOne<{ id: string }>(
        `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
        [`cap-${randomUUID()}`]
      );
      org.id = o!.id;
    }
    sub = await makeSub(mine.id, "Capable");
    theirSub = await makeSub(theirs.id, "NotMine");
  });

  afterAll(async () => {
    for (const org of [mine, theirs]) {
      if (!org.id) continue;
      await query(`delete from subcontractors where org_id=$1`, [org.id]).catch(() => {});
      await query(`delete from organizations where id=$1`, [org.id]).catch(() => {});
    }
  });

  it("agrees with the database about the values each field may hold", async () => {
    /*
     * Two lists that must match and nothing forcing them to. A role added to
     * the module but not the constraint fails at save time in front of an
     * operator; one added to the constraint but not the module is a value the
     * UI can never produce and never label.
     */
    const checks = await query<{ conname: string; def: string }>(
      `select conname, pg_get_constraintdef(oid) as def
         from pg_constraint
        where conname in ('subcontractors_preferred_contact_ck',
                          'subcontractors_source_confidence_ck',
                          'subcontractor_contacts_role_ck')`
    );
    const def = (n: string) => checks.find((c) => c.conname === n)?.def ?? "";
    for (const v of PREFERRED_CONTACT) {
      expect(def("subcontractors_preferred_contact_ck")).toContain(`'${v}'`);
    }
    for (const v of SOURCE_CONFIDENCE) {
      expect(def("subcontractors_source_confidence_ck")).toContain(`'${v}'`);
    }
    for (const v of CONTACT_ROLES) {
      expect(def("subcontractor_contacts_role_ck")).toContain(`'${v}'`);
    }
  });

  it("writes only the fields it was given, and leaves the rest alone", async () => {
    await store.saveCapability({
      orgId: mine.id, subcontractorId: sub, actorId: null,
      fields: { crew_size: 9, bond_single_cents: 500_000_00, bonded: true },
    });
    // A different form, a different tab, later.
    const res = await store.saveCapability({
      orgId: mine.id, subcontractorId: sub, actorId: null,
      fields: { service_area_states: ["tx", "nm"] },
    });
    expect(res.ok).toBe(true);

    const cap = await store.capabilityOf(mine.id, sub);
    // The bond figure somebody entered earlier is still there. Writing all
    // eighteen columns every save would have cleared it, silently.
    expect(cap?.bondSingleCents).toBe(500_000_00);
    expect(cap?.crewSize).toBe(9);
    expect(cap?.serviceAreaStates).toEqual(["TX", "NM"]);
  });

  it("refuses figures that contradict each other, with a sentence", async () => {
    const res = await store.saveCapability({
      orgId: mine.id, subcontractorId: sub, actorId: null,
      fields: { min_project_cents: 90_000_00, max_project_cents: 10_000_00 },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/cannot be smaller/);
  });

  it("refuses a certification nobody has heard of rather than storing the typo", async () => {
    const res = await store.saveCapability({
      orgId: mine.id, subcontractorId: sub, actorId: null,
      fields: { certifications: ["hubzone", "hubzne"] },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("hubzne");
  });

  it("cannot write capability onto another organization's record", async () => {
    const res = await store.saveCapability({
      orgId: mine.id, subcontractorId: theirSub, actorId: null,
      fields: { crew_size: 40 },
    });
    expect(res.ok).toBe(false);
    const row = await queryOne<{ crew_size: number | null }>(
      `select crew_size from subcontractors where id=$1`,
      [theirSub]
    );
    expect(row?.crew_size).toBeNull();
  });

  it("keeps unknown as null rather than defaulting a number", async () => {
    const fresh = await makeSub(mine.id, "Untouched");
    const cap = await store.capabilityOf(mine.id, fresh);
    // The single rule this whole feature turns on.
    expect(cap?.crewSize).toBeNull();
    expect(cap?.bondSingleCents).toBeNull();
    expect(cap?.bonded).toBeNull();
    expect(cap?.certifications).toBeNull();
  });

  describe("the people at the firm", () => {
    it("needs a way to reach them, or it is a name in a box", async () => {
      const res = await store.saveContact({
        orgId: mine.id, subcontractorId: sub, name: "Marcus Rivera", role: "estimator",
      });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error).toMatch(/no way to reach them/);
    });

    it("moves the primary rather than refusing the second one", async () => {
      const a = await store.saveContact({
        orgId: mine.id, subcontractorId: sub, name: "Marcus Rivera",
        role: "estimator", email: "marcus@example.test", isPrimary: true,
      });
      expect(a.ok).toBe(true);
      const b = await store.saveContact({
        orgId: mine.id, subcontractorId: sub, name: "Dana Whitfield",
        role: "owner", phone: "5125550143", isPrimary: true,
      });
      expect(b.ok).toBe(true);

      const people = await store.contactsOf(mine.id, sub);
      const primaries = people.filter((p) => p.is_primary);
      expect(primaries).toHaveLength(1);
      expect(primaries[0].name).toBe("Dana Whitfield");
    });

    it("drops verification when the address changes", async () => {
      const made = await store.saveContact({
        orgId: mine.id, subcontractorId: sub, name: "Ruth Alvarez",
        role: "office", email: "ruth@example.test",
      });
      expect(made.ok).toBe(true);
      if (!made.ok || !made.id) return;
      await query(`update subcontractor_contacts set email_verified = true where id = $1`, [made.id]);

      await store.saveContact({
        orgId: mine.id, subcontractorId: sub, contactId: made.id, name: "Ruth Alvarez",
        role: "office", email: "r.alvarez@example.test",
      });
      const row = await queryOne<{ email_verified: boolean }>(
        `select email_verified from subcontractor_contacts where id=$1`,
        [made.id]
      );
      // A new address has earned nothing, whatever the old one had.
      expect(row?.email_verified).toBe(false);
    });

    it("cannot add a person to another organization's record", async () => {
      const res = await store.saveContact({
        orgId: mine.id, subcontractorId: theirSub, name: "Intruder",
        role: "owner", email: "x@example.test",
      });
      expect(res.ok).toBe(false);
      const n = await queryOne<{ n: string }>(
        `select count(*)::text as n from subcontractor_contacts where subcontractor_id=$1`,
        [theirSub]
      );
      expect(Number(n?.n)).toBe(0);
    });
  });

  describe("licences per trade", () => {
    it("keeps one row per trade and jurisdiction, filling gaps rather than blanking them", async () => {
      await store.saveLicense({
        orgId: mine.id, subcontractorId: sub, trade: "Electrical",
        jurisdiction: "TX", number: "TECL-12345",
      });
      await store.saveLicense({
        orgId: mine.id, subcontractorId: sub, trade: "electrical",
        jurisdiction: "tx", status: "active", expiresAt: "2027-06-30",
      });
      const rows = await store.licensesOf(mine.id, sub);
      const tx = rows.filter((r) => r.trade.toLowerCase() === "electrical");
      expect(tx).toHaveLength(1);
      // The second save added the status without losing the number.
      expect(tx[0].number).toBe("TECL-12345");
      expect(tx[0].status).toBe("active");
      expect(tx[0].expires_at).toBe("2027-06-30");
    });

    it("holds a separate licence per trade, which one flat column could not", async () => {
      await store.saveLicense({
        orgId: mine.id, subcontractorId: sub, trade: "Mechanical", jurisdiction: "TX",
        status: "active",
      });
      const rows = await store.licensesOf(mine.id, sub);
      expect(rows.map((r) => r.trade.toLowerCase()).sort()).toContain("mechanical");
      expect(rows.length).toBeGreaterThanOrEqual(2);
    });

    it("cannot add a licence to another organization's record", async () => {
      const res = await store.saveLicense({
        orgId: mine.id, subcontractorId: theirSub, trade: "Electrical",
      });
      expect(res.ok).toBe(false);
    });
  });
});

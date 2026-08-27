/**
 * The versions the profile always kept and never showed.
 *
 * company_profile has carried a version number since the beginning, so every
 * past profile is on disk. Nothing read them, which meant a bad edit could
 * only be undone by remembering what was there.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { diffProfiles, describeVersion } from "../lib/domain/profile-diff";
import type { CompanyProfileJson } from "../lib/types";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

function base(over: Partial<CompanyProfileJson> = {}): CompanyProfileJson {
  return {
    legal_name: "Brost Co",
    small_business: true,
    certifications: ["SDVOSB"],
    naics_codes: ["238160"],
    primary_trades: ["Roofing"],
    service_areas: ["TX"],
    target_margin_pct: 15,
    min_margin_pct: 8,
    max_markup_pct: 30,
    scoring_rubric: { total_points: 100, dimensions: [] },
    hard_exclusions: [],
    sub_standards: { require_active_license: true, require_not_sam_excluded: true },
    pricing_rules: {} as CompanyProfileJson["pricing_rules"],
    decision_thresholds: {} as CompanyProfileJson["decision_thresholds"],
    ...over,
  };
}

d("profile history (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let history: typeof import("../lib/profile-history");
  let runWithOrg: typeof import("../lib/tenant-context").runWithOrg;

  const tag = randomUUID();
  let orgId = "";
  let otherOrgId = "";
  let userId = "";

  async function version(org: string, n: number, json: CompanyProfileJson, active: boolean) {
    return (await queryOne<{ id: string }>(
      `insert into company_profile (org_id, version, is_active, profile_json, profile_text, updated_by)
       values ($1,$2,$3,$4::jsonb,'text',$5) returning id`,
      [org, n, active, JSON.stringify(json), userId]
    ))!.id;
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    history = await import("../lib/profile-history");
    ({ runWithOrg } = await import("../lib/tenant-context"));

    const mkOrg = async (s: string) =>
      (await queryOne<{ id: string }>(
        `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
        [`hist-${s}-${tag}`]
      ))!.id;
    orgId = await mkOrg("a");
    otherOrgId = await mkOrg("b");
    userId = (await queryOne<{ id: string }>(
      `insert into users (email, name, password_hash) values ($1,'Dana Brost','x') returning id`,
      [`hist-${tag}@example.test`]
    ))!.id;

    await version(orgId, 1, base(), false);
    await version(orgId, 2, base({ service_areas: ["TX", "NM", "OK"] }), false);
    await version(orgId, 3, base({ service_areas: ["TX", "NM", "OK"], min_margin_pct: 12 }), true);
    await version(otherOrgId, 1, base({ legal_name: "Someone Else" }), true);
  });

  afterAll(async () => {
    for (const org of [orgId, otherOrgId]) {
      if (!org) continue;
      await query(`delete from company_profile where org_id = $1`, [org]).catch(() => {});
      await query(`delete from organizations where id = $1`, [org]).catch(() => {});
    }
    if (userId) await query(`delete from users where id = $1`, [userId]).catch(() => {});
  });

  it("lists every version, newest first, with who saved it", async () => {
    const rows = await runWithOrg(orgId, () => history.profileHistory());
    expect(rows.map((r) => r.version)).toEqual([3, 2, 1]);
    expect(rows[0].active).toBe(true);
    expect(rows[0].updatedBy).toBe("Dana Brost");
  });

  it("describes each version by what that save changed", async () => {
    const rows = await runWithOrg(orgId, () => history.profileHistory());
    expect(rows[0].changes.map((c) => c.field)).toContain("min_margin_pct");
    expect(rows[0].changes[0].summary).toContain("floor every bid is priced against");
    expect(rows[1].changes.map((c) => c.field)).toContain("service_areas");
  });

  it("describes the earliest version rather than diffing it against nothing", async () => {
    /*
     * Diffing version one against an empty profile would report every field
     * as a change and bury the entries that matter.
     */
    const rows = await runWithOrg(orgId, () => history.profileHistory());
    expect(rows[2].changes).toEqual([]);
    expect(rows[2].summary).toContain("first profile");
  });

  it("never shows another organization's versions", async () => {
    const rows = await runWithOrg(otherOrgId, () => history.profileHistory());
    expect(rows.length).toBe(1);
    expect(rows[0].version).toBe(1);
  });

  it("refuses to hand over another organization's version by id", async () => {
    const theirs = await queryOne<{ id: string }>(
      `select id from company_profile where org_id = $1 limit 1`,
      [otherOrgId]
    );
    const json = await runWithOrg(orgId, () => history.profileVersionJson(theirs!.id));
    expect(json).toBeNull();
  });
});

describe("diffProfiles", () => {
  it("reports a reordered list as no change", () => {
    /*
     * A profile re-saved with its codes in a different order has not changed.
     * Reporting it fills the history with edits nobody made, which is how a
     * history stops being read.
     */
    const a = base({ naics_codes: ["238160", "238220"] });
    const b = base({ naics_codes: ["238220", "238160"] });
    expect(diffProfiles(a, b)).toEqual([]);
  });

  it("puts what changes the pipeline before what changes the letterhead", () => {
    const changes = diffProfiles(
      base(),
      base({ legal_name: "Brost Holdings", naics_codes: ["238160", "561720"] })
    );
    expect(changes[0].field).toBe("naics_codes");
    expect(changes[0].material).toBe(true);
    expect(changes.find((c) => c.field === "legal_name")?.material).toBe(false);
  });

  it("agrees the verb with the count", () => {
    // "1 change that affect what gets found" is what the obvious wording
    // produces, and a figure presented in broken English is trusted less.
    const one = describeVersion(diffProfiles(base(), base({ min_margin_pct: 12 })));
    expect(one).toContain("1 change that affects");
    const two = describeVersion(
      diffProfiles(base(), base({ min_margin_pct: 12, service_areas: ["NM"] }))
    );
    expect(two).toContain("2 changes that affect");
  });

  it("summarizes a long list rather than printing it", () => {
    const many = Array.from({ length: 12 }, (_, i) => `2381${String(i).padStart(2, "0")}`);
    const changes = diffProfiles(base(), base({ naics_codes: many }));
    expect(changes[0].summary).toContain("and 8 more");
  });

  it("says nothing rather than undefined for an absent value", () => {
    const changes = diffProfiles(base({ cage_code: undefined }), base({ cage_code: "1A2B3" }));
    expect(changes[0].summary).toContain("nothing → 1A2B3");
  });
});

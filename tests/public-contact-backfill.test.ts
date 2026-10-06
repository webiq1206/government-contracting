import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
const state = vi.hoisted(() => ({ db: null as unknown as PGlite, blocked: vi.fn(), scrape: vi.fn(), find: vi.fn() }));
vi.mock("../lib/db", () => ({
  query: async (sql: string, args: unknown[]) => (await state.db.query(sql, args)).rows,
  queryOne: async (sql: string, args: unknown[]) => (await state.db.query(sql, args)).rows[0] ?? null,
}));
vi.mock("../lib/suppressions", () => ({ suppressionBlocking: state.blocked }));
vi.mock("../lib/integrations/email-scrape", () => ({ scrapeWebsiteEmail: state.scrape }));
vi.mock("../lib/integrations/website-finder", () => ({ findWebsiteBysearch: state.find }));
vi.mock("../lib/app-settings", () => ({ getWorkExecution: async () => "sub" }));
import { backfillPublicContact, publicContactCandidates } from "../lib/public-contact-backfill";
import type { Subcontractor } from "../lib/types";
const sub = { id: "sub", company_name: "Firm", email: null, blacklisted: false, website: "https://firm.test" } as Subcontractor;
beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec(`create table subcontractors(id text,org_id text,blacklisted boolean,email text,email_verified boolean,email_source text,website text,contact_checked_at timestamptz,updated_at timestamptz,archived_at timestamptz,state text);
    create table opportunities(id text,org_id text,status text,pursuit_state text,is_sources_sought boolean,work_mode text,location_state text,self_performed_trades text[]);
    create table opportunity_subs(id text,org_id text,opportunity_id text,subcontractor_id text,trade text,removed_at timestamptz,verification_json jsonb);
    create table outreach_suppressions(org_id text,subcontractor_id text,opportunity_id text,trade text,channel text,lifted_at timestamptz);`);
}, 30_000);
afterAll(async () => { await state.db?.close(); });
beforeEach(async () => {
  vi.resetAllMocks();
  state.blocked.mockResolvedValue(null);
  state.scrape.mockResolvedValue({ email: "estimates@firm.test", sourceUrl: "https://firm.test/contact", sourceType: "website", checkedAt: "2026-10-05T10:00:00.000Z", ownDomain: true });
  await state.db.exec(`truncate subcontractors,opportunities,opportunity_subs,outreach_suppressions;
    insert into subcontractors(id,org_id,blacklisted,website) values('sub','a',false,'https://firm.test');
    insert into opportunities(id,org_id,status,pursuit_state,is_sources_sought) values('opp','a','open','active',false);
    insert into opportunity_subs(org_id,opportunity_id,subcontractor_id,trade) values('a','opp','sub','cleaning');`);
});
describe("bounded public-only missing-email backfill", () => {
  it("excludes mixed self-performed scopes using normalized trade names", async () => {
    await state.db.exec("update opportunities set work_mode='mixed',self_performed_trades=array[' CLEANING ']");
    expect(await publicContactCandidates("a", "sub")).toEqual([]);
    await backfillPublicContact("a", "opp", sub, "cleaning");
    expect(state.scrape).not.toHaveBeenCalled();
    await state.db.exec("update opportunities set self_performed_trades=array['Painting']");
    expect(await publicContactCandidates("a", "sub")).toHaveLength(1);
  });
  it("filters suppressed firms before the limit so eligible firms are not starved", async () => {
    await state.db.exec(`insert into subcontractors(id,org_id,blacklisted) select 'a'||n,'a',false from generate_series(1,20) n;
      insert into opportunity_subs(org_id,opportunity_id,subcontractor_id,trade) select 'a','opp','a'||n,'cleaning' from generate_series(1,20) n;
      insert into outreach_suppressions select 'a','a'||n,null,null,'email',null from generate_series(1,20) n;`);
    expect((await publicContactCandidates("a", "sub")).map(row => row.subcontractor_id)).toEqual(["sub"]);
    expect(await publicContactCandidates("b", "sub")).toEqual([]);
  });
  it.each(["update subcontractors set archived_at=now()", "update opportunities set work_mode='self'", "update opportunities set location_state='HI'; update subcontractors set state='CA'"])("excludes ineligible candidates and queued stale work: %s", async sql => {
    await state.db.exec(sql);
    expect(await publicContactCandidates("a", "sub")).toEqual([]);
    await backfillPublicContact("a", "opp", sub, "cleaning");
    expect(state.scrape).not.toHaveBeenCalled();
  });
  it("saves provenance without verifying or queuing and prevents repeated work", async () => {
    const result = await backfillPublicContact("a", "opp", sub, "cleaning");
    expect(result.enqueued).toBeUndefined();
    const saved = (await state.db.query("select * from subcontractors")).rows[0];
    expect(saved).toMatchObject({ email: "estimates@firm.test", email_verified: false });
    const evidence = (await state.db.query("select verification_json from opportunity_subs")).rows[0].verification_json;
    expect(evidence).toMatchObject({ email_discovery: { source_url: "https://firm.test/contact", verified: false } });
    await backfillPublicContact("a", "opp", sub, "cleaning");
    expect(state.scrape).toHaveBeenCalledTimes(1);
    expect(state.find).not.toHaveBeenCalled();
  });
  it("does not research a different tenant's records", async () => {
    await backfillPublicContact("b", "opp", sub, "cleaning");
    expect(state.scrape).not.toHaveBeenCalled();
    expect((await state.db.query("select contact_checked_at from subcontractors")).rows[0].contact_checked_at).toBeNull();
  });
  it.each(["update opportunities set is_sources_sought=true", "update opportunities set pursuit_state='aborted'", "update opportunity_subs set removed_at=now()", "update subcontractors set blacklisted=true"])("rechecks current eligibility before external reads: %s", async sql => {
    await state.db.exec(sql);
    await backfillPublicContact("a", "opp", sub, "cleaning");
    expect(state.scrape).not.toHaveBeenCalled();
  });
  it("respects suppression before claiming work", async () => {
    state.blocked.mockResolvedValue({ id: "stop" });
    await backfillPublicContact("a", "opp", sub, "cleaning");
    expect(state.scrape).not.toHaveBeenCalled();
  });
  it("backs off when no address is found", async () => {
    state.scrape.mockResolvedValue(null);
    await backfillPublicContact("a", "opp", sub, "cleaning");
    await backfillPublicContact("a", "opp", sub, "cleaning");
    expect(state.scrape).toHaveBeenCalledTimes(1);
  });
  it("preserves an address saved while research was running", async () => {
    state.scrape.mockImplementation(async () => {
      await state.db.exec("update subcontractors set email='saved@firm.test',email_verified=true");
      return { email: "different@firm.test" };
    });
    await backfillPublicContact("a", "opp", sub, "cleaning");
    expect((await state.db.query("select email,email_verified from subcontractors")).rows[0])
      .toMatchObject({ email: "saved@firm.test", email_verified: true });
  });
  it("rolls the email back if its provenance cannot be saved", async () => {
    await state.db.exec("alter table opportunity_subs add constraint fixture_evidence_failure check (verification_json is null)");
    try {
      await expect(backfillPublicContact("a", "opp", sub, "cleaning")).rejects.toThrow();
      expect((await state.db.query("select email from subcontractors")).rows[0].email).toBeNull();
    } finally {
      await state.db.exec("alter table opportunity_subs drop constraint fixture_evidence_failure");
    }
  });
  it.each([
    "update opportunities set work_mode='mixed',self_performed_trades=array[' CLEANING ']",
    "update subcontractors set archived_at=now()",
    "update opportunities set work_mode='self'",
    "update opportunities set location_state='HI'; update subcontractors set state='CA'",
    "update opportunity_subs set removed_at=now()",
    "update opportunities set pursuit_state='aborted'",
    "update opportunities set is_sources_sought=true",
    "insert into outreach_suppressions values('a','sub','opp',' CLEANING ','email',null)",
  ])("respects a stop made while public research was running: %s", async sql => {
    state.scrape.mockImplementation(async () => {
      await state.db.exec(sql);
      return { email: "found@firm.test", sourceUrl: "https://firm.test/contact" };
    });
    await backfillPublicContact("a", "opp", sub, "cleaning");
    expect((await state.db.query("select email from subcontractors")).rows[0].email).toBeNull();
    expect((await state.db.query("select verification_json from opportunity_subs")).rows[0].verification_json).toBeNull();
  });
});

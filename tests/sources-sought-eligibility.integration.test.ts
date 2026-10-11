import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
const m = vi.hoisted(() => ({ db: null as any, org: "tenant-a", ai: vi.fn(), pdf: vi.fn(), upload: vi.fn(), failDraft: false,
  afterLock: null as null | ((tx: any) => Promise<unknown>) }));
vi.mock("../lib/db", () => ({
  queryOne: async (sql: string, params: unknown[]) => (await m.db.query(sql, params)).rows[0] ?? null,
  query: async (sql: string, params: unknown[]) => (await m.db.query(sql, params)).rows,
  transaction: (fn: any) => m.db.transaction((tx: any) => fn({ query: async (sql: string, params: unknown[]) => {
    if (m.failDraft && sql.includes("insert into communications")) throw new Error("synthetic draft write failure");
    const result = await tx.query(sql, params);
    if (sql.includes("for update") && m.afterLock) await m.afterLock(tx);
    return result;
  } })),
}));
vi.mock("../lib/tenant", () => ({ resolveTenantOrgId: async () => m.org }));
vi.mock("../lib/ai/companyProfile", () => ({ getProfileJson: async () => ({ legal_name: "Synthetic Company" }) }));
vi.mock("../lib/ai/claude", () => ({ completeJson: m.ai, ClaudeNotConfiguredError: class extends Error {} }));
vi.mock("../lib/ai/contentLibrary", () => ({ retrieveRelevantContent: async () => [], renderContentForPrompt: () => "" }));
vi.mock("../lib/logger", () => ({ logAgent: async () => undefined }));
vi.mock("../lib/integrations/storage", () => ({ storage: { upload: m.upload } }));
vi.mock("../lib/integrations/documents", () => ({ documents: { buildCapabilityStatementPdf: m.pdf } }));
import { sourcesSoughtResponder } from "../lib/agents/sources-sought-responder";
import { ClaudeNotConfiguredError } from "../lib/ai/claude";
import { runWithPursuitVersion } from "../lib/pursuit-job-context";
const response = { data: { email_subject: "Synthetic response", email_body: "For review only", differentiators: [], capability_summary: "Synthetic" } };
const run = () => sourcesSoughtResponder.handler({ runId: "synthetic", trigger: "queue", payload: { opportunityId: "notice" } });
async function rows(table: string) { return (await m.db.query(`select * from ${table}`)).rows; }
async function noDraft() {
  expect(await rows("documents")).toHaveLength(0);
  expect(await rows("communications")).toHaveLength(0);
  expect((await rows("opportunities"))[0].stage).not.toBe("outreach");
}
beforeAll(async () => {
  m.db = new PGlite();
  await m.db.exec(`create table opportunities(id text primary key,org_id text,title text,description text,
    is_sources_sought boolean,status text,stage text,pursuit_state text,pursuit_version integer,deadline timestamptz,human_action_required boolean);
    create table communications(id text default gen_random_uuid()::text,org_id text,opportunity_id text,channel text,direction text,subject text,body text,meta jsonb,delivery_state text);
    create table documents(org_id text,opportunity_id text,kind text,name text,storage_path text,storage_backend text,mime text);
    create table app_settings(key text primary key,value_json jsonb);`);
}, 30_000);
afterAll(async () => m.db.close());
beforeEach(async () => {
  m.org = "tenant-a"; m.failDraft = false; m.afterLock = null;
  await m.db.exec(`truncate opportunities,communications,documents,app_settings;
    insert into opportunities values('notice','tenant-a','Synthetic notice','Synthetic scope',true,'open','scoring','active',1,now()+interval '1 day',false);`);
  m.ai.mockReset().mockResolvedValue(response);
  m.pdf.mockReset().mockResolvedValue(Buffer.from("synthetic PDF fixture"));
  m.upload.mockReset().mockImplementation(async (key: string) => ({ path: key, backend: "synthetic" }));
});
describe("Sources Sought response eligibility at paid and publish boundaries", () => {
  it("holds an expired notice even before the expiry sweep changes its open state", async () => {
    await m.db.exec("update opportunities set deadline=now()-interval '1 minute'");
    expect((await run()).summary).toContain("deadline has passed");
    expect(m.ai).not.toHaveBeenCalled(); expect(m.pdf).not.toHaveBeenCalled(); expect(m.upload).not.toHaveBeenCalled();
    await noDraft();
  });
  it.each(["now()+interval '1 day'", "null"])("preserves an unsent review draft with deadline %s", async deadline => {
    await m.db.exec(`update opportunities set deadline=${deadline}`);
    expect((await run()).humanActionRequired).toBe(true);
    const [draft] = await rows("communications"); const [doc] = await rows("documents");
    expect(draft).toMatchObject({ org_id: "tenant-a", delivery_state: "draft" });
    expect(draft.meta.capability_statement_path).toBe(doc.storage_path);
    expect(doc.org_id).toBe("tenant-a");
    await run(); expect(m.ai).toHaveBeenCalledTimes(1); expect(m.upload).toHaveBeenCalledTimes(1);
  });
  it.each([
    "deadline=now()-interval '1 minute'", "status='archived'", "pursuit_state='paused'", "pursuit_version=2", "is_sources_sought=false",
  ])("discards the generated answer after %s", async change => {
    m.ai.mockImplementationOnce(async () => { await m.db.exec(`update opportunities set ${change}`); return response; });
    expect((await run()).summary).toContain("held");
    expect(m.pdf).not.toHaveBeenCalled(); expect(m.upload).not.toHaveBeenCalled(); await noDraft();
  });
  it.each(["tenant-a:automation", "platform_automation"])("reads a new %s pause despite the warm two-second cache", async key => {
    m.ai.mockImplementationOnce(async () => {
      await m.db.query("insert into app_settings values($1,'{\"paused\":true}')", [key]); return response;
    });
    expect((await run()).summary).toContain("automation is paused");
    expect(m.pdf).not.toHaveBeenCalled(); await noDraft();
  });
  it("rechecks after PDF generation before upload", async () => {
    m.pdf.mockImplementationOnce(async () => { await m.db.exec("update opportunities set status='archived'"); return Buffer.from("synthetic"); });
    expect((await run()).summary).toContain("held"); expect(m.upload).not.toHaveBeenCalled(); await noDraft();
  });
  it.each(["deadline=now()-interval '1 minute'", "status='archived'", "pursuit_version=2"])("does not publish canonical rows after upload races with %s", async change => {
    m.upload.mockImplementationOnce(async (key: string) => { await m.db.exec(`update opportunities set ${change}`); return { path: key, backend: "synthetic" }; });
    expect((await run()).summary).toContain("held"); await noDraft();
  });
  it("preserves a concurrently saved draft and never overwrites its PDF path", async () => {
    m.upload.mockImplementationOnce(async (key: string) => {
      await m.db.exec(`insert into communications(org_id,opportunity_id,channel,direction,meta,delivery_state)
        values('tenant-a','notice','email','outbound','{"kind":"sources_sought_response","capability_statement_path":"reviewed.pdf"}','draft')`);
      return { path: key, backend: "synthetic" };
    });
    expect((await run()).summary).toContain("already saved");
    expect(await rows("documents")).toHaveLength(0);
    expect((await rows("communications"))[0].meta.capability_statement_path).toBe("reviewed.pdf");
    expect(m.upload.mock.calls[0][0]).toMatch(/^capability-statements\/notice\/[^/]+\.pdf$/);
  });
  it.each([
    "update opportunities set deadline=now()-interval '1 minute'",
    "insert into app_settings values('tenant-a:automation','{\"paused\":true}')",
    "insert into app_settings values('platform_automation','{\"paused\":true}')",
  ])("rechecks eligibility after waiting for the row lock: %s", async change => {
    m.afterLock = async tx => tx.exec(change);
    expect((await run()).summary).toContain("held"); await noDraft();
  });
  it("rolls the document insert back if saving the draft fails", async () => {
    m.failDraft = true; await expect(run()).rejects.toThrow("synthetic draft write failure"); await noDraft();
  });
  it("keeps the unavailable-provider fallback from reviving an archived notice", async () => {
    m.ai.mockImplementationOnce(async () => { await m.db.exec("update opportunities set status='archived'"); throw new ClaudeNotConfiguredError(); });
    expect((await run()).summary).toContain("held"); await noDraft();
  });
  it("refuses a job from an earlier pursuit version before buying a draft", async () => {
    await m.db.exec("update opportunities set pursuit_version=2");
    expect((await runWithPursuitVersion({ opportunityId: "notice", version: 1 }, run)).summary).toContain("version");
    expect(m.ai).not.toHaveBeenCalled(); await noDraft();
  });
  it("does not read another tenant's notice", async () => {
    m.org = "tenant-b"; expect((await run()).ok).toBe(false); expect(m.ai).not.toHaveBeenCalled(); await noDraft();
  });
});

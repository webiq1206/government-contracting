import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
const state = vi.hoisted(() => ({ db: null as PGlite | null, org: "", paused: false, suppressed: false, support: false,
  before: null as null | (() => Promise<void>), outcome: "accepted", deliveries: 0 }));
vi.mock("../lib/db", () => ({ queryOne: async (sql: string, p: unknown[] = []) => (await state.db!.query(sql, p)).rows[0] ?? null }));
vi.mock("../lib/api-auth", () => ({ requireCapability: async () => ({ id: "operator" }) }));
vi.mock("../lib/tenant", () => ({ resolveTenantOrgId: async () => state.org, tryResolveTenantOrgId: async () => state.org }));
vi.mock("../lib/work-mode", () => ({ opportunityOutreachAllowed: async () => true }));
vi.mock("../lib/impersonation", () => ({ currentImpersonator: async () => state.support ? "admin" : null }));
vi.mock("../lib/app-settings", () => ({ isAutomationStopped: async () => state.paused, AUTOMATION_PAUSED_ERROR: "paused" }));
vi.mock("../lib/domain/email-suppression", () => ({ isSuppressed: async () => state.suppressed }));
vi.mock("../lib/suppressions", () => ({ suppressionBlocking: async () => null }));
vi.mock("../lib/billing/trial-limits", () => ({ checkTrialQuota: async () => ({ allowed: true }) }));
vi.mock("../lib/domain/sender-identity", () => ({ resolveOutreachSender: async () => ({ connected: true, from: "owner@example.test", replyTo: "owner@example.test" }) }));
vi.mock("../lib/integrations/gmail", () => ({ gmail: { isConnected: async () => true, send: async (p: any) => {
  await state.before?.(); await p.beforeProviderSend?.("owner@example.test"); state.deliveries++;
  return state.outcome === "accepted" ? { messageId: "receipt", threadId: "thread", outcome: "accepted" }
    : { error: state.outcome, outcome: state.outcome };
} } }));
import { POST } from "../app/api/conversations/compose/route";
import { projectMessageTarget } from "../lib/project-message";
import { refuseProjectMessage } from "../lib/project-message-refusal";
let body: { requestKey: string; subcontractorId: string; opportunityId: string; trade: string; recipient: string; sender: string; subject: string; message: string };
const request = () => new Request("http://test/api/conversations/compose", { method: "POST", body: JSON.stringify(body) });
const refuse = () => refuseProjectMessage({ orgId: state.org, actorId: "operator", ...body });
beforeAll(async () => {
  state.db = new PGlite(); await state.db.exec(`
    create table opportunities(id uuid primary key,org_id uuid,title text,stage text,status text,pursuit_state text,pursuit_reason text,pursuit_version integer);
    create table subcontractors(id uuid primary key,org_id uuid,company_name text,email text,email_verified boolean,archived_at timestamptz);
    create table opportunity_subs(id uuid default gen_random_uuid(),opportunity_id uuid,subcontractor_id uuid,trade text,removed_at timestamptz);
    create table communications(id uuid primary key default gen_random_uuid(),org_id uuid,subcontractor_id uuid,opportunity_id uuid,
      channel text,direction text,subject text,body text,recipient_email text,gmail_thread_id text,gmail_message_id text,
      rfc822_message_id text,delivery_state text,request_key uuid,request_fingerprint text,meta jsonb,
      sender_email text,provider text,delivery_detail text,provider_attempted_at timestamptz,provider_accepted_at timestamptz,
      delivery_updated_at timestamptz,created_at timestamptz default now());
    create unique index communications_request_key_unique on communications(org_id,request_key) where request_key is not null;
  `);
}, 30000);
afterAll(async () => { await state.db?.close(); });
beforeEach(async () => {
  state.org = randomUUID(); state.paused = state.suppressed = state.support = false; state.before = null;
  state.outcome = "accepted"; state.deliveries = 0;
  body = { requestKey: randomUUID(), subcontractorId: randomUUID(), opportunityId: randomUUID(), trade: "Paint",
    recipient: "sub@example.test", sender: "owner@example.test", subject: "Station painting", message: "Please provide a quote for the station painting project." };
  await state.db!.query("insert into opportunities values($1,$2,'Station','outreach','open','active',null,1)", [body.opportunityId,state.org]);
  await state.db!.query("insert into subcontractors values($1,$2,'Acme',$3,true,null)", [body.subcontractorId,state.org,body.recipient]);
  await state.db!.query("insert into opportunity_subs(opportunity_id,subcontractor_id,trade) values($1,$2,'Paint')", [body.opportunityId,body.subcontractorId]);
});
it("real route, relationship query, durable claim and guarded transport send only once", async () => {
  const results = await Promise.all([POST(request()), POST(request())]);
  expect(results.some(r => r.status === 200)).toBe(true); expect(state.deliveries).toBe(1);
  expect((await POST(request())).status).toBe(200); expect(state.deliveries).toBe(1);
  const row = (await state.db!.query<any>("select * from communications where org_id=$1", [state.org])).rows[0];
  expect(row).toMatchObject({ sender_email: body.sender, recipient_email: body.recipient, delivery_state: "sent", gmail_message_id: "receipt" });
});
it.each(["paused", "suppressed", "support"] as const)("preserves %s safety through the actual transport", async flag => {
  state[flag] = true; expect((await POST(request())).status).not.toBe(200); expect(state.deliveries).toBe(0);
});
it("rejects archived and foreign contacts using the real tenant relationship lookup", async () => {
  expect(await projectMessageTarget(randomUUID(), body.subcontractorId, body.opportunityId, "Paint")).toBeNull();
  await state.db!.query("update subcontractors set archived_at=now() where id=$1", [body.subcontractorId]);
  expect((await POST(request())).status).toBe(404); expect(state.deliveries).toBe(0);
});
it.each(["archive", "email", "remove", "version"])("revalidates %s change at handoff before recording a provider attempt", async change => {
  state.before = async () => {
    if (change === "archive") await state.db!.query("update subcontractors set archived_at=now() where id=$1", [body.subcontractorId]);
    if (change === "email") await state.db!.query("update subcontractors set email='changed@example.test' where id=$1", [body.subcontractorId]);
    if (change === "remove") await state.db!.query("update opportunity_subs set removed_at=now() where opportunity_id=$1", [body.opportunityId]);
    if (change === "version") await state.db!.query("update opportunities set pursuit_version=2 where id=$1", [body.opportunityId]);
  };
  expect((await POST(request())).status).not.toBe(200); expect(state.deliveries).toBe(0);
  const row = (await state.db!.query<any>("select delivery_state,provider_attempted_at from communications where org_id=$1", [state.org])).rows[0];
  expect(row).toEqual({ delivery_state: "held", provider_attempted_at: null });
});
it.each(["unknown", "refused"])("retains %s evidence and will not replay the request", async outcome => {
  state.outcome = outcome;
  const response = await POST(request()); expect((await response.json()).safeToCompose).toBe(outcome === "refused");
  await POST(request()); expect(state.deliveries).toBe(1);
  const row = (await state.db!.query<any>("select delivery_state from communications where org_id=$1", [state.org])).rows[0];
  expect(row.delivery_state).toBe(outcome === "refused" ? "failed" : "unknown");
});
it.each(["accepted", "unknown"])("does not deny an earlier %s send after assignment removal and same-key retry", async outcome => {
  state.outcome = outcome;
  await POST(request()); // The caller may lose this response after the provider attempt.
  const evidence = async () => (await state.db!.query<any>(
    "select request_key,delivery_state,gmail_message_id,provider_attempted_at,provider_accepted_at from communications where org_id=$1",
    [state.org],
  )).rows;
  const before = await evidence();
  expect(before).toHaveLength(1);
  expect(before[0]).toMatchObject({ request_key: body.requestKey,
    delivery_state: outcome === "accepted" ? "sent" : "unknown",
    gmail_message_id: outcome === "accepted" ? "receipt" : null });
  await state.db!.query("update opportunity_subs set removed_at=now() where opportunity_id=$1", [body.opportunityId]);
  const response = await POST(request());
  expect(response.status).toBe(404);
  const result = await response.json();
  expect(result.error).toContain("No new send attempt was made.");
  expect(result.error).toContain("An earlier attempt may have been sent; check communication history");
  expect(result.error).not.toContain("Nothing was sent");
  expect(result.safeToCompose).not.toBe(true);
  expect(state.deliveries).toBe(1);
  expect(await evidence()).toEqual(before);
});
it("fences a denied request before allowing a replacement even if the original arrives later", async () => {
  const originalRecipient = body.recipient;
  body.recipient = "stale@example.test";
  expect((await (await POST(request())).json()).safeToCompose).toBe(true);
  body.recipient = originalRecipient;
  await POST(request()); // Delayed original cannot acquire the already-fenced key.
  expect(state.deliveries).toBe(0);
  body.requestKey = randomUUID(); // Only an explicit replacement can send.
  expect((await POST(request())).status).toBe(200); expect(state.deliveries).toBe(1);
});
it("does not release a request if its original claim wins the race with preflight refusal", async () => {
  let entered!: () => void, release!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const releasePromise = new Promise<void>(resolve => { release = resolve; });
  state.before = async () => { entered(); await releasePromise; };
  const sending = POST(request()); await enteredPromise;
  expect(await refuse()).toBe(false);
  release(); expect((await sending).status).toBe(200);
  expect(await refuse()).toBe(false); expect(state.deliveries).toBe(1);
});
it("does not fence a foreign project or subcontractor", async () => {
  const ownOrg = state.org; state.org = randomUUID();
  expect(await refuse()).toBe(false);
  expect((await state.db!.query("select id from communications where org_id=$1", [state.org])).rows).toHaveLength(0);
  state.org = ownOrg; expect(state.deliveries).toBe(0);
});
it("recovers reset eligibility after a lost refusal response and restored recipient settings", async () => {
  await state.db!.query("update subcontractors set email='changed@example.test' where id=$1", [body.subcontractorId]);
  await POST(request()); // Refusal response is lost; caller retains only its original intent.
  await state.db!.query("update subcontractors set email=$2 where id=$1", [body.subcontractorId, body.recipient]);
  const retry = await POST(request());
  expect(retry.status).toBe(409);
  expect(await retry.json()).toMatchObject({ safeToCompose: true, error: expect.stringContaining("held before sending") });
  expect(state.deliveries).toBe(0);
});
it.each(["held", "refused", "accepted", "unknown"])("reconciles a null-trade %s claim after a lost response and changed recipient", async outcome => {
  body.trade = "";
  await state.db!.query("update opportunity_subs set trade=null where opportunity_id=$1", [body.opportunityId]);
  state.paused = outcome === "held"; state.outcome = outcome === "held" ? "accepted" : outcome;
  await POST(request()); // Caller loses the original response.
  const rows = async () => (await state.db!.query<any>("select request_key,delivery_state,meta,provider_attempted_at,gmail_message_id from communications where org_id=$1", [state.org])).rows;
  const before = await rows(); expect(before).toHaveLength(1); expect(before[0].meta.trade).toBeNull();
  const attempts = state.deliveries;
  state.paused = false;
  await state.db!.query("update subcontractors set email='changed@example.test' where id=$1", [body.subcontractorId]);
  const response = await POST(request()); expect(response.status).toBe(409);
  expect((await response.json()).safeToCompose).toBe(outcome === "held" || outcome === "refused");
  expect(await rows()).toEqual(before); expect(state.deliveries).toBe(attempts);
});

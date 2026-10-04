/**
 * Outreach must not email a subcontractor twice for the same work.
 *
 * pg-boss delivers at-least-once: a job that sent the email but crashed before
 * acking is redelivered, and a duplicate enqueue can slip past the singleton
 * window. Either way a real subcontractor would receive the same quote request
 * twice. This drives the REAL outreach agent (only the external I/O — the mail
 * transport, the profile, the template, the attachment gather, and the brief —
 * is mocked) against a real database and asserts:
 *   - the first run sends exactly once and records the communication
 *   - a redelivery sends NOTHING and records no duplicate
 *   - a pairing whose prior send FAILED (no provider) is still sent on re-run,
 *     so the recovery sweep keeps working
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

const sendSpy = vi.fn();

vi.mock("../lib/integrations/email-transport", () => ({
  sendOutreachEmail: (...args: unknown[]) => sendSpy(...args),
  OUTREACH_SENDER: "BROSTCO <info@brostco.com>",
  OUTREACH_EMAIL: "info@brostco.com",
}));
vi.mock("../lib/ai/companyProfile", () => ({
  getProfileJson: async () => ({
    legal_name: "Prime LLC",
    owner_name: "Pat Prime",
    phone: "555-1000",
    outreach_display_name: "Pat",
    entity_state: "CA",
  }),
}));
vi.mock("../lib/opportunity-attachments", () => ({
  gatherTradeAttachments: async () => ({ files: [], links: [], expected: false, omitted: [] }),
}));
/*
 * The real module underneath, with only the settings this test means to pin.
 *
 * A factory that lists exports replaces the whole module, so the first agent
 * to read a new setting gets undefined and the failure surfaces as a wrong
 * assertion three files away rather than as a missing mock. Spreading the
 * original keeps the pinning explicit and lets everything else be real.
 */
vi.mock("../lib/app-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/app-settings")>()),
  areCallsEnabled: async () => false,
  isAutomationPaused: async () => false,
  isAutomationStopped: async () => false,
  isPlatformAutomationPaused: async () => false,
  AUTOMATION_PAUSED_ERROR: "paused",
}));
vi.mock("../lib/domain/template-store", () => ({
  activeTemplate: async () => ({
    subject: "Quote request",
    // Uses the real variables, so a rename that breaks the send is caught here
    // rather than in production.
    body: "Hi {{owner_name}}, please quote by {{quote_due_date}}.",
  }),
}));
vi.mock("../lib/domain/advance-stage", () => ({ advancePastCallStep: vi.fn(async () => true) }));

d("outreach idempotency (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let outreach: typeof import("../lib/agents/outreach").outreach;
  const org = { id: "" }; const opp = { id: "" }; const sub = { id: "" };
  const trade = "electrical";

  const run = () => outreach.handler({ runId: randomUUID(), trigger: "queue", payload: { opportunityId: opp.id, subcontractorId: sub.id, trade } });
  const commCount = async () =>
    (await queryOne<{ n: number }>(
      `select count(*)::int as n from communications where opportunity_id=$1 and subcontractor_id=$2 and direction='outbound' and provider is not null`,
      [opp.id, sub.id]
    ))?.n ?? 0;

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ outreach } = await import("../lib/agents/outreach"));
    const o = await queryOne<{ id: string }>(`insert into organizations (name, subscription_status) values ($1,'active') returning id`, [`out-${randomUUID()}`]);
    org.id = o!.id;
    const op = await queryOne<{ id: string }>(
      `insert into opportunities
         (org_id, source, title, stage, status, location_state, location_text,
          agency, solicitation_number, deadline, solicitation_analysis)
       values ($1,'test','Panel replacement, Building 12','sub_research','open',
               'CA','Sacramento, CA','General Services Administration',
               'GS-26-R-0099', now() + interval '20 days', $2::jsonb)
       returning id`,
      [
        org.id,
        JSON.stringify({
          trade_scopes: [
            { trade: "electrical", work: "Remove and replace 10 distribution panels in Building 12." },
          ],
          location: "Sacramento, CA",
        }),
      ]);
    opp.id = op!.id;
    const s = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories, state, email, email_verified, owner_name)
       values ($1,'Elec Co',$2,'CA','elec@x.invalid',true,'Chris') returning id`, [org.id, [trade]]);
    sub.id = s!.id;
    await query(`insert into opportunity_subs (opportunity_id, subcontractor_id, trade, outreach_state, verified) values ($1,$2,$3,'pending',true)`, [opp.id, sub.id, trade]);
  });

  afterEach(() => sendSpy.mockReset());

  afterAll(async () => {
    if (!org.id) return;
    await query(`delete from communications where opportunity_id=$1`, [opp.id]).catch(() => {});
    await query(`delete from opportunity_subs where opportunity_id=$1`, [opp.id]);
    await query(`delete from agent_logs where org_id=$1`, [org.id]).catch(() => {});
    await query(`delete from subcontractors where org_id=$1`, [org.id]);
    await query(`delete from opportunities where org_id=$1`, [org.id]);
    await query(`delete from organizations where id=$1`, [org.id]);
    vi.restoreAllMocks();
  });

  it("first run sends exactly once and records the communication", async () => {
    sendSpy.mockResolvedValue({ provider: "gmail", messageId: "m1", threadId: "t1" });
    const res = await run();
    expect(res.ok).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(await commCount()).toBe(1);
  });

  it("a redelivery of the same job sends nothing and records no duplicate", async () => {
    sendSpy.mockResolvedValue({ provider: "gmail", messageId: "m2", threadId: "t2" });
    const res = await run();
    expect(res.ok).toBe(true);
    expect(sendSpy).not.toHaveBeenCalled(); // guard skipped the send
    expect(await commCount()).toBe(1); // still one genuine send
  });

  it("finishes workflow updates after a crash following the accepted receipt, with one send", async () => {
    await query(`delete from communications where org_id=$1`,[org.id]);
    await query(`update opportunity_subs set outreach_state='pending',quote_due_at=null where opportunity_id=$1`,[opp.id]);
    await query(`update opportunities set stage='sub_research' where id=$1`,[opp.id]);
    await query(`update subcontractors set last_contacted=null where id=$1`,[sub.id]);
    sendSpy.mockImplementationOnce(async (params) => {
      await query(`insert into communications(org_id,opportunity_id,subcontractor_id,channel,direction,subject,body,
        provider,gmail_message_id,delivery_state,provider_accepted_at,meta)
        values($1,$2,$3,'email','outbound',$4,$5,'gmail','accepted-before-crash','sent',now(),$6::jsonb)`,
        [org.id,opp.id,sub.id,params.subject,params.text,JSON.stringify(params.scheduled.meta)]);
      throw new Error("process stopped after accepted receipt");
    });
    await expect(run()).rejects.toThrow("process stopped after accepted receipt");
    expect((await queryOne<{outreach_state:string}>(`select outreach_state from opportunity_subs where opportunity_id=$1`,[opp.id]))?.outreach_state).toBe("pending");
    expect((await run()).data).toMatchObject({sent:false,replayed:true,messageId:"accepted-before-crash"});
    expect(sendSpy).toHaveBeenCalledTimes(1);expect(await commCount()).toBe(1);
    expect((await queryOne<{outreach_state:string;quote_due_at:string}>(`select outreach_state,quote_due_at from opportunity_subs where opportunity_id=$1`,[opp.id]))).toMatchObject({outreach_state:"sent",quote_due_at:expect.anything()});
    const accepted=(await queryOne<{last_contacted:string}>(`select last_contacted from subcontractors where id=$1`,[sub.id]))?.last_contacted;
    expect(accepted).toBeTruthy();
    // Later progress must not be moved backward by another receipt recovery.
    await query(`update opportunity_subs set outreach_state='replied' where opportunity_id=$1`,[opp.id]);
    await query(`update opportunities set stage='quote_entry' where id=$1`,[opp.id]);
    await run();
    expect((await queryOne<{stage:string}>(`select stage from opportunities where id=$1`,[opp.id]))?.stage).toBe("quote_entry");
    expect((await queryOne<{outreach_state:string}>(`select outreach_state from opportunity_subs where opportunity_id=$1`,[opp.id]))?.outreach_state).toBe("replied");
    expect((await queryOne<{last_contacted:string}>(`select last_contacted from subcontractors where id=$1`,[sub.id]))?.last_contacted).toEqual(accepted);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("a pairing whose prior send FAILED is still sent on re-run (recovery works)", async () => {
    // Simulate a failed prior send: a comm row exists but with null provider.
    const o2 = await queryOne<{ id: string }>(`insert into organizations (name, subscription_status) values ($1,'active') returning id`, [`out2-${randomUUID()}`]);
    const op2 = await queryOne<{ id: string }>(
      `insert into opportunities
         (org_id, source, title, stage, status, location_state, location_text,
          agency, solicitation_number, deadline, solicitation_analysis)
       values ($1,'test','Recover job','outreach','open','CA','Sacramento, CA',
               'General Services Administration','GS-26-R-0100',
               now() + interval '20 days', $2::jsonb)
       returning id`,
      [
        o2!.id,
        JSON.stringify({
          trade_scopes: [
            { trade: "electrical", work: "Replace 6 distribution panels in Building 4." },
          ],
          location: "Sacramento, CA",
        }),
      ]);
    const s2 = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories, state, email, email_verified, owner_name)
       values ($1,'Elec Two',$2,'CA','elec2@x.invalid',true,'Sam') returning id`, [o2!.id, [trade]]);
    await query(`insert into opportunity_subs (opportunity_id, subcontractor_id, trade, outreach_state, verified) values ($1,$2,$3,'send_failed',true)`, [op2!.id, s2!.id, trade]);
    // The failed send left a communications row with provider = null.
    await query(
      `insert into communications (org_id, subcontractor_id, opportunity_id, channel, direction, subject, body, provider, meta)
       values ($1,$2,$3,'email','outbound','Quote request','...',NULL,$4::jsonb)`,
      [o2!.id, s2!.id, op2!.id, JSON.stringify({ trade })]
    );

    sendSpy.mockResolvedValue({ provider: "gmail", messageId: "m3", threadId: "t3" });
    const res = await outreach.handler({ runId: randomUUID(), trigger: "queue", payload: { opportunityId: op2!.id, subcontractorId: s2!.id, trade } });
    expect(res.ok).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1); // the recovery re-send DID fire

    await query(`delete from communications where org_id=$1`, [o2!.id]);
    await query(`delete from opportunity_subs where opportunity_id=$1`, [op2!.id]);
    await query(`delete from agent_logs where org_id=$1`, [o2!.id]).catch(() => {});
    await query(`delete from subcontractors where org_id=$1`, [o2!.id]);
    await query(`delete from opportunities where org_id=$1`, [o2!.id]);
    await query(`delete from organizations where id=$1`, [o2!.id]);
  });
});

/**
 * What a subcontractor actually receives.
 *
 * The idempotency test proves an email is sent once. This proves the email is
 * worth sending: it drives the real outreach agent against a real database and
 * reads the assembled body, because every failure this guards against produces
 * an email that reads perfectly well.
 *
 * The one that matters most: the government's bid deadline must never be the
 * date the subcontractor is asked to reply by. That mistake is invisible in
 * review, and its cost is a quote that arrives with no time left to use it.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

const sendSpy = vi.fn(async () => ({
  messageId: "gmail-1",
  threadId: "thread-1",
  rfc822MessageId: "<abc@mail.gmail.com>",
  provider: "gmail",
}));

vi.mock("../lib/integrations/email-transport", () => ({
  sendOutreachEmail: (...args: unknown[]) => sendSpy(...(args as [])),
  OUTREACH_SENDER: "BROSTCO <info@brostco.com>",
  OUTREACH_EMAIL: "info@brostco.com",
}));
vi.mock("../lib/ai/companyProfile", () => ({
  getProfileJson: async () => ({
    legal_name: "Prime LLC",
    owner_name: "Pat Prime",
    phone: "555-1000",
    outreach_display_name: "Pat",
    outreach_email: "pat@prime.invalid",
    entity_state: "CO",
  }),
}));
vi.mock("../lib/opportunity-attachments", () => ({
  gatherTradeAttachments: async () => ({
    // Real PDF magic bytes: the package assessment checks that a file
    // contains what its type claims, and "x" is not a PDF.
    files: [
      {
        filename: "Statement of Work.pdf",
        mime: "application/pdf",
        content: Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n"),
      },
    ],
    links: [],
    expected: true,
    undelivered: [],
    omitted: [],
  }),
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
vi.mock("../lib/domain/advance-stage", () => ({ advancePastCallStep: vi.fn(async () => true) }));

d("the assembled outreach email (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let outreach: typeof import("../lib/agents/outreach").outreach;
  const org = { id: "" };
  const opp = { id: "" };
  const sub = { id: "" };
  const trade = "HVAC";
  let body = "";
  let subject = "";

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ outreach } = await import("../lib/agents/outreach"));

    // The real default template, so this exercises what ships.
    vi.doMock("../lib/domain/template-store", () => ({
      activeTemplate: async () => ({
        subject: "Pricing request: {{trade}} | {{location_city_state}}",
        body:
          "Hi {{owner_name}},\n\n" +
          "I'm {{sender_name}} with {{company_name}}. We're preparing a bid for " +
          "{{trade}} work in {{location_city_state}} and would like your pricing.\n\n" +
          "Reply by {{quote_due_date}} with your price, availability, payment terms, " +
          "and exclusions.\n\nThanks,\n{{sender_name}}\n{{company_name}}\n{{phone}}",
      }),
    }));

    const o = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
      [`content-${randomUUID()}`]
    );
    org.id = o!.id;

    const op = await queryOne<{ id: string }>(
      `insert into opportunities
         (org_id, source, title, stage, status, location_state, location_text,
          agency, solicitation_number, deadline, solicitation_analysis)
       values ($1,'test','Rooftop Unit Replacement, Buildings 3 and 4','sub_research','open',
               'VA','Richmond, VA 23219','US Army Corps of Engineers',
               'W912DR-26-R-0042', now() + interval '30 days', $2::jsonb)
       returning id`,
      [
        org.id,
        JSON.stringify({
          location: "Richmond, VA",
          trade_scopes: [
            {
              trade: "HVAC",
              work:
                "Remove 12 existing rooftop units in Buildings 3 and 4.\n" +
                "Furnish and install 12 replacement units, 5 tons each.\n" +
                "Test and balance all air distribution before closeout.",
            },
            { trade: "Electrical", work: "Pull new feeders to the roof curbs." },
          ],
          qualifications: { licenses: ["State mechanical contractor licence"] },
          site_visit: { required: true, details: "in 10 days, 9:00 AM, Building 3 lobby" },
          special_requirements: ["Davis-Bacon prevailing wage rates apply to all trades."],
          questions_for_subs: ["Can your crew work the 7:00 AM to 3:30 PM window?"],
          period_of_performance: "180 calendar days from notice to proceed",
          offer_acceptance_period: "60 days",
        }),
      ]
    );
    opp.id = op!.id;

    const s = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories, state, email, email_verified, owner_name)
       values ($1,'Rivera Mechanical',$2,'VA','marcus@rivera.invalid',true,'Marcus Rivera') returning id`,
      [org.id, [trade]]
    );
    sub.id = s!.id;
    await query(
      `insert into opportunity_subs (opportunity_id, subcontractor_id, trade, outreach_state, verified)
       values ($1,$2,$3,'pending',true)`,
      [opp.id, sub.id, trade]
    );

    const res = await outreach.handler({
      runId: randomUUID(),
      trigger: "queue",
      payload: { opportunityId: opp.id, subcontractorId: sub.id, trade },
    });
    expect(res.ok).toBe(true);

    const stored = await queryOne<{ subject: string; body: string }>(
      `select subject, body from communications
        where opportunity_id=$1 and subcontractor_id=$2 and direction='outbound'`,
      [opp.id, sub.id]
    );
    subject = stored?.subject ?? "";
    body = stored?.body ?? "";
  });

  afterAll(async () => {
    if (!org.id) return;
    await query(`delete from communications where opportunity_id=$1`, [opp.id]).catch(() => {});
    await query(`delete from opportunity_subs where opportunity_id=$1`, [opp.id]).catch(() => {});
    await query(`delete from agent_logs where org_id=$1`, [org.id]).catch(() => {});
    await query(`delete from subcontractors where org_id=$1`, [org.id]);
    await query(`delete from opportunities where org_id=$1`, [org.id]);
    await query(`delete from organizations where id=$1`, [org.id]);
    vi.restoreAllMocks();
  });

  it("sends, and stores what it sent", () => {
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(body.length).toBeGreaterThan(200);
  });

  it("greets the person, not the company", () => {
    expect(body).toMatch(/^Hi Marcus,/);
  });

  it("says where the work is, in a way a crew can be priced to", () => {
    expect(subject).toContain("Richmond, Virginia");
    expect(body).toContain("Richmond, Virginia");
  });

  it("asks for the quote by a date that is not our bid deadline", async () => {
    /*
     * The whole point. Both dates appear in the email, each labelled, and the
     * one the subcontractor is asked to act on is the earlier of the two.
     */
    const deadline = await queryOne<{ deadline: string }>(
      `select deadline::text as deadline from opportunities where id=$1`,
      [opp.id]
    );
    const comm = await queryOne<{ quote_due_at: string }>(
      `select meta->>'quote_due_at' as quote_due_at from communications
        where opportunity_id=$1 and direction='outbound'`,
      [opp.id]
    );
    expect(comm?.quote_due_at).toBeTruthy();
    expect(new Date(comm!.quote_due_at).getTime()).toBeLessThan(
      new Date(deadline!.deadline).getTime()
    );
    expect(body).toMatch(/Your quote is due:/);
    expect(body).toMatch(/Our bid to the agency is due:/);
  });

  it("names the timezone, because 3:00 PM in two states is two times", () => {
    expect(body).toMatch(/\b(MDT|MST)\b/);
  });

  it("describes this trade's work and not the electrician's", () => {
    expect(body).toMatch(/rooftop units/i);
    expect(body).not.toMatch(/feeders/i);
  });

  it("carries the requirements that change what a quote should say", () => {
    expect(body).toMatch(/mechanical contractor licence/i);
    expect(body).toMatch(/Site visit/i);
    expect(body).toMatch(/Davis-Bacon/i);
    expect(body).toMatch(/valid for 60 days/i);
  });

  it("asks the questions the analyst wrote", () => {
    expect(body).toMatch(/7:00 AM to 3:30 PM/);
  });

  it("says what to send back", () => {
    expect(body).toMatch(/What to include with your quote/i);
    expect(body).toMatch(/firm or an estimate/i);
  });

  it("tells them to review the attached document instead of inventorying it", () => {
    expect(body).toMatch(/attached document has the details you need/i);
    expect(body).toMatch(/review it before preparing your quote/i);
    expect(body).not.toMatch(/Statement of Work\.pdf \(attached\)/);
  });

  it("contains no unresolved token and no leaked placeholder", () => {
    expect(body).not.toMatch(/\{\{/);
    expect(body).not.toMatch(/\b(null|undefined|NaN)\b/);
  });

  it("records the identifiers a follow-up needs to stay in this thread", async () => {
    const row = await queryOne<{
      gmail_thread_id: string;
      rfc822_message_id: string;
      recipient_email: string;
      sender_email: string;
      attachments: string;
    }>(
      `select gmail_thread_id, rfc822_message_id, recipient_email,
              meta->>'sender_email' as sender_email,
              meta->>'attachments' as attachments
         from communications where opportunity_id=$1 and direction='outbound'`,
      [opp.id]
    );
    expect(row?.gmail_thread_id).toBe("thread-1");
    expect(row?.rfc822_message_id).toBe("<abc@mail.gmail.com>");
    expect(row?.recipient_email).toBe("marcus@rivera.invalid");
    expect(row?.sender_email).toBe("pat@prime.invalid");
    // The manifest, so a fallback into a new thread sends the same package.
    expect(row?.attachments).toContain("Statement of Work.pdf");
  });
});

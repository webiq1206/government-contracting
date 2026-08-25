/**
 * Where the 48-hour follow-up lands, and what it says when it lands badly.
 *
 * Threading needs both halves. `threadId` groups a message in OUR mailbox,
 * which is what the in-app conversation view reads; `In-Reply-To` is what the
 * RECIPIENT's client threads on. Having only the first is the trap this test
 * exists for: our conversation view looks perfect while the subcontractor
 * receives an unconnected email every time, so the bug is invisible from the
 * side that would report it.
 *
 * The rule: reply inside the thread when both halves are present, and when
 * they are not, send a COMPLETE email rather than a short chaser referring to
 * "the original message below" when there is no message below.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

const sendSpy = vi.fn(async () => ({
  messageId: "gmail-follow",
  threadId: "thread-1",
  rfc822MessageId: "<follow@mail.gmail.com>",
  provider: "gmail",
}));

vi.mock("../lib/integrations/email-transport", () => ({
  sendOutreachEmail: (...a: unknown[]) => sendSpy(...(a as [])),
  OUTREACH_SENDER: "BROSTCO <info@brostco.com>",
  OUTREACH_EMAIL: "info@brostco.com",
}));
vi.mock("../lib/ai/companyProfile", () => ({
  getProfileJson: async () => ({
    legal_name: "Prime LLC",
    outreach_display_name: "Pat",
    phone: "555-1000",
    entity_state: "CO",
  }),
}));
vi.mock("../lib/opportunity-attachments", () => ({
  gatherTradeAttachments: async () => ({
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
  }),
}));

// Gmail cannot recover a Message-ID in these tests; each case sets up the
// stored identifiers it wants explicitly.
vi.mock("../lib/integrations/gmail", () => ({
  gmail: {
    threadMessageId: async () => ({ rfc822MessageId: null, references: [] as string[] }),
  },
}));

d("the 48-hour follow-up (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let runFollowUp: () => Promise<unknown>;
  const org = { id: "" };
  const opp = { id: "" };
  const sub = { id: "" };
  const trade = "HVAC";

  /** Seed an original outbound email with whatever threading identifiers. */
  async function seedOriginal(opts: {
    threadId: string | null;
    rfc822: string | null;
    subject?: string;
  }) {
    await query(`delete from communications where opportunity_id=$1`, [opp.id]);
    await query(
      `insert into communications
         (org_id, subcontractor_id, opportunity_id, channel, direction, subject, body,
          gmail_thread_id, rfc822_message_id, provider, follow_up_at, recipient_email, meta)
       values ($1,$2,$3,'email','outbound',$4,'original body',$5,$6,'gmail',
               now() - interval '1 minute','marcus@rivera.invalid',$7::jsonb)`,
      [
        org.id,
        sub.id,
        opp.id,
        opts.subject ?? "Pricing request: HVAC | Richmond, Virginia",
        opts.threadId,
        opts.rfc822,
        JSON.stringify({
          trade,
          quote_due_label: "August 22, 2026 at 3:00 PM MDT",
          quote_due_at: "2026-08-22T21:00:00Z",
        }),
      ]
    );
    await query(
      `update opportunity_subs set outreach_state='contacted'
        where opportunity_id=$1 and subcontractor_id=$2`,
      [opp.id, sub.id]
    );
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    const mod = await import("../lib/agents/maintenance");
    const agent = (mod as Record<string, { handler: (c: unknown) => Promise<unknown> }>)
      .outreachFollowup;
    runFollowUp = () =>
      agent.handler({ runId: randomUUID(), trigger: "cron", payload: {} });

    const o = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
      [`follow-${randomUUID()}`]
    );
    org.id = o!.id;
    const op = await queryOne<{ id: string }>(
      `insert into opportunities
         (org_id, source, title, stage, status, location_state, location_text,
          agency, solicitation_number, deadline, solicitation_analysis)
       values ($1,'test','Rooftop Unit Replacement','outreach','open','VA','Richmond, VA',
               'US Army Corps of Engineers','W912DR-26-R-0042',
               now() + interval '30 days', $2::jsonb) returning id`,
      [
        org.id,
        JSON.stringify({
          location: "Richmond, VA",
          trade_scopes: [
            { trade: "HVAC", work: "Remove and replace 12 rooftop units in Buildings 3 and 4." },
          ],
          qualifications: { licenses: ["State mechanical contractor license"] },
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
       values ($1,$2,$3,'contacted',true)`,
      [opp.id, sub.id, trade]
    );
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

  describe("when the thread can be joined", () => {
    let call: Record<string, unknown>;
    beforeAll(async () => {
      await seedOriginal({ threadId: "thread-1", rfc822: "<orig@mail.gmail.com>" });
      sendSpy.mockClear();
      await runFollowUp();
      call = sendSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    });

    it("replies inside the original conversation", () => {
      expect(call.threadId).toBe("thread-1");
      expect(call.inReplyTo).toBe("<orig@mail.gmail.com>");
    });

    it("inherits the original subject, because Gmail requires it to match", () => {
      expect(call.subject).toBe("Re: Pricing request: HVAC | Richmond, Virginia");
    });

    it("does not repeat the scope or re-attach the documents", () => {
      /*
       * They are already in the conversation, directly above this message.
       * Repeating them makes a short nudge into a wall of text.
       */
      expect(call.html as string).not.toMatch(/rooftop units/i);
      expect((call.attachments as unknown[]) ?? []).toHaveLength(0);
    });

    it("repeats the quote date the recipient was already given", () => {
      // Recomputing it 48 hours later would quietly move the deadline.
      expect(call.html as string).toContain("August 22, 2026 at 3:00 PM MDT");
    });
  });

  describe("when the Message-ID is missing", () => {
    let call: Record<string, unknown>;
    beforeAll(async () => {
      // The exact production case: a thread we know, but a grant that predates
      // gmail.readonly, so the Message-ID was never read back.
      await seedOriginal({ threadId: "thread-1", rfc822: null });
      sendSpy.mockClear();
      await runFollowUp();
      call = sendSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    });

    it("does not pretend to reply", () => {
      /*
       * Passing a threadId with no In-Reply-To groups the message in our
       * mailbox and nowhere else. That is the whole bug: it looks right here
       * and arrives unconnected there.
       */
      expect(call.threadId).toBeUndefined();
      expect(call.inReplyTo).toBeUndefined();
    });

    it("sends a complete, self-contained email instead", () => {
      expect(call.subject as string).toMatch(/Follow-up/i);
      expect(call.html as string).toMatch(/rooftop units/i);
      expect(call.html as string).toMatch(/mechanical contractor license/i);
      expect(call.html as string).toMatch(/What to include with your quote/i);
      expect((call.attachments as unknown[]) ?? []).toHaveLength(1);
    });

    it("records why the thread could not be used", async () => {
      const log = await queryOne<{ message: string }>(
        `select message from agent_logs
          where org_id=$1 and action='new-thread' order by created_at desc limit 1`,
        [org.id]
      );
      expect(log?.message).toMatch(/Message-ID could not be recovered/i);
    });

    it("marks the stored message as unthreaded, so the record explains itself", async () => {
      const row = await queryOne<{ threaded: string }>(
        `select meta->>'threaded' as threaded from communications
          where opportunity_id=$1 and meta->>'kind'='followup'
          order by created_at desc limit 1`,
        [opp.id]
      );
      expect(row?.threaded).toBe("false");
    });
  });

  describe("when there is no thread at all", () => {
    let call: Record<string, unknown>;
    beforeAll(async () => {
      await seedOriginal({ threadId: null, rfc822: null });
      sendSpy.mockClear();
      await runFollowUp();
      call = sendSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    });

    it("sends the complete fallback and says why", async () => {
      expect(call.html as string).toMatch(/rooftop units/i);
      expect((call.attachments as unknown[]) ?? []).toHaveLength(1);
      const log = await queryOne<{ message: string }>(
        `select message from agent_logs
          where org_id=$1 and action='new-thread' order by created_at desc limit 1`,
        [org.id]
      );
      expect(log?.message).toMatch(/no Gmail thread was recorded/i);
    });
  });
});

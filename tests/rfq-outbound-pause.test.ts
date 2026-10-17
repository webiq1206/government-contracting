/**
 * Pausing outbound quote requests stops the chase, not only the first email.
 *
 * followUpForOrg and the deadline nudge both mail a subcontractor who was
 * already asked for a price. The pause switch has to stop those too, and it
 * has to leave the due timestamps alone so turning outreach back on resumes
 * the same queue.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendOutreachEmail = vi.hoisted(() => vi.fn(async () => ({
  messageId: "gmail-msg-1",
  threadId: "gmail-thread-1",
  rfc822MessageId: "<followup@mail.gmail.com>",
  provider: "gmail",
  communicationId: "comm-sent-1",
})));

const rules = vi.hoisted(() => ({
  followup_max: 1,
  followup_hours: 48,
  outreach_batch_limit: 50,
  work_execution: "sub",
  final_nudge_enabled: true,
  calls_enabled: false,
  min_bid_lead_business_days: 5,
  autonomous_review_decisions: true,
  rfq_outbound_enabled: false,
  rfq_daily_cap: 100,
  rfq_subs_per_trade: 5,
}));

const db = vi.hoisted(() => ({
  query: vi.fn(async () => [] as unknown[]),
  queryOne: vi.fn(async () => null as unknown),
}));

vi.mock("../lib/integrations/email-transport", () => ({
  sendOutreachEmail,
  OUTREACH_SENDER: "Fixture <ops@example.test>",
  OUTREACH_EMAIL: "ops@example.test",
}));
vi.mock("../lib/integrations/gmail", () => ({
  gmail: { threadMessageId: async () => ({ rfc822MessageId: "<orig@mail.gmail.com>", references: [] }) },
}));
vi.mock("../lib/db", () => ({
  query: db.query,
  queryOne: db.queryOne,
  transaction: async (fn: (client: unknown) => unknown) => fn({}),
}));
vi.mock("../lib/logger", () => ({ logAgent: async () => undefined }));
vi.mock("../lib/app-settings", () => ({
  getWorkExecution: async () => "sub",
  getAutomationRules: async () => rules,
  areCallsEnabled: async () => false,
  isAutomationPaused: async () => false,
}));
vi.mock("../lib/ai/companyProfile", () => ({
  getProfileJson: async () => ({
    legal_name: "Fixture Prime",
    owner_name: "Pat Prime",
    phone: "555-0100",
    primary_trades: ["HVAC"],
  }),
}));
vi.mock("../lib/agents/org-fanout", () => ({
  orgsToSweep: async () => ({ orgs: [{ id: "org-1", name: "Fixture" }], error: null, soloFallback: false, pausedCount: 0 }),
  fanoutNote: () => null,
}));
vi.mock("../lib/domain/template-store", () => ({
  activeTemplate: async () => ({ subject: "Following up", body: "Hi {{owner_name}}, following up on the quote request." }),
}));
vi.mock("../lib/integrations/twilio", () => ({ sms: { alert: async () => ({ disabled: true }) } }));
vi.mock("../lib/integrations/system-mail", () => ({ systemMail: { send: async () => ({ disabled: true }) } }));

import { readFileSync } from "node:fs";
import { outreachFollowup } from "../lib/agents/maintenance";

const dueFollowUp = {
  id: "comm-1",
  subcontractor_id: "sub-1",
  opportunity_id: "opp-1",
  tracking_id: "track-1",
  email: "quotes@hvac.example",
  email_verified: true,
  sub_owner_name: "Alex",
  trade: "HVAC",
  location_state: "TX",
  deadline: "2026-10-20T00:00:00.000Z",
  orig_subject: "Pricing request",
  gmail_thread_id: "gmail-thread-1",
  rfc822_message_id: "<orig@mail.gmail.com>",
  opp_title: "Fixture HVAC",
  agency: "USAF",
  solicitation_number: "FA-1",
  location_text: "Abilene, TX",
  description: "Replace the units.",
  solicitation_analysis: { required_trades: ["HVAC"] },
  orig_quote_due_label: "October 30, 2026",
  orig_quote_due_at: "2026-10-30T00:00:00.000Z",
};

describe("paused outbound quote requests", () => {
  beforeEach(() => {
    sendOutreachEmail.mockClear();
    rules.rfq_outbound_enabled = false;
    rules.final_nudge_enabled = true;
    rules.followup_max = 1;
    db.query.mockReset();
    db.query.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("from communications c")) return [dueFollowUp];
      if (text.includes("interval '4 days'")) {
        return [{
          opportunity_id: "opp-1",
          subcontractor_id: "sub-1",
          trade: "HVAC",
          email: "quotes@hvac.example",
          owner_name: "Alex",
          deadline: "2026-10-20T00:00:00.000Z",
        }];
      }
      if (text.includes("interval '15 minutes'")) return [{ id: "comm-1" }];
      return [];
    });
  });

  it("sends no follow-up and no last-call nudge while outbound is paused", async () => {
    const result = await outreachFollowup.handler({ runId: "run-paused", trigger: "cron", payload: {} });
    expect(sendOutreachEmail).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ sent: 0, lastCalls: 0, failures: 0 });
    const cleared = db.query.mock.calls.filter(([sql]) => String(sql).includes("follow_up_at = null"));
    expect(cleared).toEqual([]);
  });

  it("checks the pause inside followUpForOrg before any follow-up send", () => {
    const source = readFileSync("lib/agents/maintenance.ts", "utf8");
    const followUp = source.slice(
      source.indexOf("async function followUpForOrg"),
      source.indexOf("export const outreachRecoverySweep")
    );
    const pause = followUp.indexOf("rules.rfq_outbound_enabled === false");
    const send = followUp.indexOf("sendOutreachEmail");
    expect(pause).toBeGreaterThan(-1);
    expect(pause).toBeLessThan(send);
    const nudge = source.slice(
      source.indexOf("export async function lastCallForOrg"),
      source.indexOf("async function recordBounce")
    );
    expect(nudge.indexOf("rules.rfq_outbound_enabled === false")).toBeGreaterThan(-1);
    expect(nudge.indexOf("rules.rfq_outbound_enabled === false")).toBeLessThan(nudge.indexOf("sendOutreachEmail"));
  });
});

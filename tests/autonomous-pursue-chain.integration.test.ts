import { beforeEach, describe, expect, it, vi } from "vitest";

const sendOutreachEmail = vi.hoisted(() =>
  vi.fn(async () => ({
    messageId: "gmail-msg-1",
    threadId: "gmail-thread-1",
    rfc822MessageId: "<followup@mail.gmail.com>",
    provider: "gmail",
    communicationId: "comm-sent-1",
  }))
);

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
vi.mock("../lib/db", () => ({ query: db.query, queryOne: db.queryOne, transaction: async (fn: (c: unknown) => unknown) => fn({}) }));
vi.mock("../lib/logger", () => ({ logAgent: async () => undefined }));
vi.mock("../lib/app-settings", () => ({
  getWorkExecution: async () => "sub",
  getAutomationRules: async () => ({
    followup_max: 1,
    followup_hours: 48,
    outreach_batch_limit: 50,
    work_execution: "sub",
    final_nudge_enabled: false,
    calls_enabled: false,
    min_bid_lead_business_days: 5,
    autonomous_review_decisions: true,
  }),
  areCallsEnabled: async () => false,
}));
vi.mock("../lib/ai/companyProfile", () => ({
  getProfileJson: async () => ({
    legal_name: "Fixture Prime",
    owner_name: "Pat Prime",
    phone: "555-0100",
    primary_trades: ["HVAC"],
    decision_thresholds: { block_prime_only: false },
    sub_standards: { candidates_per_trade: 2, verify_top_n: 1 },
  }),
}));
vi.mock("../lib/integrations/googleMaps", () => ({
  googleMaps: {
    findContractors: async () => ({ results: [] }),
    enrichTopN: async (rows: unknown[]) => rows,
  },
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

import { subFinder } from "../lib/agents/sub-finder";
import { outreachFollowup } from "../lib/agents/maintenance";

const ready = {
  id: "opp-1",
  org_id: "org-1",
  stage: "sub_research",
  status: "open",
  pursuit_state: "active",
  location_state: "TX",
  location_text: "Abilene, TX",
  analysis_input_hash: "hash-1",
  solicitation_analysis: {
    required_trades: ["HVAC"],
    completeness: { ok: true, missing: [] },
    past_perf_classification: "team_accepted",
    geographic_area: "Abilene, TX",
  },
};

describe("pursued work sends and follows up without a human gate", () => {
  beforeEach(() => {
    sendOutreachEmail.mockClear();
    db.query.mockReset();
    db.queryOne.mockReset();
    db.query.mockImplementation(async (sql: string) => {
      if (String(sql).includes("select id, company_name from subcontractors")) {
        return [{ id: "sub-1", company_name: "Fixture HVAC", email: "quotes@hvac.example", email_verified: true }];
      }
      if (String(sql).includes("from communications c")) {
        return [{
          id: "comm-1",
          subcontractor_id: "sub-1",
          opportunity_id: "opp-1",
          tracking_id: "track-1",
          email: "quotes@hvac.example",
          email_verified: true,
          sub_owner_name: "Alex",
          trade: "HVAC",
          location_state: "TX",
          deadline: "2026-11-20T00:00:00.000Z",
          orig_subject: "Pricing request",
          gmail_thread_id: "gmail-thread-1",
          rfc822_message_id: "<orig@mail.gmail.com>",
          opp_title: "Fixture HVAC",
          agency: "USAF",
          solicitation_number: "FA-1",
          location_text: "Abilene, TX",
          description: "Replace the units.",
          solicitation_analysis: ready.solicitation_analysis,
          orig_quote_due_label: "October 30, 2026",
          orig_quote_due_at: "2026-10-30T00:00:00.000Z",
        }];
      }
      if (String(sql).includes("interval '15 minutes'")) return [{ id: "comm-1" }];
      return [];
    });
    db.queryOne.mockImplementation(async (sql: string) => {
      if (String(sql).includes("from opportunities where id")) return ready;
      if (String(sql).includes("as n")) return { n: 0 };
      return null;
    });
  });

  it("queues verification and does not park the opportunity when outreach is allowed", async () => {
    const result = await subFinder.handler({
      runId: "run-1",
      trigger: "queue",
      payload: { opportunityId: "opp-1" },
    });
    expect(result.humanActionRequired).toBe(false);
    expect(result.enqueued?.map((job) => job.agent)).toContain("sub-verify");
    const stageWrite = db.query.mock.calls.find(([sql]) => String(sql).includes("human_action_required"));
    expect(stageWrite?.[1]?.[1]).toBe(false);
  });

  it("sends the due follow-up through the mocked mailbox and does not ask for a person", async () => {
    const result = await outreachFollowup.handler({ runId: "run-2", trigger: "cron", payload: {} });
    expect(result.ok).toBe(true);
    expect(sendOutreachEmail).toHaveBeenCalledTimes(1);
    expect(sendOutreachEmail.mock.calls[0]?.[0]).toMatchObject({
      to: "quotes@hvac.example",
      orgId: "org-1",
      opportunityId: "opp-1",
    });
    const human = db.query.mock.calls.filter(([sql]) => String(sql).includes("human_action_required"));
    expect(human).toEqual([]);
    expect(result.summary).toContain("Sent 1 follow-up");
  });
});

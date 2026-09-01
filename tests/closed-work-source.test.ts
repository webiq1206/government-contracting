/**
 * The follow-up and expire sweeps must refuse closed work in SQL, not only
 * in a helper that a later edit can forget to call.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const MAINTENANCE = readFileSync("lib/agents/maintenance.ts", "utf8");
const PASS = readFileSync("lib/opportunity-transitions.ts", "utf8");
const ABORT = readFileSync("app/api/opportunities/[id]/pursuit/route.ts", "utf8");
const DATA = readFileSync("lib/data.ts", "utf8");
const HEALTH = readFileSync("lib/automation-status.ts", "utf8");
const RUNNER = readFileSync("lib/agents/runner.ts", "utf8");
const INTEGRATIONS_PAGE = readFileSync("app/(dash)/settings/integrations/page.tsx", "utf8");
const INTEGRATION_MANAGER = readFileSync("components/integration-manager.tsx", "utf8");

describe("follow-up selection refuses closed opportunities", () => {
  it("requires an open, active, unsubmitted opportunity", () => {
    expect(MAINTENANCE).toContain("and o.status = 'open'");
    expect(MAINTENANCE).toContain("and coalesce(o.pursuit_state, 'active') = 'active'");
    expect(MAINTENANCE).toContain("and o.stage not in ('dismissed', 'submitted', 'won', 'lost')");
  });

  it("does not restore a follow-up marker after a closed-record refusal", () => {
    expect(MAINTENANCE).toContain("} else if (res.disabled) {");
    const disabled = MAINTENANCE.indexOf("} else if (res.disabled) {");
    const restore = MAINTENANCE.indexOf("follow_up_at = now() + interval '15 minutes'");
    expect(disabled).toBeGreaterThan(-1);
    expect(restore).toBeGreaterThan(disabled);
  });
});

describe("expire sweep leaves submitted bids alone and stops leftover work", () => {
  it("does not expire a bid that is sending or already sent", () => {
    expect(MAINTENANCE).toContain("b.submitted_at is not null");
    expect(MAINTENANCE).toContain("'sending','sent','receipt_confirmed','accepted'");
    expect(MAINTENANCE).toContain("stopOpportunityAutomation");
  });
});

describe("active work lists hide aborted pursuits", () => {
  it("shares one not-aborted predicate with the call queue and triage badge", () => {
    expect(DATA).toContain("export const ACTIVE_PURSUIT_SQL");
    expect(DATA).toContain("and ${ACTIVE_PURSUIT_SQL}");
    expect(DATA).toContain("WORKABLE_CALL_CARD_SQL");
    expect(DATA).toContain("TRIAGE_WHERE_SQL");
  });

  it("keeps aborted records off the default pipeline board", () => {
    expect(DATA).toContain("coalesce(pursuit_state, 'active') <> 'aborted'");
  });
});

describe("automation health measures the real queue", () => {
  it("counts waiting pg-boss jobs instead of reporting unknown", () => {
    expect(HEALTH).toContain("queueBacklogDepth");
    expect(HEALTH).toContain("pgboss.job");
    expect(HEALTH).toContain("state in ('created', 'retry')");
    expect(HEALTH).toContain("windowErrors");
    expect(HEALTH).toContain("and status = 'error'");
    const healthFn = DATA.slice(
      DATA.indexOf("export async function agentHealth"),
      DATA.indexOf("export async function dailyDigest")
    );
    expect(healthFn).toContain("org_id = $1");
  });
});

describe("a mixed-tenant payload is abandoned", () => {
  it("refuses to run under the first organization", () => {
    expect(RUNNER).toContain("Abandoned rather than run under either one");
    expect(RUNNER).toContain("payload names records from two organizations");
    expect(RUNNER).not.toContain("Running as ${resolved}");
  });
});

describe("a restart rechecks facts and does not send", () => {
  it("queues reverify and analysis, not outreach", () => {
    expect(ABORT).toContain("RESTART_REQUEUE_AGENTS");
    expect(ABORT).toContain("startVerification");
    expect(ABORT).toContain("restartMayProceed");
    expect(ABORT).toContain("Nothing is sent until the rebuilt packets are approved.");
    expect(ABORT).not.toContain('enqueue("outreach"');
    expect(ABORT).not.toContain("call-prep");
  });
});

describe("pass and abort stop leftover work", () => {
  it("a pass marks the pursuit aborted and clears scheduled work", () => {
    expect(PASS).toContain("pursuit_state='aborted'");
    expect(PASS).toContain("stopOpportunityAutomation");
  });

  it("an abort clears scheduled follow-ups and pending calls", () => {
    expect(ABORT).toContain("stopOpportunityAutomation");
    expect(ABORT).toContain('"aborted"');
  });
});

describe("the opportunities page is the pipeline", () => {
  it("does not send operators to a 404 named /opportunities", () => {
    const comms = readFileSync("app/(dash)/communications/page.tsx", "utf8");
    const setup = readFileSync("lib/domain/setup.ts", "utf8");
    const knowledge = readFileSync("lib/domain/knowledge.ts", "utf8");
    const how = readFileSync("app/(dash)/how-it-works/page.tsx", "utf8");
    expect(comms).toContain('href="/pipeline"');
    expect(comms).not.toContain('href="/opportunities"');
    expect(setup).toContain('href: "/pipeline"');
    expect(knowledge).toContain('recoveryHref: "/pipeline?closed=1"');
    expect(knowledge).not.toContain('"/opportunities?status=archived"');
    expect(how).toContain('opportunity: "/pipeline"');
  });
});

describe("operator pages keep the names and chrome they already have", () => {
  it("sends mail recovery to Communications, not the old email-log name", () => {
    const knowledge = readFileSync("lib/domain/knowledge.ts", "utf8");
    const recap = readFileSync("lib/domain/recap/sections.ts", "utf8");
    const how = readFileSync("app/(dash)/how-it-works/page.tsx", "utf8");
    expect(knowledge).toContain('recoveryHref: "/communications"');
    expect(knowledge).not.toContain('recoveryHref: "/email-log"');
    expect(recap).toContain('href: "/communications"');
    expect(recap).not.toContain('href: "/email-log"');
    expect(how).toContain('"email-log": "/communications"');
  });

  it("keeps the desktop sidebar on subscribed billing pages", () => {
    const layout = readFileSync("app/(account)/layout.tsx", "utf8");
    expect(layout).toContain("<Nav");
    expect(layout).toContain("todayCount={counts.today}");
  });

  it("does not load file storage just to open the Feedback page", () => {
    const src = readFileSync("lib/feedback.ts", "utf8");
    expect(src).not.toMatch(/^import .*storage/m);
    expect(src).not.toMatch(/^import .*sub-compliance-store/m);
    expect(src).toContain('import("@/lib/integrations/storage")');
  });

  it("does not contradict a working Claude card with never-used copy", () => {
    const src = readFileSync("components/integration-manager.tsx", "utf8");
    expect(src).toContain('def.state === "configured"');
    expect(src).not.toContain("def.configured && !def.last_success_at && !def.last_tested_at");
  });

  it("treats a successful scoring run as Claude having been used", () => {
    expect(INTEGRATIONS_PAGE).toContain("lastAiSuccess");
    expect(INTEGRATIONS_PAGE).toContain('def.id === "claude"');
  });
});

describe("gmail is not shown as unused while it is connected", () => {
  it("does not render a second Google Inbox card next to the connect button", () => {
    expect(INTEGRATIONS_PAGE).toContain('i.id !== "gmail"');
  });

  it("only states the cost of being unconnected when it is unconnected", () => {
    expect(INTEGRATION_MANAGER).toContain('def.state === "not_configured" && def.without');
    expect(INTEGRATION_MANAGER).not.toContain("Right now: {def.without}");
  });
});

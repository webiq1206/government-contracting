import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const recovery = readFileSync("lib/recovery.ts", "utf8");
const incidents = readFileSync("lib/incidents.ts", "utf8");

describe("automation recovery safety", () => {
  it("scopes superseding successes to the failed run's tenant", () => {
    expect(recovery).toContain("later.org_id = jr.org_id");
    expect(recovery).toContain("o.org_id = jr.org_id");
  });

  it("keeps existing or refused requeues from producing a false recovered state", () => {
    expect(recovery).toContain("const remaining = counts.queued + counts.failed");
    expect(recovery).toMatch(/counts\.queued > 0[\s\S]*?"backlog_requeued"/);
    expect(recovery).toMatch(/counts\.failed > 0[\s\S]*?"recovery_failed"/);
    expect(recovery).toContain("no duplicate work was queued");
  });

  it("reclaims only failed enqueue claims and carries their trusted identity", () => {
    expect(recovery).toContain("where incident_requeues.outcome='failed'");
    expect(recovery).toContain("recoveryRequeueId: claimed.id");
    expect(recovery).toContain("set outcome='failed', outcome_at=now()");
  });

  it("confirms completion from this incident's successful requeues", () => {
    const confirmationQuery = recovery.match(
      /export async function confirmDownstream[\s\S]*?^}/m
    )?.[0];
    expect(confirmationQuery).toContain("from incident_requeues");
    expect(confirmationQuery).toContain("incident_id = $2");
    expect(confirmationQuery).toContain("outcome = 'succeeded'");
    expect(confirmationQuery).toContain("outcome_at is not null");
    expect(confirmationQuery).not.toContain("from job_runs");
  });

  it("writes incident state and history atomically under a row lock and CAS", () => {
    const advance = incidents.match(/export async function advance[\s\S]*?^}/m)?.[0];
    expect(advance).toContain("transaction(async (client)");
    expect(advance).toContain("for update");
    expect(advance).toContain("and state = $13");
    expect(advance).toContain("insert into incident_events");
  });
});

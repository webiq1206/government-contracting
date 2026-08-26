import { describe, it, expect } from "vitest";
import {
  SERVICES,
  serviceStatuses,
  platformStatus,
  platformIncidents,
  type AgentRunFacts,
  type FailureRow,
} from "@/lib/domain/platform-health";

const EXTRAS = {
  billingWebhooks: { state: "healthy" as const, detail: "Events arriving." },
  providerCapacity: { state: "healthy" as const, detail: "No refusals." },
  queueDepth: 4,
};

function facts(over: Partial<AgentRunFacts> & { agent: string }): AgentRunFacts {
  return {
    runs: 10,
    errors: 0,
    lastRunAt: "2026-08-26T11:00:00Z",
    lastErrorAt: null,
    sampleError: null,
    affectedOrgs: 0,
    ...over,
  };
}

describe("serviceStatuses", () => {
  it("names the nine services the audit lists", () => {
    expect(SERVICES.map((s) => s.key)).toEqual([
      "ingestion",
      "scoring",
      "email_delivery",
      "inbox_sync",
      "documents",
      "scheduled_automation",
      "provider_capacity",
      "billing_webhooks",
      "queues",
    ]);
  });

  it("calls a service that has not run unknown, never healthy", () => {
    // The distinction the whole page turns on: a platform whose agents have
    // all stopped shows no failures at all.
    const s = serviceStatuses([], EXTRAS).find((x) => x.key === "ingestion")!;
    expect(s.state).toBe("unknown");
    expect(s.failureRate).toBeNull();
    expect(s.detail).toContain("no evidence either way");
  });

  it("calls a clean run healthy", () => {
    const s = serviceStatuses([facts({ agent: "opportunity-monitor" })], EXTRAS).find(
      (x) => x.key === "ingestion"
    )!;
    expect(s.state).toBe("healthy");
    expect(s.failureRate).toBe(0);
    expect(s.stateWord).toBeUndefined();
  });

  it("calls a service failing everything down", () => {
    const s = serviceStatuses(
      [facts({ agent: "opportunity-monitor", runs: 10, errors: 10, affectedOrgs: 6 })],
      EXTRAS
    ).find((x) => x.key === "ingestion")!;
    expect(s.state).toBe("down");
    expect(s.failureRate).toBe(100);
    expect(s.detail).toContain("6 accounts");
  });

  it("calls a service failing some of the time degraded", () => {
    const s = serviceStatuses(
      [facts({ agent: "opportunity-monitor", runs: 10, errors: 3 })],
      EXTRAS
    ).find((x) => x.key === "ingestion")!;
    expect(s.state).toBe("degraded");
  });

  it("counts one run in the singular", () => {
    const s = serviceStatuses([facts({ agent: "opportunity-monitor", runs: 1 })], EXTRAS).find(
      (x) => x.key === "ingestion"
    )!;
    expect(s.detail).toBe("1 run, none failed.");
  });

  it("adds up every agent that performs one service", () => {
    const s = serviceStatuses(
      [
        facts({ agent: "scoring-engine", runs: 20, errors: 1 }),
        facts({ agent: "solicitation-analyst", runs: 10, errors: 0 }),
      ],
      EXTRAS
    ).find((x) => x.key === "scoring")!;
    expect(s.runs).toBe(30);
    expect(s.errors).toBe(1);
  });

  it("says so when queue depth cannot be measured rather than reporting nought", () => {
    const s = serviceStatuses([], { ...EXTRAS, queueDepth: null }).find(
      (x) => x.key === "queues"
    )!;
    expect(s.state).toBe("unknown");
    expect(s.detail).toContain("not measurable");
    // "Not run" would tell an administrator the queue had stopped, which is a
    // different and more alarming thing than not being able to see it.
    expect(s.stateWord).toBe("Not measured");
  });

  it("flags a queue that is filling faster than it drains", () => {
    const s = serviceStatuses([], { ...EXTRAS, queueDepth: 900 }).find(
      (x) => x.key === "queues"
    )!;
    expect(s.state).toBe("degraded");
  });
});

describe("platformStatus", () => {
  const clean = () =>
    serviceStatuses(
      SERVICES.flatMap((s) => s.agents).map((agent) => facts({ agent })),
      EXTRAS
    );

  it("reports operational when everything ran and nothing failed", () => {
    const p = platformStatus(clean());
    expect(p.state).toBe("operational");
    expect(p.detail).toContain("Every service has run");
  });

  it("refuses to call a silent platform healthy", () => {
    const p = platformStatus(
      serviceStatuses([], {
        billingWebhooks: { state: "unknown", detail: "" },
        providerCapacity: { state: "unknown", detail: "" },
        queueDepth: null,
      })
    );
    expect(p.state).toBe("unknown");
    expect(p.headline).toBe("Nothing has run");
    expect(p.detail).toContain("worker is not running");
  });

  it("says which services are unproven even when nothing has failed", () => {
    const p = platformStatus(
      serviceStatuses([facts({ agent: "opportunity-monitor" })], EXTRAS)
    );
    expect(p.state).toBe("operational");
    expect(p.detail).toContain("unproven rather than healthy");
    expect(p.unknown.length).toBeGreaterThan(0);
  });

  it("puts an outage ahead of any number of degradations", () => {
    const p = platformStatus(
      serviceStatuses(
        [
          facts({ agent: "opportunity-monitor", runs: 10, errors: 10 }),
          facts({ agent: "reply-poll", runs: 10, errors: 4 }),
        ],
        EXTRAS
      )
    );
    expect(p.state).toBe("major_outage");
    expect(p.headline).toContain("Opportunity ingestion is down");
    expect(p.detail).toContain("Every account is affected");
  });

  it("counts multiple outages rather than naming only the first", () => {
    const p = platformStatus(
      serviceStatuses(
        [
          facts({ agent: "opportunity-monitor", runs: 10, errors: 10 }),
          facts({ agent: "reply-poll", runs: 10, errors: 10 }),
        ],
        EXTRAS
      )
    );
    expect(p.headline).toBe("2 services are down");
  });
});

describe("platformIncidents", () => {
  const rows: FailureRow[] = [
    { agent: "scoring-engine", orgId: "a", error: "credit balance too low", at: "2026-08-26T09:00:00Z" },
    { agent: "solicitation-analyst", orgId: "b", error: "Your credit balance is too low", at: "2026-08-26T10:00:00Z" },
    { agent: "scoring-engine", orgId: "c", error: "credit balance too low", at: "2026-08-26T11:00:00Z" },
    { agent: "reply-poll", orgId: "a", error: "rate limit exceeded", at: "2026-08-26T10:30:00Z" },
  ];

  it("groups one cause once, whatever the tenant, and counts the tenants", () => {
    // Reporting the same exhausted balance once per customer is the wrong
    // shape for a reader who fixes it once.
    const [first] = platformIncidents(rows);
    expect(first.cause).toBe("provider_credit");
    expect(first.failures).toBe(3);
    expect(first.orgs).toBe(3);
    expect(first.agents.sort()).toEqual(["scoring-engine", "solicitation-analyst"]);
  });

  it("puts a blocking cause first even when another has more failures", () => {
    const many: FailureRow[] = [
      ...Array.from({ length: 20 }, (_, i) => ({
        agent: "reply-poll",
        orgId: `o${i}`,
        error: "rate limit",
        at: "2026-08-26T10:00:00Z",
      })),
      { agent: "scoring-engine", orgId: "a", error: "credit balance too low", at: "2026-08-26T09:00:00Z" },
    ];
    const [first] = platformIncidents(many);
    expect(first.cause).toBe("provider_credit");
    expect(first.blocking).toBe(true);
  });

  it("tracks the window each cause spans", () => {
    const [first] = platformIncidents(rows);
    expect(first.firstSeen).toBe("2026-08-26T09:00:00Z");
    expect(first.lastSeen).toBe("2026-08-26T11:00:00Z");
  });

  it("does not count a failure with no organization as a tenant", () => {
    const [first] = platformIncidents([
      { agent: "retention-sweep", orgId: null, error: "database is unavailable", at: "2026-08-26T09:00:00Z" },
    ]);
    expect(first.failures).toBe(1);
    expect(first.orgs).toBe(0);
  });

  it("returns nothing when nothing failed", () => {
    expect(platformIncidents([])).toEqual([]);
  });
});

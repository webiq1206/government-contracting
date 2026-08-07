import { describe, it, expect } from "vitest";
import { QUEUE_NAMES } from "@/lib/queue";
import { ALL_AGENTS } from "@/lib/agents/registry";

/**
 * QUEUE_NAMES is a hand-maintained list, and pg-boss v10 silently drops a
 * send to a queue that was never created. When the list drifted from the
 * registry in production, four agents (expired-opportunity-sweep,
 * retention-sweep, backlink-scout, backlink-outreach-sweep) were scheduled,
 * enqueued, and never ran, with no error logged anywhere.
 *
 * This test makes that drift impossible to ship again.
 */
describe("queue names stay in sync with the agent registry", () => {
  it("has a queue for every registered agent", () => {
    const queues = new Set<string>(QUEUE_NAMES);
    const missing = ALL_AGENTS.map((a) => a.name).filter((n) => !queues.has(n));
    expect(missing, `agents with no queue (they would never run): ${missing.join(", ")}`).toEqual(
      []
    );
  });

  it("has no queue without a matching agent", () => {
    const agents = new Set(ALL_AGENTS.map((a) => a.name));
    const orphans = QUEUE_NAMES.filter((n) => !agents.has(n));
    expect(orphans, `queues with no agent: ${orphans.join(", ")}`).toEqual([]);
  });
});

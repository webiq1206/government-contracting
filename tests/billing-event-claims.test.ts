import { afterEach, describe, expect, it, vi } from "vitest";

async function load(opts: {
  query?: ReturnType<typeof vi.fn>;
  queryOne?: ReturnType<typeof vi.fn>;
} = {}) {
  vi.resetModules();
  const query = opts.query ?? vi.fn(async () => []);
  const queryOne = opts.queryOne ?? vi.fn(async () => null);
  vi.doMock("@/lib/db", () => ({ query, queryOne }));
  return { mod: await import("@/lib/billing/events"), query, queryOne };
}

afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.resetModules();
});

describe("Stripe event claims", () => {
  it("identifies a newly acquired claim", async () => {
    const { mod } = await load({ query: vi.fn(async () => [{ id: "evt_new" }]) });
    await expect(
      mod.claimEvent({ id: "evt_new", type: "invoice.paid", createdAtSec: 1 })
    ).resolves.toEqual({ fresh: true, state: "claimed" });
  });

  it("does not acknowledge a concurrent in-flight event as completed", async () => {
    const { mod } = await load({
      query: vi.fn(async () => []),
      queryOne: vi.fn(async () => ({ error: "__processing__" })),
    });
    await expect(
      mod.claimEvent({ id: "evt_busy", type: "invoice.paid", createdAtSec: 1 })
    ).resolves.toEqual({ fresh: false, state: "processing" });
  });

  it("recognizes a completed duplicate", async () => {
    const { mod } = await load({
      query: vi.fn(async () => []),
      queryOne: vi.fn(async () => ({ error: null })),
    });
    await expect(
      mod.claimEvent({ id: "evt_done", type: "invoice.paid", createdAtSec: 1 })
    ).resolves.toEqual({ fresh: false, state: "completed" });
  });

  it("fails completion if this worker no longer owns the claim", async () => {
    const { mod } = await load({ query: vi.fn(async () => []) });
    await expect(mod.completeEvent("evt_lost")).rejects.toThrow(/claim was lost/i);
  });

  it("propagates ordering-read failures instead of treating a stale event as new", async () => {
    const { mod } = await load({
      queryOne: vi.fn(async () => {
        throw new Error("database offline");
      }),
    });
    await expect(mod.isNewerThanApplied("org", 1)).rejects.toThrow("database offline");
  });
});

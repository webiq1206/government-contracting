import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * The sweep exists so a certificate cannot lapse unnoticed. What matters is
 * that it reports a lapse exactly once, chases the ones still fixable, and
 * corrects stored statuses that have gone stale.
 */
const NOW = new Date("2026-08-13T00:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

async function load(rows: unknown[]) {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const updates: unknown[][] = [];
  vi.doMock("@/lib/db", () => ({
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("update subcontractor_documents")) {
        updates.push(params);
        return [];
      }
      return rows;
    }),
    queryOne: vi.fn(async () => null),
  }));
  const logs: Record<string, unknown>[] = [];
  vi.doMock("@/lib/logger", () => ({
    logAgent: vi.fn(async (e: Record<string, unknown>) => {
      logs.push(e);
    }),
  }));
  vi.doMock("@/lib/integrations/system-mail", () => ({
    systemMail: { enabled: async () => false, send: vi.fn() },
  }));
  const mod = await import("@/lib/agents/compliance-sweep");
  return { mod, updates, logs };
}

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/logger");
  vi.doUnmock("@/lib/integrations/system-mail");
  vi.resetModules();
});

const doc = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  org_id: "o1",
  subcontractor_id: "s1",
  company_name: "Acme Fencing",
  sub_email: "a@acme.com",
  doc_type: "coi_general_liability",
  status: "active",
  expires_at: days(200),
  signed_at: days(-30),
  verified_at: days(-30),
  carrier: "Test Mutual",
  ...over,
});

describe("catching lapses", () => {
  it("reports a certificate that lapsed while the row still said active", async () => {
    const { mod, updates, logs } = await load([doc({ expires_at: days(-1) })]);
    const res = await mod.complianceSweep.handler({} as never);
    expect(res.humanActionRequired).toBe(true);
    expect(updates[0]).toEqual(["d1", "expired"]);
    expect(logs[0].action).toBe("coverage-lapsed");
    expect(String(logs[0].message)).toContain("No work can go out");
  });

  it("does not re-report a lapse already recorded", async () => {
    // Status already 'expired' means it was reported on a previous run.
    const { mod, logs } = await load([doc({ status: "expired", expires_at: days(-40) })]);
    const res = await mod.complianceSweep.handler({} as never);
    expect(res.humanActionRequired).toBe(false);
    expect(logs).toHaveLength(0);
  });

  it("chases one expiring soon without treating it as a stoppage", async () => {
    const { mod, logs } = await load([doc({ expires_at: days(10) })]);
    const res = await mod.complianceSweep.handler({} as never);
    expect(res.humanActionRequired).toBe(false);
    expect(logs[0].action).toBe("coverage-expiring");
    expect(String(logs[0].message)).toContain("while there is time");
  });

  it("leaves a certificate well in date alone", async () => {
    const { mod, logs, updates } = await load([doc()]);
    await mod.complianceSweep.handler({} as never);
    expect(logs).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});

describe("reporting", () => {
  it("groups several documents for one subcontractor into a single message", async () => {
    const { mod, logs } = await load([
      doc({ id: "d1", doc_type: "coi_general_liability", expires_at: days(5) }),
      doc({ id: "d2", doc_type: "coi_workers_comp", expires_at: days(9) }),
    ]);
    await mod.complianceSweep.handler({} as never);
    // One sub, one problem to a human, regardless of document count.
    expect(logs).toHaveLength(1);
    expect(String(logs[0].message)).toContain("General liability");
    expect(String(logs[0].message)).toContain("Workers compensation");
  });

  it("says so plainly when nothing is on file", async () => {
    const { mod } = await load([]);
    const res = await mod.complianceSweep.handler({} as never);
    expect(res.summary).toContain("No compliance documents");
  });
});

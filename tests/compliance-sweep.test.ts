import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * The sweep exists so a certificate cannot lapse unnoticed. What matters is
 * that it reports a lapse exactly once, chases the ones still fixable, and
 * corrects stored statuses that have gone stale.
 */
const NOW = new Date("2026-08-13T00:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

async function load(
  rows: unknown[],
  opts: {
    orgId?: string;
    mailReady?: boolean;
    mailResult?: { disabled?: boolean; error?: string };
  } = {}
) {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const orgId = opts.orgId ?? "o1";
  const updates: unknown[][] = [];
  vi.doMock("@/lib/db", () => ({
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("update subcontractor_documents")) {
        updates.push(params);
        return [];
      }
      if (sql.includes("from organizations")) {
        return [{ id: orgId }];
      }
      return rows;
    }),
    queryOne: vi.fn(async () => null),
  }));
  vi.doMock("@/lib/organizations", () => ({
    listActiveOrganizations: vi.fn(async () => [{ id: orgId }]),
  }));
  const logs: Record<string, unknown>[] = [];
  vi.doMock("@/lib/logger", () => ({
    logAgent: vi.fn(async (e: Record<string, unknown>) => {
      logs.push(e);
    }),
  }));
  const sends: Record<string, unknown>[] = [];
  vi.doMock("@/lib/integrations/system-mail", () => ({
    systemMail: {
      deliverable: async () => opts.mailReady ?? false,
      send: vi.fn(async (params: Record<string, unknown>) => {
        sends.push(params);
        return opts.mailResult ?? {};
      }),
    },
  }));
  vi.doMock("@/lib/config", () => ({
    config: { systemMail: { digestTo: "operations@example.com" } },
  }));
  const mod = await import("@/lib/agents/compliance-sweep");
  return { mod, updates, logs, sends };
}

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/logger");
  vi.doUnmock("@/lib/integrations/system-mail");
  vi.doUnmock("@/lib/config");
  vi.doUnmock("@/lib/organizations");
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
    expect(res.summary).toContain("0 document(s) checked");
  });

  it("reports a platform sender refusal instead of claiming the digest succeeded", async () => {
    const { mod, logs, sends } = await load([doc({ expires_at: days(10) })], {
      orgId: "00000000-0000-4000-8000-000000000001",
      mailReady: true,
      mailResult: { disabled: true, error: "No verified platform sender identity" },
    });

    const res = await mod.complianceSweep.handler({} as never);

    expect(sends).toHaveLength(1);
    expect(res.ok).toBe(false);
    expect(res.humanActionRequired).toBe(true);
    expect(res.summary).toContain("compliance digest could not be sent");
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "compliance-digest-unsent",
          status: "error",
          message: expect.stringContaining("No verified platform sender identity"),
        }),
      ])
    );
  });
});

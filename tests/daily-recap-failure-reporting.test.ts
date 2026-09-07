import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RECAP_SETTINGS } from "@/lib/domain/recap/types";

const deliverable = vi.fn(async () => true);
const sendDigest = vi.fn(async () => ({ messageId: "provider-1" }));
const sweepRecapBounces = vi.fn(async () => ({
  scanned: 0,
  matched: 0,
  unmatched: 0,
  failed: 0,
  truncated: false,
  error: null as string | null,
}));
const orgsToSweep = vi.fn(async () => ({
  orgs: [] as { id: string }[],
  error: null as string | null,
  soloFallback: false,
  pausedCount: 0,
}));
const recapRecipients = vi.fn(async () => [] as Array<{
  userId: string;
  email: string;
  name: string;
  timezone: string;
}>);
const buildRecapFor = vi.fn();
const claimDelivery = vi.fn(async () => ({ delivery: { id: "delivery-1" } }));
const markAttempting = vi.fn(async () => undefined);
const markFailed = vi.fn(async () => undefined);
const markSent = vi.fn(async () => undefined);
const markSkipped = vi.fn(async () => undefined);
const logged: Array<{ orgId: string | null; entry: Record<string, unknown> }> = [];
let currentOrg: string | null = null;

class AgeHistoryError extends Error {
  readonly operation: "read" | "record";

  constructor(operation: "read" | "record") {
    super("Urgent-item history could not be saved, so this recap was stopped before sending.");
    this.name = "RecapAgeHistoryUnavailableError";
    this.operation = operation;
  }
}

async function loadDailyRecap() {
  vi.resetModules();
  vi.doMock("@/lib/config", () => ({ config: { appUrl: "https://app.example.test" } }));
  vi.doMock("@/lib/logger", () => ({
    logAgent: vi.fn(async (entry: Record<string, unknown>) => {
      logged.push({ orgId: currentOrg, entry });
    }),
  }));
  vi.doMock("@/lib/integrations/system-mail", () => ({
    systemMail: { deliverable, sendDigest },
  }));
  vi.doMock("@/lib/tenant-context", () => ({
    LEGACY_ORG_ID: "00000000-0000-4000-8000-000000000001",
    runWithOrg: async <T>(orgId: string, fn: () => Promise<T>) => {
      const previous = currentOrg;
      currentOrg = orgId;
      try {
        return await fn();
      } finally {
        currentOrg = previous;
      }
    },
  }));
  vi.doMock("@/lib/agents/org-fanout", () => ({
    orgsToSweep,
    fanoutNote: (fanout: { error: string | null }) =>
      fanout.error
        ? `No accounts were processed: the list of accounts could not be read (${fanout.error}).`
        : null,
  }));
  vi.doMock("@/lib/domain/recap/day-window", () => ({
    addLocalDays: () => "2026-09-06",
    recapDue: () => ({
      due: true,
      localDate: "2026-09-07",
      dueAt: new Date("2026-09-07T06:00:00.000Z"),
      late: false,
    }),
    safeTimeZone: (value: string | null | undefined) => value ?? "UTC",
    dayWindow: () => ({
      start: new Date("2026-09-06T00:00:00.000Z"),
      end: new Date("2026-09-07T00:00:00.000Z"),
    }),
  }));
  vi.doMock("@/lib/domain/recap/email", () => ({
    renderRecapEmail: () => ({ subject: "Recap", html: "<p>Recap</p>", text: "Recap" }),
  }));
  vi.doMock("@/lib/recap/build", () => ({
    buildRecapFor,
    RecapAgeHistoryUnavailableError: AgeHistoryError,
  }));
  vi.doMock("@/lib/recap/delivery", () => ({
    claimDelivery,
    markAttempting,
    markFailed,
    markSent,
    markSkipped,
  }));
  vi.doMock("@/lib/recap/recipients", () => ({
    recapRecipients,
    platformRecapRecipients: vi.fn(async () => []),
  }));
  vi.doMock("@/lib/recap/platform", () => ({
    buildPlatformRecap: vi.fn(),
    gatherPlatformFacts: vi.fn(),
  }));
  vi.doMock("@/lib/platform-admin", () => ({ platformAdminEmails: () => new Set<string>() }));
  vi.doMock("@/lib/recap/settings", () => ({
    getRecapSettings: vi.fn(async () => DEFAULT_RECAP_SETTINGS),
  }));
  vi.doMock("@/lib/recap/bounces", () => ({ sweepRecapBounces }));
  return import("@/lib/agents/daily-recap");
}

beforeEach(() => {
  vi.clearAllMocks();
  logged.length = 0;
  currentOrg = null;
  deliverable.mockResolvedValue(true);
  sweepRecapBounces.mockResolvedValue({
    scanned: 0,
    matched: 0,
    unmatched: 0,
    failed: 0,
    truncated: false,
    error: null,
  });
  orgsToSweep.mockResolvedValue({
    orgs: [],
    error: null,
    soloFallback: false,
    pausedCount: 0,
  });
  recapRecipients.mockResolvedValue([]);
});

afterEach(() => {
  for (const path of [
    "@/lib/config",
    "@/lib/logger",
    "@/lib/integrations/system-mail",
    "@/lib/tenant-context",
    "@/lib/agents/org-fanout",
    "@/lib/domain/recap/day-window",
    "@/lib/domain/recap/email",
    "@/lib/recap/build",
    "@/lib/recap/delivery",
    "@/lib/recap/recipients",
    "@/lib/recap/platform",
    "@/lib/platform-admin",
    "@/lib/recap/settings",
    "@/lib/recap/bounces",
  ]) {
    vi.doUnmock(path);
  }
  vi.resetModules();
});

describe("daily recap operational failures", () => {
  it("uses a live deliverability probe and creates no claims when the grant is revoked", async () => {
    deliverable.mockResolvedValueOnce(false);
    const { dailyRecap } = await loadDailyRecap();

    const result = await dailyRecap.handler({ payload: {} } as never);

    expect(result).toMatchObject({ ok: false, humanActionRequired: true });
    expect(result.summary).toContain("connection or verified sender identity is not ready");
    expect(orgsToSweep).not.toHaveBeenCalled();
    expect(claimDelivery).not.toHaveBeenCalled();
  });

  it("does not report success when bounce reconciliation failed", async () => {
    sweepRecapBounces.mockResolvedValueOnce({
      scanned: 1,
      matched: 0,
      unmatched: 0,
      failed: 1,
      truncated: false,
      error: "delivery-history write failed",
    });
    const { dailyRecap } = await loadDailyRecap();

    const result = await dailyRecap.handler({ payload: {} } as never);

    expect(result).toMatchObject({ ok: false, humanActionRequired: true });
    expect(result.summary).toContain("bounce reconciliation incomplete");
    expect(result.reasoning).toContain("delivery-history write failed");
    expect(result.data).toMatchObject({ bouncesMatched: 0, bouncesFailed: 1 });
  });

  it("does not report success when the account list was unavailable", async () => {
    orgsToSweep.mockResolvedValueOnce({
      orgs: [],
      error: "database unavailable",
      soloFallback: false,
      pausedCount: 0,
    });
    const { dailyRecap } = await loadDailyRecap();

    const result = await dailyRecap.handler({ payload: {} } as never);

    expect(result).toMatchObject({ ok: false, humanActionRequired: true });
    expect(result.summary).toContain("account list unavailable");
    expect(result.reasoning).toContain("database unavailable");
  });

  it("records an age-build failure on the claimed tenant delivery and never calls mail", async () => {
    orgsToSweep.mockResolvedValueOnce({
      orgs: [{ id: "org-1" }],
      error: null,
      soloFallback: false,
      pausedCount: 0,
    });
    recapRecipients.mockResolvedValueOnce([
      { userId: "user-1", email: "owner@example.test", name: "Owner", timezone: "UTC" },
    ]);
    buildRecapFor.mockRejectedValueOnce(new AgeHistoryError("record"));
    const { dailyRecap } = await loadDailyRecap();

    const result = await dailyRecap.handler({ payload: {} } as never);

    expect(result.ok).toBe(false);
    expect(markFailed).toHaveBeenCalledWith(
      "delivery-1",
      expect.stringContaining("stopped before sending")
    );
    expect(markAttempting).not.toHaveBeenCalled();
    expect(sendDigest).not.toHaveBeenCalled();
    expect(
      logged.some(
        (line) => line.orgId === "org-1" && line.entry.action === "recap-org-failed"
      )
    ).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RECAP_SETTINGS } from "@/lib/domain/recap/types";

const gatherRecapFacts = vi.fn(async () => ({ problems: [] }));
const collectUrgent = vi.fn(() => [{ key: "deadline:one" }]);
const buildRecap = vi.fn(() => ({ localDate: "2026-09-06" }));
const recordUrgentItems = vi.fn(async () => ({ "deadline:one": 2 }));
const urgentAges = vi.fn(async () => ({ "deadline:one": 2 }));
const runWithOrg = vi.fn(async (_orgId: string, fn: () => Promise<unknown>) => fn());

async function loadBuild() {
  vi.resetModules();
  vi.doMock("@/lib/recap/gather", () => ({ gatherRecapFacts }));
  vi.doMock("@/lib/domain/recap/sections", () => ({ collectUrgent, buildRecap }));
  vi.doMock("@/lib/recap/delivery", () => ({ recordUrgentItems, urgentAges }));
  vi.doMock("@/lib/tenant-context", () => ({ runWithOrg }));
  return import("@/lib/recap/build");
}

const input = {
  orgId: "11111111-1111-4111-8111-111111111111",
  localDate: "2026-09-06",
  timezone: "UTC",
  settings: DEFAULT_RECAP_SETTINGS,
  now: new Date("2026-09-07T12:00:00.000Z"),
};

afterEach(() => {
  vi.clearAllMocks();
  vi.doUnmock("@/lib/recap/gather");
  vi.doUnmock("@/lib/domain/recap/sections");
  vi.doUnmock("@/lib/recap/delivery");
  vi.doUnmock("@/lib/tenant-context");
  vi.resetModules();
});

describe("recap urgency-history failures", () => {
  it("stops a page or preview instead of presenting a read failure as age zero", async () => {
    urgentAges.mockRejectedValueOnce(new Error("age table unavailable"));
    const { buildRecapFor } = await loadBuild();

    await expect(buildRecapFor({ ...input, recordAges: false })).rejects.toMatchObject({
      name: "RecapAgeHistoryUnavailableError",
      operation: "read",
      message: expect.stringContaining("instead of showing older items as new"),
    });
    expect(buildRecap).not.toHaveBeenCalled();
  });

  it("stops a real send when first-seen history cannot be durably recorded", async () => {
    recordUrgentItems.mockRejectedValueOnce(new Error("write refused"));
    const { buildRecapFor } = await loadBuild();

    await expect(buildRecapFor({ ...input, recordAges: true })).rejects.toMatchObject({
      name: "RecapAgeHistoryUnavailableError",
      operation: "record",
      message: expect.stringContaining("stopped before sending"),
    });
    expect(urgentAges).not.toHaveBeenCalled();
    expect(buildRecap).not.toHaveBeenCalled();
  });

  it("still accepts a legitimate empty age result and keeps the tenant context", async () => {
    collectUrgent.mockReturnValueOnce([]);
    urgentAges.mockResolvedValueOnce({});
    const { buildRecapFor } = await loadBuild();

    await expect(buildRecapFor({ ...input, recordAges: false })).resolves.toBeTruthy();
    expect(runWithOrg).toHaveBeenCalledWith(input.orgId, expect.any(Function));
    expect(buildRecap).toHaveBeenCalledWith(
      expect.anything(),
      input.settings,
      expect.objectContaining({ ages: {} })
    );
  });
});

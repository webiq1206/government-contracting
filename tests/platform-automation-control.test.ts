import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  admin: { id: "admin-1", email: "admin@example.test" } as Record<string, unknown> | Response,
  setPaused: vi.fn(),
  clearCache: vi.fn(),
  client: { query: vi.fn() },
  requiredAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/platform-admin", () => ({
  requirePlatformAdmin: vi.fn(async () => mocks.admin),
}));

vi.mock("@/lib/app-settings", () => ({
  getPlatformAutomationState: vi.fn(async () => ({
    paused: false,
    changed_at: null,
    changed_by: null,
  })),
  setPlatformAutomationPaused: mocks.setPaused,
  clearAutomationStateCache: mocks.clearCache,
}));

vi.mock("@/lib/admin/audit", () => ({
  recordRequiredAdminAction: mocks.requiredAudit,
}));

vi.mock("@/lib/db", () => ({
  transaction: vi.fn(async (fn: (client: typeof mocks.client) => Promise<unknown>) =>
    fn(mocks.client)
  ),
}));

function request(body: unknown) {
  return new Request("https://app.test/api/admin/automation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("platform automation emergency control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.admin = { id: "admin-1", email: "admin@example.test" };
    mocks.setPaused.mockImplementation(async (paused: boolean, by: string) => ({
      paused,
      changed_at: "2026-09-07T12:00:00.000Z",
      changed_by: by,
    }));
  });

  it("changes the unscoped platform switch and records who did it", async () => {
    const { POST } = await import("@/app/api/admin/automation/route");
    const response = await POST(request({ paused: true }));

    expect(response.status).toBe(200);
    expect(mocks.setPaused).toHaveBeenCalledWith(true, "admin@example.test", mocks.client);
    expect(mocks.requiredAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        adminEmail: "admin@example.test",
        action: "platform_automation_paused",
      }),
      mocks.client
    );
    expect(mocks.clearCache).toHaveBeenCalledTimes(1);
  });

  it("rolls back and tells the operator when the required audit cannot be written", async () => {
    mocks.requiredAudit.mockRejectedValueOnce(new Error("audit unavailable"));
    const { POST } = await import("@/app/api/admin/automation/route");
    const response = await POST(request({ paused: false }));
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(503);
    expect(body.error).toContain("was not changed");
    expect(mocks.clearCache).not.toHaveBeenCalled();
  });

  it("rejects an ambiguous command", async () => {
    const { POST } = await import("@/app/api/admin/automation/route");
    const response = await POST(request({ paused: "yes" }));
    expect(response.status).toBe(400);
    expect(mocks.setPaused).not.toHaveBeenCalled();
  });

  it("does not expose the switch to a non-admin", async () => {
    mocks.admin = NextResponse.json({ error: "Not found" }, { status: 404 });
    const { POST } = await import("@/app/api/admin/automation/route");
    const response = await POST(request({ paused: true }));
    expect(response.status).toBe(404);
    expect(mocks.setPaused).not.toHaveBeenCalled();
  });
});

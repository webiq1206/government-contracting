import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  currentUser: mocks.currentUser,
}));

import { requireUser } from "@/lib/api-auth";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { tryResolveTenantOrgId } from "@/lib/tenant";

describe("authentication lookup failures", () => {
  beforeEach(() => {
    mocks.currentUser.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 503, not 401, when the session or membership read fails", async () => {
    mocks.currentUser.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await requireUser();

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(503);
    expect((response as Response).headers.get("retry-after")).toBe("5");
    await expect((response as Response).json()).resolves.toEqual({
      error:
        "Your account could not be checked right now. Nothing was changed. Try again when the service recovers.",
    });
  });

  it("keeps a successful missing session as a real 401", async () => {
    mocks.currentUser.mockResolvedValueOnce(null);

    const response = await requireUser();

    expect((response as Response).status).toBe(401);
  });

  it("returns 503 rather than hiding an admin lookup outage as unauthorized", async () => {
    mocks.currentUser.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await requirePlatformAdmin();

    expect((response as Response).status).toBe(503);
    await expect((response as Response).json()).resolves.toMatchObject({
      error: expect.stringContaining("could not be checked"),
    });
  });

  it("returns null only for real missing tenant context and propagates lookup outages", async () => {
    mocks.currentUser.mockResolvedValueOnce(null);
    await expect(tryResolveTenantOrgId()).resolves.toBeNull();

    mocks.currentUser.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(tryResolveTenantOrgId()).rejects.toThrow("database unavailable");
  });
});

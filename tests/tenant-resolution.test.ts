import { beforeEach, describe, expect, it, vi } from "vitest";
import { LEGACY_ORG_ID, runWithOrg } from "@/lib/tenant-context";

const mocks = vi.hoisted(() => ({
  user: null as null | { organizationId: string | null },
}));

vi.mock("@/lib/auth", () => ({
  currentUser: vi.fn(async () => mocks.user),
}));

describe("tenant resolution", () => {
  beforeEach(() => {
    mocks.user = null;
  });

  it("never assigns an unauthenticated or orphaned request to the founding tenant", async () => {
    const { tryResolveTenantOrgId } = await import("@/lib/tenant");
    expect(await tryResolveTenantOrgId()).toBeNull();
    mocks.user = { organizationId: null };
    expect(await tryResolveTenantOrgId()).toBeNull();
  });

  it("uses the signed-in or job-scoped organization", async () => {
    const { tryResolveTenantOrgId } = await import("@/lib/tenant");
    mocks.user = { organizationId: "11111111-1111-4111-8111-111111111111" };
    expect(await tryResolveTenantOrgId()).toBe("11111111-1111-4111-8111-111111111111");
    expect(
      await runWithOrg("22222222-2222-4222-8222-222222222222", () =>
        tryResolveTenantOrgId()
      )
    ).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("keeps legacy fallback explicit", async () => {
    const { resolveTenantOrgId } = await import("@/lib/tenant");
    expect(await resolveTenantOrgId({ allowLegacyFallback: true })).toBe(LEGACY_ORG_ID);
  });
});

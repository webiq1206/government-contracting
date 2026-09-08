import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import type { SessionUser } from "@/lib/auth";
import { LEGACY_ORG_ID } from "@/lib/tenant-context";
import { readFileSync } from "node:fs";

let auth: SessionUser;

vi.mock("@/lib/api-auth", () => ({
  requireUser: vi.fn(async () => auth),
}));

const session = (organizationId: string | null, id = "user-1"): SessionUser => ({
  id,
  email: "operator@example.test",
  name: "Operator",
  role: "operator",
  organizationId,
  orgRole: "owner",
  subscriptionStatus: "active",
  planKey: "standard",
  trialEndsAt: null,
  billingExempt: false,
  suspendedAt: null,
  impersonatedBy: null,
});

describe("strict API organization context", () => {
  beforeEach(() => {
    auth = session(null);
  });

  it("denies an authenticated database user with no organization membership", async () => {
    const { requireOrgContext } = await import("@/lib/org-guard");
    const result = await requireOrgContext({ requireBilling: false });

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "No organization on this account." });
  });

  it("preserves the env operator only when auth has explicitly attached its organization", async () => {
    auth = session(LEGACY_ORG_ID, "env-operator");
    const { requireOrgContext } = await import("@/lib/org-guard");
    const result = await requireOrgContext({ requireBilling: false });

    expect(result).not.toBeInstanceOf(NextResponse);
    expect((result as { orgId: string }).orgId).toBe(LEGACY_ORG_ID);
  });
});

describe("organization role hardening", () => {
  it("does not infer ownership from the legacy users.role column", () => {
    const source = readFileSync("lib/organizations.ts", "utf8");
    const start = source.indexOf("export async function getOrgRoleForUser");
    const end = source.indexOf("export async function listActiveOrganizations", start);
    const fn = source.slice(start, end);
    expect(fn).not.toContain("select role from users");
    expect(fn).toContain("return null");
  });
});

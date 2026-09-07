import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeClient = { query: vi.fn() };
const events: string[] = [];

const createImpersonationSession = vi.fn(async () => {
  events.push("session");
  return "support-token";
});
const endImpersonation = vi.fn(async () => {
  events.push("session-ended");
  return {
    restoredToken: "admin-session",
    impersonatorEmail: "admin@example.com",
    userId: "customer-user",
  };
});
const setSessionCookie = vi.fn(async () => {
  events.push("cookie");
});
const clearSessionCookie = vi.fn(async () => undefined);
const recordRequiredAdminAction = vi.fn(async () => {
  events.push("audit");
});

let cookieToken = "admin-session";

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => ({ value: cookieToken }) }),
}));

vi.mock("../lib/db", () => ({
  transaction: vi.fn(async (fn: (client: typeof fakeClient) => Promise<unknown>) =>
    fn(fakeClient)
  ),
}));

vi.mock("../lib/auth", () => ({
  SESSION_COOKIE: "brostco_session",
  IMPERSONATION_TTL_MINUTES: 60,
  createImpersonationSession,
  endImpersonation,
  setSessionCookie,
  clearSessionCookie,
}));

vi.mock("../lib/platform-admin", () => ({
  requirePlatformAdmin: vi.fn(async () => ({
    id: "admin-user",
    email: "admin@example.com",
  })),
  isPlatformAdmin: vi.fn(() => false),
}));

vi.mock("../lib/admin/audit", () => ({ recordRequiredAdminAction }));

vi.mock("../lib/admin/accounts", () => ({
  adminAccount: vi.fn(async () => ({
    id: "customer-org",
    name: "Customer",
    owner_user_id: "customer-user",
    owner_email: "owner@example.com",
  })),
}));

describe("support-session audit atomicity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    events.length = 0;
    cookieToken = "admin-session";
  });

  it("records the start audit on the transaction client before changing the cookie", async () => {
    const { POST } = await import("../app/api/admin/impersonate/route");
    const res = await POST(
      new Request("http://localhost/api/admin/impersonate", {
        method: "POST",
        body: JSON.stringify({ orgId: "customer-org" }),
      })
    );

    expect(res.status).toBe(200);
    expect(createImpersonationSession.mock.calls[0]?.[1]).toBe(fakeClient);
    expect(recordRequiredAdminAction.mock.calls[0]?.[1]).toBe(fakeClient);
    expect(events).toEqual(["session", "audit", "cookie"]);
  });

  it("does not change the browser cookie when the required start audit fails", async () => {
    recordRequiredAdminAction.mockImplementationOnce(async () => {
      events.push("audit");
      throw new Error("audit unavailable");
    });
    const { POST } = await import("../app/api/admin/impersonate/route");

    await expect(
      POST(
        new Request("http://localhost/api/admin/impersonate", {
          method: "POST",
          body: JSON.stringify({ orgId: "customer-org" }),
        })
      )
    ).rejects.toThrow("audit unavailable");
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it("records the end audit on the same client before restoring the admin cookie", async () => {
    cookieToken = "support-token";
    const { DELETE } = await import("../app/api/admin/impersonate/route");
    const res = await DELETE();

    expect(res.status).toBe(200);
    expect(endImpersonation).toHaveBeenCalledWith("support-token", fakeClient);
    expect(recordRequiredAdminAction.mock.calls[0]?.[1]).toBe(fakeClient);
    expect(events).toEqual(["session-ended", "audit", "cookie"]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { LEGACY_ORG_ID } from "@/lib/tenant-context";

const mocks = vi.hoisted(() => ({
  existing: false,
  clientQuery: vi.fn(),
  transaction: vi.fn(),
  createSession: vi.fn(async () => "session-token"),
  setSessionCookie: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth", () => ({
  hasAnyOperator: vi.fn(async () => false),
  hashPassword: vi.fn(() => "password-hash"),
  createSession: mocks.createSession,
  setSessionCookie: mocks.setSessionCookie,
}));

vi.mock("@/lib/db", () => ({
  transaction: mocks.transaction,
}));

function request() {
  return new Request("https://app.test/api/auth/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "test-browser" },
    body: JSON.stringify({
      email: "Owner@Example.test",
      password: "long-enough-password",
      name: "Owner",
    }),
  });
}

describe("first-run account transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.existing = false;
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      if (/select exists\(select 1 from users\)/.test(sql)) {
        return { rows: [{ exists: mocks.existing }] };
      }
      if (/insert into users/.test(sql)) {
        return { rows: [{ id: "11111111-1111-4111-8111-111111111111", email: "owner@example.test" }] };
      }
      if (/insert into organization_members/.test(sql)) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    mocks.transaction.mockImplementation(async (fn: (client: { query: typeof mocks.clientQuery }) => Promise<unknown>) =>
      fn({ query: mocks.clientQuery })
    );
  });

  it("serializes the emptiness check and creates the owner membership atomically", async () => {
    const { POST } = await import("@/app/api/auth/bootstrap/route");
    const response = await POST(request());

    expect(response.status).toBe(200);
    const calls = mocks.clientQuery.mock.calls.map(([sql]) => String(sql));
    expect(calls[0]).toMatch(/pg_advisory_xact_lock/);
    expect(calls[1]).toMatch(/select exists\(select 1 from users\)/);
    expect(calls[2]).toMatch(/insert into users/);
    expect(calls[3]).toMatch(/insert into organization_members/);
    expect(mocks.clientQuery.mock.calls[3]?.[1]).toEqual([
      LEGACY_ORG_ID,
      "11111111-1111-4111-8111-111111111111",
    ]);
    expect(mocks.createSession).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "test-browser"
    );
  });

  it("refuses a second request after the lock reveals the first winner", async () => {
    mocks.existing = true;
    const { POST } = await import("@/app/api/auth/bootstrap/route");
    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Setup already complete." });
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.clientQuery.mock.calls.map(([sql]) => String(sql))).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/insert into users/)])
    );
  });
});

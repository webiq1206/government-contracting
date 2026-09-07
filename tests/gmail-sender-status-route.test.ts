import { afterEach, describe, expect, it, vi } from "vitest";

async function load(input: {
  connection?: () => Promise<Record<string, unknown>>;
  list?: () => Promise<Record<string, unknown>>;
}) {
  vi.resetModules();
  const connection = vi.fn(
    input.connection ??
      (async () => ({
        connected: true,
        email: "owner@example.com",
        status: "connected",
        lastError: null,
        sendAs: null,
      }))
  );
  const sendAsAddresses = vi.fn(
    input.list ??
      (async () => ({
        ok: true,
        options: [{ address: "owner@example.com", displayName: null, isPrimary: true }],
      }))
  );
  vi.doMock("@/lib/api-auth", () => ({
    requireCapability: vi.fn(async () => ({ id: "u-1", email: "owner@example.com" })),
  }));
  vi.doMock("@/lib/tenant", () => ({
    resolveTenantOrgId: vi.fn(async () => "org-1"),
  }));
  vi.doMock("@/lib/integrations/gmail", () => ({
    gmail: {
      connection,
      sendAsAddresses,
      setSendAs: vi.fn(),
    },
  }));
  vi.doMock("@/lib/logger", () => ({ logAgent: vi.fn(async () => undefined) }));
  const route = await import("@/app/api/integrations/gmail/sender/route");
  return { route, connection, sendAsAddresses };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("Gmail sending-address status", () => {
  it("returns an actionable unavailable state when the saved connection cannot be read", async () => {
    const { route } = await load({
      connection: async () => {
        throw new Error("database unavailable");
      },
    });

    const response = await route.GET();
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/could not be verified/i);
  });

  it("uses a non-success status when Google cannot verify available senders", async () => {
    const { route } = await load({
      list: async () => ({ ok: false, error: "Google grant lacks the settings scope." }),
    });

    const response = await route.GET();
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.options).toEqual([]);
    expect(body.error).toContain("No sending-address change was made");
    expect(body.error).toContain("Reconnect");
  });
});

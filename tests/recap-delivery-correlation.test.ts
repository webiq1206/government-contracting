import { afterEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const queryOne = vi.fn();

function row(id: string, orgId: string) {
  return {
    id,
    org_id: orgId,
    user_id: null,
    recipient_email: "shared@example.test",
    scope: "org",
    local_date: "2026-09-06",
    timezone: "UTC",
    status: "sent",
    late: false,
    quiet: false,
    test: false,
    due_at: null,
    sent_at: new Date("2026-09-07T06:00:00.000Z"),
    provider_attempted_at: new Date("2026-09-07T06:00:00.000Z"),
    attempts: 1,
    urgent_count: 0,
    subject: "Recap",
    html: "<p>Recap</p>",
    text_body: "Recap",
    provider_message_id: "<recap@example.test>",
    error: null,
    created_at: new Date("2026-09-07T06:00:00.000Z"),
    updated_at: new Date("2026-09-07T06:00:00.000Z"),
  };
}

async function loadDelivery() {
  vi.resetModules();
  vi.doMock("@/lib/db", () => ({ query, queryOne }));
  return import("@/lib/recap/delivery");
}

afterEach(() => {
  query.mockReset();
  queryOne.mockReset();
  vi.doUnmock("@/lib/db");
  vi.resetModules();
});

describe("Message-ID recap bounce correlation", () => {
  it("refuses a duplicated Message-ID that crosses tenant ownership", async () => {
    query.mockResolvedValueOnce([
      row("delivery-a", "11111111-1111-4111-8111-111111111111"),
      row("delivery-b", "22222222-2222-4222-8222-222222222222"),
    ]);
    const { recentDeliveryTo } = await loadDelivery();

    await expect(
      recentDeliveryTo("shared@example.test", 72, "<recap@example.test>")
    ).resolves.toBeNull();
  });

  it("does not fall back to a different email-only row when an authoritative Message-ID misses", async () => {
    query.mockResolvedValueOnce([]);
    const { recentDeliveryTo } = await loadDelivery();

    await expect(
      recentDeliveryTo("shared@example.test", 72, "<missing@example.test>")
    ).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("returns the one tenant row identified by Message-ID", async () => {
    query.mockResolvedValueOnce([
      row("delivery-a", "11111111-1111-4111-8111-111111111111"),
    ]);
    const { recentDeliveryTo } = await loadDelivery();

    const result = await recentDeliveryTo(
      "shared@example.test",
      72,
      "<recap@example.test>"
    );

    expect(result?.id).toBe("delivery-a");
    expect(result?.orgId).toBe("11111111-1111-4111-8111-111111111111");
  });
});

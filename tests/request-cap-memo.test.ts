import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const queryOne = vi.fn();

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => query(...args),
  queryOne: (...args: unknown[]) => queryOne(...args),
}));

describe("request cap memo", () => {
  beforeEach(async () => {
    query.mockReset();
    queryOne.mockReset();
    const { clearRequestCapMemo } = await import("@/lib/api-usage/request-cap");
    clearRequestCapMemo();
  });

  it("answers a spent account cap from memory so the next refusal takes no connection", async () => {
    queryOne
      .mockResolvedValueOnce({ daily_requests: 1000 })
      .mockResolvedValueOnce({ calls: 1000 });
    const { requestCapBlockMessage } = await import("@/lib/api-usage/request-cap");
    const first = await requestCapBlockMessage({
      orgId: "org-1",
      source: "platform",
      provider: "Anthropic",
      feature: "Summary",
    });
    const second = await requestCapBlockMessage({
      orgId: "org-1",
      source: "tenant",
      provider: "OpenAI",
      feature: "Other",
    });
    expect(first).toContain("today's request limit of 1000");
    expect(second).toBe(first);
    expect(queryOne).toHaveBeenCalledTimes(2);
    expect(query).not.toHaveBeenCalled();
  });

  it("does not remember a clear cap, so the next call still counts", async () => {
    queryOne.mockResolvedValueOnce({ daily_requests: 5000 }).mockResolvedValueOnce({ calls: 1 });
    query.mockResolvedValue([]);
    const { requestCapBlockMessage } = await import("@/lib/api-usage/request-cap");
    const input = {
      orgId: "org-2",
      source: "tenant",
      provider: "Anthropic",
      feature: "Summary",
    };
    expect(await requestCapBlockMessage(input)).toBeNull();
    expect(await requestCapBlockMessage(input)).toBeNull();
    expect(queryOne.mock.calls.length).toBeGreaterThan(2);
  });

  it("refuses without the admission lock when the pool cannot hand out a connection", async () => {
    queryOne.mockRejectedValue(new Error("timeout exceeded when trying to connect"));
    const { requestCapBlockMessage } = await import("@/lib/api-usage/request-cap");
    const first = await requestCapBlockMessage({
      orgId: "org-3",
      source: "platform",
      provider: "Anthropic",
      feature: "Summary",
    });
    const second = await requestCapBlockMessage({
      orgId: "org-9",
      source: "platform",
      provider: "Anthropic",
      feature: "Summary",
    });
    expect(first).toContain("usage ledger is busy");
    expect(first).toContain("Nothing was charged");
    expect(second).toBe(first);
    expect(queryOne).toHaveBeenCalledTimes(1);
  });
});

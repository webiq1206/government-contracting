import { afterEach, describe, expect, it, vi } from "vitest";
import { connectionFailure, integrationRequest } from "../lib/client/integration-request";

afterEach(() => vi.useRealTimers());

describe("integration request recovery", () => {
  it("aborts a stalled response body without replaying the save", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => ({
      json: () => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    } as Response));
    const result = integrationRequest("/api/integrations", { method: "POST" }, request);
    const assertion = expect(result).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not treat malformed responses as confirmed saves", async () => {
    await expect(integrationRequest("/api/integrations", { method: "POST" },
      async () => new Response("gateway error"))).rejects.toThrow();
  });

  it("explains recovery without echoing secrets or diagnostics", () => {
    const message = connectionFailure("401 API key sk-ant-do-not-display SQLSTATE");
    expect(message).toContain("Replace the saved details or reconnect");
    expect(message).not.toMatch(/401|sk-ant|SQLSTATE/);
    expect(connectionFailure("insufficient credit")).toContain("Review billing");
    expect(connectionFailure("unexpected stack trace")).toContain("Test connection again");
  });
});

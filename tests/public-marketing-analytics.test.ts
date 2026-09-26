import { beforeEach, describe, expect, it, vi } from "vitest";
const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics", () => ({ trackEvent: track }));
import { POST } from "@/app/api/track/marketing/route";
import { __resetRateLimits } from "@/lib/rate-limit";

function request(body: string, headers: Record<string, string> = {}) {
  return new Request("https://example.test/api/track/marketing", { method: "POST", headers: { origin: "https://example.test", "content-type": "application/json", ...headers }, body });
}
beforeEach(() => { vi.stubEnv("APP_URL", "https://example.test"); track.mockReset(); __resetRateLimits(); });
describe("anonymous marketing ingestion", () => {
  it("rejects cross-origin writes", async () => {
    expect((await POST(request('{}', { origin: "https://elsewhere.test" }))).status).toBe(403);
    expect(track).not.toHaveBeenCalled();
  });
  it("honors browser privacy signals", async () => {
    expect((await POST(request('{"event":"cta_click","path":"/"}', { "sec-gpc": "1" }))).status).toBe(204);
    expect(track).not.toHaveBeenCalled();
  });
  it("bounds the body even without a content-length header", async () => {
    expect((await POST(request('x'.repeat(1025)))).status).toBe(413);
    expect(track).not.toHaveBeenCalled();
  });
  it("stores only validated anonymous fields", async () => {
    expect((await POST(request(JSON.stringify({ event: "cta_click", path: "/", target: "/signup", location: "header", email: "private@example.com" })))).status).toBe(204);
    expect(track).toHaveBeenCalledWith({ event: "cta_click", path: "/", meta: { target: "/signup", location: "header" } });
  });
  it("throttles a sustained event burst", async () => {
    for (let i = 0; i < 60; i++) await POST(request('{"event":"cta_click","path":"/"}'));
    expect((await POST(request('{"event":"cta_click","path":"/"}'))).status).toBe(429);
    expect(track).toHaveBeenCalledTimes(60);
  });
});

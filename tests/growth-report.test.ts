import { beforeEach, describe, expect, it, vi } from "vitest";
const guard = vi.hoisted(() => vi.fn());
const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/platform-admin", () => ({ requirePlatformAdmin: guard }));
vi.mock("@/lib/db", () => ({ query }));
import { GET } from "@/app/api/admin/growth/route";
beforeEach(() => { vi.resetAllMocks(); });
describe("platform growth reporting", () => {
  it("does not query private metrics for unauthenticated or unauthorized sessions", async () => {
    guard.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await GET(new Request("https://brostco.com/api/admin/growth"))).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
  it("bounds reporting windows before querying", async () => {
    guard.mockResolvedValue({ id: "admin" });
    for (const days of ["0", "91", "NaN", "2.5", ""]) expect((await GET(new Request(`https://brostco.com/api/admin/growth?days=${days}`))).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
  it("returns aggregate results and explicit measurement definitions without caching", async () => {
    guard.mockResolvedValue({ id: "admin" }); query.mockResolvedValue([]);
    const response = await GET(new Request("https://brostco.com/api/admin/growth?days=14"));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const result = await response.json(); expect(result.days).toBe(14); expect(result.definitions.interactions).toContain("not unique visitors");
    expect(query).toHaveBeenCalledTimes(2); expect(query.mock.calls[0][1]).toEqual([14]);
  });
  it("reports unavailable metrics rather than fabricating zero results", async () => {
    guard.mockResolvedValue({ id: "admin" }); query.mockRejectedValue(new Error("DB unavailable"));
    expect((await GET(new Request("https://brostco.com/api/admin/growth"))).status).toBe(503);
  });
});

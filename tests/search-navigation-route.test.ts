import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/org-guard", () => ({ requireOrgContext: m.auth }));
vi.mock("@/lib/db", () => ({ query: m.query }));
vi.mock("@/lib/platform-admin", () => ({ isPlatformAdmin: m.admin }));
import { GET } from "@/app/api/search/route";
beforeEach(() => {
  m.auth.mockResolvedValue({ orgId: "tenant", user: { email: "viewer@example.test", orgRole: "viewer" } });
  m.query.mockReset().mockResolvedValue([]); m.admin.mockReset().mockReturnValue(false);
});
it("ignores client-supplied authority and retains scoped record queries", async () => {
  const response = await GET(new Request("https://brostco.com/api/search?q=Accounts&platformAdmin=true"));
  expect((await response.json()).results.some((row: { href: string }) => row.href.startsWith("/admin"))).toBe(false);
  expect(m.query).toHaveBeenCalledTimes(5);
  expect(m.query.mock.calls.every(([, parameters]) => parameters[1] === "tenant")).toBe(true);
});
it("offers Reports to a read-only user without performing any action", async () => {
  const response = await GET(new Request("https://brostco.com/api/search?q=Reports"));
  expect((await response.json()).results).toContainEqual(expect.objectContaining({ kind: "page", href: "/analytics" }));
});
it("never exposes platform navigation during account impersonation", async () => {
  m.admin.mockReturnValue(true);
  m.auth.mockResolvedValue({ orgId: "tenant", user: { email: "admin@example.test", impersonatedBy: "admin" } });
  const response = await GET(new Request("https://brostco.com/api/search?q=Accounts"));
  expect((await response.json()).results.some((row: { href: string }) => row.href.startsWith("/admin"))).toBe(false);
});

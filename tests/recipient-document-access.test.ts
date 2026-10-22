import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { encodeDocToken, type DocPointer } from "@/lib/domain/doc-link";
import { GET } from "@/app/d/[token]/route";
import { DISALLOWED_PREFIXES } from "@/lib/domain/public-routes";

const OPPORTUNITY = "991f1e31-4c12-4a3c-80af-0fb8c8c67784";
const ORG = "7dbd9b8b-c9fc-4b1f-85e3-59866816b75c";
const m = vi.hoisted(() => ({ opportunity: vi.fn(), owner: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/db", () => ({ queryOne: m.opportunity }));
vi.mock("@/lib/domain/file-ownership", () => ({ orgIdForStorageKey: m.owner }));
vi.mock("@/lib/integrations/storage", () => ({ storage: { download: m.download } }));

function pointer(overrides: Partial<DocPointer> = {}): DocPointer {
  return { k: "s", v: "synthetic/scope.pdf", n: "Scope.pdf", o: OPPORTUNITY,
    e: Math.floor(Date.now() / 1000) + 3600, ...overrides };
}
/** Exercise both real gates in request order; no cookies, accounts or network. */
async function open(token: string) {
  const request = new NextRequest(`https://brostco.com/d/${token}`);
  const edge = middleware(request);
  expect(edge.headers.get("location")).toBeNull();
  expect(edge.headers.get("x-middleware-next")).toBe("1");
  return GET(request, { params: Promise.resolve({ token }) });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_SECRET", "synthetic-recipient-access-secret");
  m.opportunity.mockResolvedValue({ org_id: ORG });
  m.owner.mockResolvedValue(ORG);
  m.download.mockResolvedValue(Buffer.from("%PDF-1.4\nsynthetic fixture only"));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("signed-out recipient authorization", () => {
  it("opens a valid package and its file using the same scoped expiry", async () => {
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const token = encodeDocToken(pointer({ k: "p", v: OPPORTUNITY, n: "Synthetic package", e: expiry,
      d: [{ k: "s", v: "synthetic/scope.pdf", n: "Scope.pdf" }] }));
    const response = await open(token);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("No sign-in is needed");
    const child = html.match(/href="\/d\/([^"]+)"/)?.[1];
    expect(child).toBeTruthy();
    const payload = JSON.parse(Buffer.from(child!.split(".")[0], "base64url").toString());
    expect(payload.e).toBe(expiry);
    expect(payload.o).toBe(OPPORTUNITY);
    const file = await open(child!);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toMatch(/pdf/);
    expect(file.headers.get("cache-control")).toMatch(/no-store/);
    expect(file.headers.get("x-robots-tag")).toContain("noindex");
    expect(await file.text()).toMatch(/^%PDF-/);
    expect(m.download).toHaveBeenCalledExactlyOnceWith("synthetic/scope.pdf");
  });
  it.each(["", "invalid", "synthetic.invalid"])("denies absent or invalid tokens without accessing content: %s", async token => {
    const response = await open(token);
    expect(response.status).toBe(404);
    expect(m.opportunity).not.toHaveBeenCalled();
    expect(m.download).not.toHaveBeenCalled();
  });
  it("denies expired tokens before reading metadata or content", async () => {
    const response = await open(encodeDocToken(pointer({ e: 1 })));
    expect(response.status).toBe(404);
    expect(m.opportunity).not.toHaveBeenCalled();
    expect(m.download).not.toHaveBeenCalled();
  });
  it("denies a tampered opportunity scope", async () => {
    const [payload, signature] = encodeDocToken(pointer()).split(".");
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    data.o = "fa8a9198-b687-48c4-ab78-f5f8413b41a1";
    expect((await open(`${Buffer.from(JSON.stringify(data)).toString("base64url")}.${signature}`)).status).toBe(404);
    expect(m.download).not.toHaveBeenCalled();
  });
  it("revokes signed access when the scoped opportunity no longer exists", async () => {
    m.opportunity.mockResolvedValue(null);
    expect((await open(encodeDocToken(pointer()))).status).toBe(404);
    expect(m.download).not.toHaveBeenCalled();
  });
  it("denies a stored file belonging to another tenant", async () => {
    m.owner.mockResolvedValue("other-tenant");
    expect((await open(encodeDocToken(pointer()))).status).toBe(404);
    expect(m.download).not.toHaveBeenCalled();
  });
  it("does not disclose a cross-tenant filename through a signed package", async () => {
    m.owner.mockResolvedValue("other-tenant");
    const response = await open(encodeDocToken(pointer({ k: "p", v: OPPORTUNITY, n: "Synthetic package",
      d: [{ k: "s", v: "other/private.pdf", n: "Private tenant plan.pdf" }] })));
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Private tenant plan");
    expect(m.download).not.toHaveBeenCalled();
  });
  it("fails closed on scope-verification failure", async () => {
    m.owner.mockRejectedValue(new Error("synthetic verification failure"));
    expect((await open(encodeDocToken(pointer()))).status).toBe(503);
    expect(m.download).not.toHaveBeenCalled();
  });
  it("keeps the upstream redirect allowlist after passing middleware", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }));
    vi.stubGlobal("fetch", fetch);
    expect((await open(encodeDocToken(pointer({ k: "u", v: "https://sam.gov/synthetic.pdf" })))).status).toBe(502);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(m.download).not.toHaveBeenCalled();
  });
  it("preserves private-page/API gates and crawler exclusions", () => {
    expect(middleware(new NextRequest("https://brostco.com/today")).headers.get("location")).toContain("/login");
    expect(middleware(new NextRequest("https://brostco.com/api/documents/other/open")).status).toBe(401);
    expect(DISALLOWED_PREFIXES.some(p => p.prefix === "/d/")).toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const guard = vi.hoisted(() => vi.fn());
const lookup = vi.hoisted(() => vi.fn());
vi.mock("@/lib/org-guard", () => ({ requireOrgContext: guard }));
vi.mock("@/lib/db", () => ({ queryOne: lookup }));
import { GET } from "../app/api/documents/[id]/open/route";

const call = (page = "34") => GET(new Request(`https://localhost:3000/api/documents/doc-1/open?page=${page}`, {
  headers: { host: "untrusted.example", "x-forwarded-host": "also-untrusted.example" },
}), { params: Promise.resolve({ id: "doc-1" }) });

beforeEach(() => { vi.clearAllMocks(); guard.mockResolvedValue({ orgId: "org-mine" }); lookup.mockResolvedValue({ storage_path: "orgs/org-mine/solicitations/quote #1?.pdf" }); });
describe("source opening behind the deployment proxy", () => {
  it("keeps both admin and ordinary users on the browser origin and preserves page links", async () => {
    for (const role of ["admin", "operator"]) {
      guard.mockResolvedValue({ orgId: "org-mine", user: { role } });
      const res = await call();
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("/api/files/orgs/org-mine/solicitations/quote%20%231%3F.pdf#page=34");
      expect(new URL(res.headers.get("location")!, "https://brostco.com").origin).toBe("https://brostco.com");
      expect(res.headers.get("cache-control")).toContain("no-store");
      expect(lookup).toHaveBeenCalledWith(expect.stringContaining("id = $1 and org_id = $2"), ["doc-1", "org-mine"]);
    }
  });
  it.each(["0", "-1", "1.5", "bad"])("does not emit an invalid page fragment %s", async (page) => {
    expect((await call(page)).headers.get("location")).not.toContain("#page=");
  });
  it("preserves authentication refusal without querying documents", async () => {
    guard.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await call()).status).toBe(401); expect(lookup).not.toHaveBeenCalled();
  });
  it.each([null, { storage_path: null }])("keeps unavailable or unowned source documents indistinguishable", async (row) => {
    lookup.mockResolvedValue(row); const res = await call();
    expect(res.status).toBe(404); expect(await res.json()).toEqual({ error: "Not found" });
  });
});

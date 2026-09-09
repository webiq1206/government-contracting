import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), query: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/platform-admin", () => ({ requirePlatformAdmin: mocks.auth }));
vi.mock("@/lib/api-usage/read", () => ({ readUsage: mocks.read }));
vi.mock("@/lib/db", () => ({ query: mocks.query, transaction: mocks.transaction }));
import { GET, POST } from "@/app/api/admin/api-usage/route";

describe("platform usage authorization", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([401, 403])("rejects reads and billing changes before accessing data (%s)", async status => {
    mocks.auth.mockImplementation(async () => new Response("Access unavailable", { status }));
    expect((await GET(new Request("https://brostco.test/api/admin/api-usage"))).status).toBe(status);
    expect((await POST(new Request("https://brostco.test/api/admin/api-usage", {
      method: "POST", body: JSON.stringify({ action: "invoice", orgId: "00000000-0000-4000-8000-000000000002" }),
    }))).status).toBe(status);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

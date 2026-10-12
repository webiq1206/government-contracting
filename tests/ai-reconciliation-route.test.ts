import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn() }));
vi.mock("../lib/platform-admin", () => ({ requirePlatformAdmin: state.auth }));
vi.mock("../lib/admin/ai-reconciliation", () => ({ readAiReconciliation: state.read }));
import { GET } from "../app/api/admin/ai-reconciliation/route";

beforeEach(() => {
  vi.clearAllMocks();
  state.auth.mockResolvedValue({ id: "authorized-platform-admin" });
  state.read.mockResolvedValue({ organizationId: "founding-account", heldReservations: { total: 3 } });
});

it.each([401, 403, 404])("does not read inventory when authorization returns %s", async status => {
  state.auth.mockResolvedValue(new Response("Denied", { status }));
  expect((await GET()).status).toBe(status);
  expect(state.read).not.toHaveBeenCalled();
});

it("returns read-only inventory without permitting shared caching", async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({ heldReservations: { total: 3 } });
  expect(state.read).toHaveBeenCalledWith();
});

it("fails closed without exposing database failures or partial results", async () => {
  state.read.mockRejectedValue(new Error("private database URL and key"));
  const response = await GET();
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(JSON.stringify(await response.json())).not.toContain("private database URL");
});

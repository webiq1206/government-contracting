import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => vi.fn());
const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-auth", () => ({ requireUser: auth }));
vi.mock("@/lib/analytics", () => ({ trackEvent: track }));
import { POST } from "@/app/api/analytics/route";
beforeEach(() => { vi.resetAllMocks(); auth.mockResolvedValue({ id: "user", organizationId: "org" }); });
describe("conversion integrity", () => {
  it("rejects client-forged conversion milestones", async () => {
    for (const event of ["trial_started", "account_created", "subscription_completed", "company_profile_saved"]) {
      const response = await POST(new Request("https://brostco.com/api/analytics", { method: "POST", body: JSON.stringify({ event }) }));
      expect(response.status).toBe(400);
    }
    expect(track).not.toHaveBeenCalled();
  });
  it("preserves ordinary authenticated product events", async () => {
    const response = await POST(new Request("https://brostco.com/api/analytics", { method: "POST", body: JSON.stringify({ event: "guide_opened" }) }));
    expect(response.status).toBe(200);
    expect(track).toHaveBeenCalledWith(expect.objectContaining({ event: "guide_opened", orgId: "org", userId: "user" }));
  });
});

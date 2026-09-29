import { beforeEach, describe, expect, it, vi } from "vitest";
const retrieve = vi.hoisted(() => vi.fn());
vi.mock("@/lib/billing/stripe", () => ({ getStripe: () => ({ checkout: { sessions: { retrieve } } }) }));
import { verifiedGa4Purchase } from "@/lib/billing/ga4-purchase";
const session = { livemode: true, status: "complete", payment_status: "paid", client_reference_id: "org-one", metadata: { org_id: "org-one", plan_key: "standard", interval: "month" }, currency: "usd", amount_total: 14700 };
beforeEach(() => { retrieve.mockReset(); retrieve.mockResolvedValue(structuredClone(session)); });
describe("verified GA4 purchase", () => {
  it("uses Stripe's actual paid total and hashes the transaction reference", async () => {
    const result = await verifiedGa4Purchase("cs_live_abc123", "org-one");
    expect(result).toMatchObject({ value: 147, currency: "USD", plan: "standard", interval: "month" });
    expect(result?.transaction_id).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain("cs_live");
  });
  it.each([
    { payment_status: "unpaid" }, { status: "open" }, { client_reference_id: "another-org" },
    { metadata: { ...session.metadata, org_id: "another-org" } }, { amount_total: 0 }, { livemode: false },
  ])("does not count unverified or cross-tenant purchases: %o", async (override) => {
    retrieve.mockResolvedValue({ ...session, ...override });
    expect(await verifiedGa4Purchase("cs_live_abc123", "org-one")).toBeNull();
  });
  it("ignores absent or test sessions without contacting Stripe", async () => {
    expect(await verifiedGa4Purchase(undefined, "org-one")).toBeNull();
    expect(await verifiedGa4Purchase("cs_test_abc123", "org-one")).toBeNull(); expect(retrieve).not.toHaveBeenCalled();
  });
  it("does not break checkout return during a provider error", async () => {
    retrieve.mockRejectedValue(new Error("offline"));
    expect(await verifiedGa4Purchase("cs_live_abc123", "org-one")).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ queryOne: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/db", () => db);
import { hasAnyOperator, resolveSession } from "@/lib/auth";

const session = () => ({
  id: "user-a", email: "owner@example.test", name: "Owner", role: "operator",
  organization_id: "org-a", org_role: "owner", subscription_status: "active",
  plan_key: "standard", trial_ends_at: null, billing_exempt: false, suspended_at: null,
  impersonator_email: null, last_seen_at: new Date(),
});

describe("session lookup cost and isolation", () => {
  beforeEach(() => { vi.clearAllMocks(); db.query.mockResolvedValue([]); });
  it("only opens first-run setup after a successful empty-user check", async () => {
    db.queryOne.mockResolvedValueOnce({ present: true }).mockResolvedValueOnce({ present: false }).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("database unavailable"));
    expect(await hasAnyOperator()).toBe(true);
    expect(await hasAnyOperator()).toBe(false);
    expect(await hasAnyOperator()).toBe(true);
    expect(await hasAnyOperator()).toBe(true);
    expect(db.queryOne).toHaveBeenCalledWith("select exists(select 1 from users) as present");
  });
  it("resolves a recently active session in one query with no write", async () => {
    db.queryOne.mockResolvedValue(session());
    expect(await resolveSession("session-token")).toMatchObject({ organizationId: "org-a", orgRole: "owner" });
    expect(db.queryOne).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
  });
  it("does not retain revoked sessions or an old role across requests", async () => {
    db.queryOne.mockResolvedValueOnce(session()).mockResolvedValueOnce({ ...session(), org_role: "viewer", organization_id: "org-b" }).mockResolvedValueOnce(null);
    expect((await resolveSession("same-token"))?.orgRole).toBe("owner");
    expect(await resolveSession("same-token")).toMatchObject({ orgRole: "viewer", organizationId: "org-b" });
    expect(await resolveSession("same-token")).toBeNull();
  });
  it("throttles activity writes and preserves a support-session marker", async () => {
    db.queryOne.mockResolvedValue({ ...session(), last_seen_at: new Date(0), impersonator_email: "support@example.test" });
    expect((await resolveSession("session-token"))?.impersonatedBy).toBe("support@example.test");
    expect(db.query).toHaveBeenCalledTimes(1);
  });
  it("does not turn a database failure into signed-out or fallback access", async () => {
    db.queryOne.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(resolveSession("session-token")).rejects.toThrow("database unavailable");
  });
  it("keeps an orphaned membership unprivileged", async () => {
    db.queryOne.mockResolvedValue({ ...session(), organization_id: null, org_role: null });
    expect(await resolveSession("session-token")).toMatchObject({ organizationId: null, orgRole: null });
  });
});
